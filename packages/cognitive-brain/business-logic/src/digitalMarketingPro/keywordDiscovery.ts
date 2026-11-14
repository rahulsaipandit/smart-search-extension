/**
 * Keyword discovery pipeline (design doc §4.2). v1 implements four of the
 * five sourcing strategies described there — LLM generation (informed by
 * competitor context), competitor-metadata mining (below), user-entered
 * screenshot captions (folded in via `screenshotCaptions.ts`'s
 * `extractCaptionKeywordSeeds`, tagged `screenshot-caption`), and full
 * competitor-listing lookup feeding both of the above. Autocomplete/suggest
 * scraping and "Apple Recommendations" are still deferred — see the design
 * doc's own note that the latter is "pending the §8.1 data-source decision,"
 * and no public, stable autocomplete endpoint was found safe to depend on
 * during research (researchDigitalMarketingPro.md §4).
 *
 * Works identically for iOS and Android — everything here is store-agnostic,
 * dispatching only through storeClient.ts.
 */
import type { LLM, Tool } from '@page-agent/llms'
import { z } from 'zod'

import {
	excludeOwnCategoryName,
	ngramPhrases,
	normalizeKeywordTerm,
	scoreKeyword,
	significantWords,
	tierForScore,
	toSingular,
} from './scoring'
import { extractCaptionKeywordSeeds } from './screenshotCaptions'
import { lookupStoreApp, searchStoreApps } from './storeClient'
import type {
	AppMarketingContext,
	KeywordCandidate,
	KeywordIntent,
	ScreenshotCaption,
	StoreAppDetail,
} from './types'

const LLM_TIMEOUT_MS = 60_000
const MAX_COMPETITORS = 5
const SCORING_CONCURRENCY = 5
/**
 * Cap on how many competitor-metadata-mined phrases feed into scoring — each
 * kept phrase costs a live store search (see the bounded-concurrency scoring
 * loop below), so an uncapped mine of several competitors' full descriptions
 * could produce hundreds of candidates. Phrases used by *more* competitors
 * are kept first (see `mineCompetitorMetadataKeywords`), so the cap trims the
 * weakest, least-corroborated candidates, not an arbitrary slice.
 */
