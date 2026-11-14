/**
 * Apple App Store search-suggest ("autocomplete") mining — the "raw discovery
 * breadth + real query grounding" source flagged as deferred in
 * keywordDiscovery.ts's module doc and designDigitalMarketingPro.md §4.2 item 3
 * / §8.1. Unlike keywordDiscovery.ts (LLM-generated + competitor-mined
 * candidates), every phrase here comes directly from Apple's own search-suggest
 * completions — real queries Apple's autocomplete offers for what users type,
 * not a synthesized guess.
 *
 * iOS only: Google Play has no public, unauthenticated autocomplete surface at
 * all (researchDigitalMarketingPro.md §4.3/§9's cross-store review found none).
 *
 * Data-source caveat (read before trusting this blindly): the endpoint below
 * (`search.itunes.apple.com/.../hints`) is Apple's real, undocumented
 * autocomplete backend — the same one the App Store app itself calls, and the
 * one long relied on by open-source ASO tooling — but unlike
 * `itunes.apple.com/search` (itunesClient.ts), it is not a published, versioned
 * API contract. It can change or disappear without notice — exactly the risk
 * researchDigitalMarketingPro.md §4 flagged when this source was first
 * deferred. A failed fan-out request is surfaced to the user, never silently
 * dropped (AGENTS.md).
 *
 * Volume is modeled, not measured: Apple publishes no official search-volume
 * numbers, so `volumeTierForPosition` derives a coarse High/Medium/Low tier
 * from each phrase's rank position within its own autocomplete response
 * (Apple orders hints by relevance/popularity) — a relative signal, not an
 * absolute search-count estimate. This follows design doc §4.7's "coarse
 * tiers, not fake-precise numbers" principle rather than presenting an
 * invented-looking exact number the way some commercial tools do.
 *
 * Two response-format quirks confirmed by hand against the live endpoint
 * (2026-09), both easy to get wrong silently since a wrong guess still
 * returns 200 OK:
 * - The response body is an XML property list (`Content-Type: text/xml`),
 *   not JSON — `fetchHints` parses it with a small regex-based extractor
 *   (`parseHintTerms`), not `res.json()`.
 * - Storefront/country selection is via the `X-Apple-Store-Front` request
 *   header (confirmed by the response's `Vary: X-Apple-Store-Front`), not a
 *   `country`/`cc` query parameter — a `country=xx` query param is silently
 *   ignored. `STOREFRONT_IDS` below maps `storeCountry` to that header for a
 *   handful of storefronts verified live; an unmapped country omits the
 *   header entirely and `exploreSuggestions` says so in its result rather
 *   than silently returning another storefront's data as if it were the
 *   requested one.
 */
import type { StoreId } from './types'

const HINTS_URL = 'https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints'
const FETCH_TIMEOUT_MS = 10_000
const FANOUT_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')
const FANOUT_CONCURRENCY = 6

/**
 * `X-Apple-Store-Front` header values, verified live (curl) against the
 * hints endpoint for each listed country — not copied from an unverified
 * source, since a wrong id here would silently serve the wrong storefront's
 * data with no error (see module doc). Deliberately a small, verified set
 * rather than a guessed full ~175-country table: `exploreSuggestions` reports
 * unmapped countries explicitly instead of fabricating an id for them.
 */
const STOREFRONT_IDS: Record<string, string> = {
	us: '143441',
	gb: '143444-1,29',
	ca: '143455-1,29',
	au: '143460-1,29',
	de: '143443-2,32',
	jp: '143462-3,26',
	in: '143467-1,29',
}

export type SuggestVolumeTier = 'high' | 'medium' | 'low'

export interface SuggestPhrase {
	term: string
	/** The "<seed> <letter>" fan-out bucket this phrase surfaced under, or null for the bare seed query. */
	bucket: string | null
	/** Modeled, relative demand tier from this phrase's position in Apple's own suggestion ordering — not a real search-volume count (see module doc). */
	volumeTier: SuggestVolumeTier
}

export interface SuggestExplorerResult {
	seed: string
	phrases: SuggestPhrase[]
	/** Fan-out letters that returned zero suggestions — surfaced so coverage gaps are visible rather than silently missing. */
	emptyBuckets: string[]
	/** Fan-out letters whose request failed — surfaced, never swallowed (AGENTS.md). */
	failedBuckets: string[]
	/** True when `storeCountry` had no entry in `STOREFRONT_IDS` — results below reflect Apple's default storefront for this request, not necessarily the app's configured country. */
	countryUnmapped: boolean
}

function decodeXmlEntities(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
}

