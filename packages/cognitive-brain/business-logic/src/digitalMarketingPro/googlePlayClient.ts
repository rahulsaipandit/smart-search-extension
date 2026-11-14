/**
 * Best-effort Google Play client. Unlike the iTunes Search API (itunesClient.ts),
 * Google Play has no public, documented, unauthenticated search/lookup API at
 * all — this parses the same `AF_initDataCallback(...)` embedded-JSON blocks
 * every Play Store page server-renders, the same general technique the
 * widely-used `google-play-scraper` npm package relies on.
 *
 * This is inherently more fragile than the App Store path: Google can change
 * the internal array shape at any time with no notice, unlike Apple's stable
 * JSON API contract. To reduce (not eliminate) that fragility, this file
 * detects data by its *structural shape* (a package-id-like string paired
 * with a title string and a rating tuple) rather than hardcoding the numeric
 * array indices a naive scraper would — Google reordering unrelated fields
 * shouldn't break this, though a large layout change still could. Every
 * exported function fails soft (empty result / thrown error the caller
 * already handles), never silently fabricates data — consistent with
 * designDigitalMarketingPro.md §7's "no source has privileged first-party
 * access; shape user-facing copy as 'estimated', not 'official'" guidance.
 */
import type { StoreApp, StoreAppDetail } from './types'

const SEARCH_URL = 'https://play.google.com/store/search'
const DETAIL_URL = 'https://play.google.com/store/apps/details'
const FETCH_TIMEOUT_MS = 15_000