const MAX_COMPETITOR_METADATA_TERMS = 30

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once —
 * bounded parallelism instead of either fully sequential (slow: N round
 * trips end-to-end) or a single unbounded `Promise.all` (risks hammering the
 * store's search endpoint with dozens of simultaneous requests).
 */
async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R | null>
): Promise<R[]> {
	const results: R[] = []
	let index = 0
	async function worker() {
		while (index < items.length) {
			const item = items[index++]
			const result = await fn(item)
			if (result !== null) results.push(result)
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
	return results
}

/**
 * Look up the user-named competitors on the app's store — feeds keyword-
 * generation context, competitor-metadata mining below, and niche scoring.
 * Fetches each competitor's full listing *detail*, not just its thin search-
 * result shape: `lookupStoreApp` gives a fuller description on both stores
 * (and, on Android specifically, a materially longer one — `searchPlayApps`
 * parses a positional array slot that can be a truncated summary, while
 * `lookupPlayApp` walks the whole detail blob for the longest description
 * string it can find; see googlePlayClient.ts). More/better description text
 * directly means better competitor-metadata keyword mining below. One
 * competitor failing to resolve doesn't abort discovery (per research
 * §1.1's precedent), but the failure is still logged, not silently discarded
 * (AGENTS.md); a detail-lookup failure specifically falls back to the
 * cheaper search-result shape rather than dropping the competitor.
 */
async function lookupCompetitors(ctx: AppMarketingContext): Promise<StoreAppDetail[]> {
	const names = ctx.competitors
		.split(',')
		.map((c) => c.trim())
		.filter(Boolean)
		.slice(0, MAX_COMPETITORS)

	return mapWithConcurrency(names, MAX_COMPETITORS, async (name) => {
		try {
			const results = await searchStoreApps(ctx.store, name, ctx.storeCountry, 1)
			const match = results[0]
			if (!match) return null
			try {
				const detail = await lookupStoreApp(ctx.store, match.id, ctx.storeCountry)
				return detail ?? match
			} catch (err) {
				console.warn(
					`[digitalMarketingPro] competitor detail lookup failed for "${name}", using search result instead:`,
					err
				)
				return match
			}
		} catch (err) {
			console.warn(`[digitalMarketingPro] competitor lookup failed for "${name}":`, err)
			return null
		}
	})
}

/**
 * Mines keyword-candidate phrases directly from competitors' own listing
 * text (title + full description) — the "successful apps already reveal
 * keywords with proven demand" idea: if a term already appears in
 * successful, top-ranking apps' own metadata, that's a term the store
 * algorithm has already rewarded those apps for, rather than an untested
 * guess. Phrases used by more of the named competitors are kept first (the
 * strongest cross-app corroboration of real demand), then truncated to
 * `MAX_COMPETITOR_METADATA_TERMS` to bound the live scoring cost below.
 * Title words/phrases and description phrases are pooled together per app
 * before counting, so a term appearing in both a competitor's title and its
 * description still only counts once for that competitor (not double-counted
 * toward "used by N competitors").
 */
function mineCompetitorMetadataKeywords(competitors: StoreAppDetail[]): string[] {
	const competitorCountByPhrase = new Map<string, number>()
	for (const app of competitors) {
		const phrasesForApp = new Set<string>()
		if (app.title) {
			for (const word of significantWords(app.title)) phrasesForApp.add(word)
			for (const phrase of ngramPhrases(app.title, 2, 3)) phrasesForApp.add(phrase)
		}
		if (app.description) {
			for (const phrase of ngramPhrases(app.description, 2, 3)) phrasesForApp.add(phrase)
		}
		for (const phrase of phrasesForApp) {
			competitorCountByPhrase.set(phrase, (competitorCountByPhrase.get(phrase) ?? 0) + 1)
		}
	}
	return [...competitorCountByPhrase.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_COMPETITOR_METADATA_TERMS)
		.map(([phrase]) => phrase)
}

/** Step 1: generate candidate keyword strings from the app's own context, plus whatever competitor apps resolved above. True vision (screenshot pixel) input is still deferred — see screenshotCaptions.ts's doc comment — but user-typed caption text is folded in separately, after this function returns, by `mergeSeedsWithProvenance` below. */
async function generateSeedKeywords(
	llm: LLM,
	ctx: AppMarketingContext,
	competitors: StoreAppDetail[]
): Promise<string[]> {
	const tool: Tool<{ keywords: string[] }, { keywords: string[] }> = {
		description: 'Return the best App Store search keywords for this app.',
		inputSchema: z.object({
			keywords: z.array(z.string().min(2).max(40)).min(5).max(25),
		}),
		execute: async (args) => args,
	}

	const storeName = ctx.store === 'ios' ? 'Apple App Store' : 'Google Play'
	const system =
		`You are an ${storeName} Optimization keyword researcher. Given an app's context, generate exact ` +
		'search phrases real users would type to find it. Exclude generic "<name> app"-style phrases and ' +
		"the app's own store category name. Target a 95%+ relevancy bar. Include both short-tail and " +
		'long-tail phrasings.'

	const competitorLines = competitors
		.map((c) => `- ${c.title}: ${c.description.slice(0, 200)}`)
		.join('\n')

	const user = [
		`App: ${ctx.name}`,
		`Category: ${ctx.category}`,
		`Description: ${ctx.description}`,
		`Audience: ${ctx.audience}`,
		competitorLines ? `Competitor apps for inspiration:\n${competitorLines}` : '',
	]
		.filter(Boolean)
		.join('\n')

	const result = await llm.invoke(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		],
		{ generate_app_keywords: tool },
		AbortSignal.timeout(LLM_TIMEOUT_MS),
		{ toolChoiceName: 'generate_app_keywords' }
	)
	return (result.toolResult as { keywords: string[] }).keywords
}

interface KeywordClassification {
	relevance: number
	intent: KeywordIntent
}

/** Step 2: one batched LLM call scoring relevance + search intent for every candidate term (design doc §4.2's fourth scoring dimension). */
async function classifyKeywords(
	llm: LLM,
	ctx: AppMarketingContext,
	terms: string[]
): Promise<Record<string, KeywordClassification>> {
	if (terms.length === 0) return {}

	const tool: Tool<
		{ items: { term: string; relevance: number; intent: KeywordIntent }[] },
		{ items: { term: string; relevance: number; intent: KeywordIntent }[] }
	> = {
		description: "Score each keyword's relevance to the app and classify its search intent.",
		inputSchema: z.object({
			items: z
				.array(
					z.object({
						term: z.string(),
						relevance: z.number().min(0).max(1),
						intent: z.enum(['informational', 'transactional', 'unknown']),
					})
				)
				.min(1),
		}),
		execute: async (args) => args,
	}

	const system =
		'For each keyword, score how relevant it is to the app (0 = irrelevant, 1 = perfect fit), and ' +
		'classify its search intent: "informational" (e.g. "how to edit photos") vs. "transactional" ' +
		'(e.g. "photo editor app") vs. "unknown" if unclear. Return one entry per keyword, using the ' +
		'exact term text given.'
	const user = `App: ${ctx.name} — ${ctx.description}\n\nKeywords:\n${terms.map((t) => `- ${t}`).join('\n')}`

	const result = await llm.invoke(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		],
		{ classify_keywords: tool },
		AbortSignal.timeout(LLM_TIMEOUT_MS),
		{ toolChoiceName: 'classify_keywords' }
	)
	const { items } = result.toolResult as {
		items: { term: string; relevance: number; intent: KeywordIntent }[]
	}
	const map: Record<string, KeywordClassification> = {}
	for (const item of items) map[item.term] = { relevance: item.relevance, intent: item.intent }
	return map
}