/**
 * Extracts `<key>term</key><string>...</string>` values from the hints
 * plist's XML text — deliberately a small regex scan rather than a full
 * plist/XML parser (no XML-parsing dependency exists elsewhere in this
 * package, and the shape here is fixed and simple: `term`/`url` key-string
 * pairs inside each `hints` array entry). Matches only `term` keys, so `url`
 * entries in the same dict are never picked up.
 */
function parseHintTerms(xml: string): string[] {
	const terms: string[] = []
	const re = /<key>term<\/key>\s*<string>([^<]*)<\/string>/g
	let match: RegExpExecArray | null
	while ((match = re.exec(xml))) {
		const term = decodeXmlEntities(match[1]).trim()
		if (term) terms.push(term)
	}
	return terms
}

async function fetchHints(term: string, country: string): Promise<string[]> {
	const url = `${HINTS_URL}?clientApplication=Software&term=${encodeURIComponent(term)}`
	const storefront = STOREFRONT_IDS[country.toLowerCase()]
	const res = await fetch(url, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		headers: storefront ? { 'X-Apple-Store-Front': storefront } : undefined,
	})
	if (!res.ok) throw new Error(`Apple suggest lookup failed (${res.status}) for "${term}"`)
	return parseHintTerms(await res.text())
}

/**
 * Bounded-concurrency map over the 27 fan-out queries (seed + a-z) — mirrors
 * keywordDiscovery.ts's mapWithConcurrency helper. Kept as a separate local
 * copy rather than importing that module's: this module has no other reason
 * to depend on keywordDiscovery.ts, and the two call sites' item/result
 * shapes differ (this one never drops results, so it doesn't need that
 * function's `null`-filtering behavior).
 */
async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length)
	let index = 0
	async function worker() {
		while (index < items.length) {
			const i = index++
			results[i] = await fn(items[i])
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
	return results
}

function volumeTierForPosition(position: number, total: number): SuggestVolumeTier {
	const frac = total <= 1 ? 0 : position / (total - 1)
	if (frac <= 0.25) return 'high'
	if (frac <= 0.6) return 'medium'
	return 'low'
}

/**
 * Runs the seed query plus one query per a-z fan-out letter (Apple's own
 * autocomplete completions for "<seed> <letter>"), deduping by lowercased
 * term text and keeping the first (best-ranked) occurrence — mirroring
 * keywordDiscovery.ts's dedupe-keeps-first-listed convention. This is exactly
 * `1 + FANOUT_LETTERS.length` (27) live calls to Apple's suggest endpoint,
 * run with bounded concurrency rather than sequentially or fully in parallel
 * (same tradeoff as keywordDiscovery.ts's live store-search loop).
 */
export async function exploreSuggestions(
	store: StoreId,
	seed: string,
	country: string
): Promise<SuggestExplorerResult> {
	if (store !== 'ios') {
		throw new Error(
			'Suggest Explorer only works for the Apple App Store — Google Play has no public autocomplete/suggest endpoint.'
		)
	}
	const trimmedSeed = seed.trim()
	if (!trimmedSeed) throw new Error('Enter a seed keyword first.')

	const buckets: { letter: string | null; query: string }[] = [
		{ letter: null, query: trimmedSeed },
		...FANOUT_LETTERS.map((letter) => ({ letter, query: `${trimmedSeed} ${letter}` })),
	]

	const bucketResults = await mapWithConcurrency(buckets, FANOUT_CONCURRENCY, async (bucket) => {
		try {
			const hints = await fetchHints(bucket.query, country)
			return { bucket, hints, failed: false }
		} catch (err) {
			console.warn(`[digitalMarketingPro] suggest lookup failed for "${bucket.query}":`, err)
			return { bucket, hints: [] as string[], failed: true }
		}
	})

	const emptyBuckets: string[] = []
	const failedBuckets: string[] = []
	const seen = new Set<string>()
	const phrases: SuggestPhrase[] = []

	// Reported using "seed" as the label for the bare-seed query (bucket.letter
	// === null) rather than skipping it — a failure/empty result on the seed
	// query itself is just as real as a fan-out letter's, and must surface the
	// same way (this module's doc comment promises no silent drops).
	for (const { bucket, hints, failed } of bucketResults) {
		const label = bucket.letter ?? 'seed'
		if (failed) {
			failedBuckets.push(label)
			continue
		}
		if (hints.length === 0) {
			emptyBuckets.push(label)
			continue
		}
		hints.forEach((term, i) => {
			const key = term.toLowerCase()
			if (seen.has(key)) return
			seen.add(key)
			phrases.push({
				term,
				bucket: bucket.letter,
				volumeTier: volumeTierForPosition(i, hints.length),
			})
		})
	}

	return {
		seed: trimmedSeed,
		phrases,
		emptyBuckets,
		failedBuckets,
		countryUnmapped: !STOREFRONT_IDS[country.toLowerCase()],
	}
}