const AF_BLOCK_RE = /AF_initDataCallback\(\{key: '(ds:\d+)'.*?data:(\[[\s\S]*?\]), sideChannel/g

function extractDataBlocks(html: string): Record<string, unknown> {
	const blocks: Record<string, unknown> = {}
	let match: RegExpExecArray | null
	AF_BLOCK_RE.lastIndex = 0
	while ((match = AF_BLOCK_RE.exec(html))) {
		try {
			blocks[match[1]] = JSON.parse(match[2])
		} catch (err) {
			// Skip a block that doesn't parse cleanly — other blocks may still be
			// usable, but this is exactly the kind of drift the module doc comment
			// warns about, so log it rather than absorb it silently.
			console.warn(
				`[digitalMarketingPro] Google Play data block "${match[1]}" failed to parse:`,
				err
			)
		}
	}
	return blocks
}

function isPackageId(value: unknown): value is string {
	// Minimum 2 dot-separated segments — real packages like "com.todoist" or
	// "notion.id" are only 2 segments, not the 3+ a stricter regex would require.
	return (
		typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value)
	)
}

/**
 * Matches the compact per-app tuple Play embeds in search/list results, each
 * wrapped in its own single-element array: [[ [packageId, n], icon,
 * screenshots, title, [ratingStr, ratingNum], category, ... ]]. Indices
 * verified directly against a live fetched search page (title at [3], rating
 * pair at [4] — easy to get off-by-one against, since the icon/screenshot
 * blocks at [1]/[2] are themselves arrays too).
 */
function looksLikeSearchEntry(wrapper: unknown): wrapper is any[] {
	if (!Array.isArray(wrapper) || wrapper.length < 1) return false
	const entry = wrapper[0]
	return (
		Array.isArray(entry) &&
		Array.isArray(entry[0]) &&
		isPackageId(entry[0][0]) &&
		typeof entry[3] === 'string' &&
		entry[3].length > 0 &&
		Array.isArray(entry[4]) &&
		typeof entry[4][1] === 'number'
	)
}

function findSearchEntries(node: unknown, depth: number, maxDepth: number): any[] | null {
	if (depth > maxDepth || node == null || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		if (node.length >= 1 && node.every(looksLikeSearchEntry)) return node
		for (const child of node) {
			const found = findSearchEntries(child, depth + 1, maxDepth)
			if (found) return found
		}
	}
	return null
}

function mapSearchEntry(wrapper: any[]): StoreApp {
	const entry = wrapper[0]
	const installsText = typeof entry[15] === 'string' ? entry[15] : undefined
	return {
		id: entry[0][0],
		title: entry[3],
		description: Array.isArray(entry[13]) && typeof entry[13][1] === 'string' ? entry[13][1] : '',
		rating: typeof entry[4][1] === 'number' ? entry[4][1] : 0,
		// Play search results don't include a review count — installs is the closest available
		// volume proxy, an explicit approximation (see the module doc comment above).
		popularitySignal: installsText ? parseInstalls(installsText) : 0,
	}
}

function parseInstalls(text: string): number {
	const digits = text.replace(/[^0-9]/g, '')
	return digits ? Number(digits) : 0
}

/** Search Google Play for apps matching `term`. */
export async function searchPlayApps(
	term: string,
	country: string,
	limit = 30
): Promise<StoreApp[]> {
	const url = `${SEARCH_URL}?q=${encodeURIComponent(term)}&c=apps&hl=en&gl=${encodeURIComponent(country)}`
	const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
	if (!res.ok) throw new Error(`Google Play search failed (${res.status}) for "${term}"`)
	const html = await res.text()
	const blocks = extractDataBlocks(html)

	for (const block of Object.values(blocks)) {
		const entries = findSearchEntries(block, 0, 14)
		if (entries) return entries.slice(0, limit).map(mapSearchEntry)
	}
	return []
}

const CONTENT_RATING_LABELS = new Set([
	'Everyone',
	'Everyone 10+',
	'Teen',
	'Mature 17+',
	'Adults Only 18+',
	'Unrated',
])

function findDetailInfoArray(node: unknown, depth: number, maxDepth: number): any[] | null {
	if (depth > maxDepth || node == null || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		const hasTitleSlot = node.some(
			(el) =>
				Array.isArray(el) && el.length === 1 && typeof el[0] === 'string' && el[0].trim().length > 0
		)
		const hasContentRating = node.some(
			(el) => Array.isArray(el) && typeof el[0] === 'string' && CONTENT_RATING_LABELS.has(el[0])
		)
		if (hasTitleSlot && hasContentRating) return node
		for (const child of node) {
			const found = findDetailInfoArray(child, depth + 1, maxDepth)
			if (found) return found
		}
	}
	return null
}

function findRatingPair(node: unknown, depth: number, maxDepth: number): [string, number] | null {
	if (depth > maxDepth || node == null || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		if (
			node.length >= 2 &&
			typeof node[0] === 'string' &&
			/^\d(\.\d+)?$/.test(node[0]) &&
			typeof node[1] === 'number' &&
			node[1] >= 0 &&
			node[1] <= 5.01
		) {
			return node as [string, number]
		}
		for (const child of node) {
			const found = findRatingPair(child, depth + 1, maxDepth)
			if (found) return found
		}
	}
	return null
}

/** The rating pair's parent array also holds the total review count as a sibling [str, num] tuple — the largest such sibling value is the total. */
function findReviewCountNearRating(ratingParent: any[]): number {
	let max = 0
	for (const el of ratingParent) {
		if (
			Array.isArray(el) &&
			typeof el[0] === 'string' &&
			typeof el[1] === 'number' &&
			el[1] > max
		) {
			max = el[1]
		}
	}
	return max
}

// "Apr 24, 2018" style label. Verified against exactly one live detail page
// (paired there with a [unixSeconds, nanos] tuple) — treat as best-effort,
// less confidently validated than title/rating/review-count/description
// above, which were each cross-checked against known values. It's genuinely
// unclear from a single sample whether this represents the app's *original*
// release date or its *most recent update* — both are plausible for the one
// app checked. Mapped to `releaseDate` below (the interpretation that
// matched the one sample checked), never to `lastUpdated` — presenting an
// ambiguous date as a confident "last updated X days ago" claim would be
// actively misleading if the guess is wrong, worse than not showing it.
const DATE_LABEL_RE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/

function findReleaseDateGuess(node: unknown, depth: number, maxDepth: number): string | undefined {
	if (depth > maxDepth || node == null || typeof node !== 'object') return undefined
	if (Array.isArray(node)) {
		if (
			node.length >= 2 &&
			typeof node[0] === 'string' &&
			DATE_LABEL_RE.test(node[0]) &&
			Array.isArray(node[1]) &&
			typeof node[1][0] === 'number' &&
			node[1][0] > 1_000_000_000
		) {
			return node[0]
		}
		for (const child of node) {
			const found = findReleaseDateGuess(child, depth + 1, maxDepth)
			if (found) return found
		}
	}
	return undefined
}

function findLongestPairedString(node: unknown, depth: number, maxDepth: number): string {
	let best = ''
	function walk(n: unknown, d: number) {
		if (d > maxDepth || n == null || typeof n !== 'object') return
		if (Array.isArray(n)) {
			if (
				n.length === 2 &&
				n[0] === null &&
				typeof n[1] === 'string' &&
				n[1].length > best.length
			) {
				best = n[1]
			}
			for (const child of n) walk(child, d + 1)
		}
	}
	walk(node, depth)
	return best
}

/**
 * Look up a single app by its Google Play package name (from a store URL,
 * e.g. `?id=com.example.app`, or for the audit's live listing/health
 * checks). `releaseDate` is best-effort (see `findReleaseDateGuess`'s doc
 * comment); `lastUpdated` is deliberately left undefined (same reason); and
 * `languages` isn't populated at all — Play's detail page doesn't expose
 * supported-locale metadata the way iTunes lookup does, so the localization
 * audit check is iOS-only for now, not a Play gap this function tries to
 * paper over.
 */
export async function lookupPlayApp(
	packageName: string,
	country: string
): Promise<StoreAppDetail | null> {
	const url = `${DETAIL_URL}?id=${encodeURIComponent(packageName)}&hl=en&gl=${encodeURIComponent(country)}`
	const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
	if (!res.ok) throw new Error(`Google Play lookup failed (${res.status}) for "${packageName}"`)
	const html = await res.text()
	const blocks = extractDataBlocks(html)

	for (const block of Object.values(blocks)) {
		const info = findDetailInfoArray(block, 0, 12)
		if (!info) continue
		const titleEntry = info.find(
			(el) => Array.isArray(el) && el.length === 1 && typeof el[0] === 'string'
		) as [string] | undefined
		if (!titleEntry) continue

		const ratingPair = findRatingPair(block, 0, 14)
		const reviewCount = ratingPair
			? findReviewCountNearRating(findParentOf(block, ratingPair) ?? [])
			: 0
		const description = findLongestPairedString(block, 0, 14)
		const releaseDate = findReleaseDateGuess(block, 0, 14)

		return {
			id: packageName,
			title: titleEntry[0],
			description,
			rating: ratingPair ? ratingPair[1] : 0,
			popularitySignal: reviewCount,
			releaseDate,
		}
	}
	return null
}

/** Re-finds the direct parent array of a located node — findRatingPair returns the pair itself, but the review count lives alongside it in the pair's *containing* array, not the pair. */
function findParentOf(node: unknown, target: unknown, depth = 0, maxDepth = 14): any[] | null {
	if (depth > maxDepth || node == null || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		if (node.includes(target as any)) return node
		for (const child of node) {
			const found = findParentOf(child, target, depth + 1, maxDepth)
			if (found) return found
		}
	}
	return null
}