/**
 * Merges seed terms from every source (LLM generation, screenshot captions,
 * competitor-metadata mining, ...) into one deduped list, tracking which
 * source(s) contributed each surviving term — so candidates built from it get
 * an accurate `sources` tag instead of everything being labeled with just one
 * source regardless of where it actually came from. Dedup treats singular and
 * plural forms of the same word as one candidate (design doc §4.2 / research
 * §7.1's "prefer singular forms" rule) — kept term text is whichever group
 * listed it first, so group order doubles as a wording-priority order;
 * callers should list the source whose phrasing is most
 * "app-store-keyword-shaped" first.
 */
function mergeSeedsWithProvenance(sourceGroups: { terms: string[]; source: string }[]): {
	terms: string[]
	sourcesByTerm: Map<string, string[]>
} {
	const seenSingular = new Map<string, string>() // singular key -> kept literal term
	const sourcesByTerm = new Map<string, string[]>()
	const terms: string[] = []

	function add(term: string, source: string) {
		const norm = normalizeKeywordTerm(term)
		if (!norm) return
		const singular = toSingular(norm)
		const existing = seenSingular.get(singular)
		if (existing) {
			const sources = sourcesByTerm.get(existing)!
			if (!sources.includes(source)) sources.push(source)
			return
		}
		seenSingular.set(singular, term)
		sourcesByTerm.set(term, [source])
		terms.push(term)
	}

	for (const group of sourceGroups) {
		for (const term of group.terms) add(term, group.source)
	}

	return { terms, sourcesByTerm }
}

export interface KeywordDiscoveryResult {
	candidates: KeywordCandidate[]
	competitorApps: StoreAppDetail[]
	excludedCategoryTerms: string[]
}

export async function discoverKeywords(
	llm: LLM,
	ctx: AppMarketingContext,
	onProgress?: (message: string) => void,
	screenshotCaptions: ScreenshotCaption[] = []
): Promise<KeywordDiscoveryResult> {
	onProgress?.('Looking up competitors…')
	const competitorApps = await lookupCompetitors(ctx)

	onProgress?.('Generating candidate keywords…')
	const seedTerms = await generateSeedKeywords(llm, ctx, competitorApps)
	const captionTerms = extractCaptionKeywordSeeds(screenshotCaptions)
	const competitorMetadataTerms = mineCompetitorMetadataKeywords(competitorApps)
	// mergeSeedsWithProvenance already dedupes singular/plural across every
	// source (it needs to, to merge sources correctly) — no separate dedup
	// pass needed here.
	const { terms: mergedTerms, sourcesByTerm } = mergeSeedsWithProvenance([
		{ terms: seedTerms, source: 'llm-generated' },
		{ terms: competitorMetadataTerms, source: 'competitor-metadata' },
		{ terms: captionTerms, source: 'screenshot-caption' },
	])
	const { kept, excluded } = excludeOwnCategoryName(mergedTerms, ctx.category)

	onProgress?.('Scoring relevance and intent…')
	const classification = await classifyKeywords(llm, ctx, kept)

	onProgress?.(`Scoring ${kept.length} keyword(s)…`)
	// Bounded-concurrency rather than one-at-a-time-with-a-fixed-delay: each
	// term's store lookup is independent, so running a handful in parallel
	// meaningfully cuts wall-clock time for a user-triggered action without
	// unboundedly hammering the store's search endpoint.
	const candidates = await mapWithConcurrency(kept, SCORING_CONCURRENCY, async (term) => {
		onProgress?.(`Scoring "${term}"…`)
		try {
			const rankedApps = await searchStoreApps(ctx.store, term, ctx.storeCountry, 50)
			const cls = classification[term] ?? { relevance: 0.5, intent: 'unknown' as const }
			const score = scoreKeyword(term, rankedApps, ctx.storeAppId, cls.relevance, cls.intent)
			const candidate: KeywordCandidate = {
				id: crypto.randomUUID(),
				term,
				sources: sourcesByTerm.get(term) ?? ['llm-generated'],
				score,
				tier: tierForScore(score.overall, cls.relevance),
			}
			return candidate
		} catch (err) {
			console.warn(`[digitalMarketingPro] scoring failed for keyword "${term}":`, err)
			return null
		}
	})

	candidates.sort((a, b) => b.score.overall - a.score.overall)
	return { candidates, competitorApps, excludedCategoryTerms: excluded }
}
