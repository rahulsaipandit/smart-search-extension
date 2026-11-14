/**
 * Keyword scoring — public-data-only formula adapted from the "app-agent"
 * approach surveyed in researchDigitalMarketingPro.md §6.1 (traffic from
 * competitor review-count volume, difficulty from rating+traffic+keyword-usage
 * rate, position from a log2 decay, overall as a weighted composite with a
 * reward cross-term). Chosen over the Apple Search Ads-derived approaches
 * (§8.1) because it needs no advertiser account or paid vendor — see
 * designDigitalMarketingPro.md §8.1 for the full comparison and the plan to
 * revisit this formula once that data-source question is settled.
 */
import type { KeywordIntent, KeywordScore, KeywordTier, StoreApp } from './types'

const MAX_REVIEWS_FOR_TRAFFIC_NORM = 1_000_000

function normalizeLog(value: number, max: number): number {
	if (value <= 0) return 0
	return Math.min(1, Math.log(value + 1) / Math.log(max + 1))
}

/** Exported so any caller building a RegExp from user-controlled/store-fetched text (e.g. audit.ts's brand-name check) doesn't crash or mismatch on regex metacharacters. */
export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Exported for keywordAnalysis.ts's per-app "used in title?" breakdown, in addition to its use in the aggregate usage-rate calculation below. */
export function matchesWord(text: string, term: string): boolean {
	return new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text)
}

/**
 * Single canonical singularization + stop-word list, shared by
 * contentGeneration.ts's keyword-field packer and audit.ts's metadata
 * checks — previously each kept its own near-identical copy, which risked
 * the two silently disagreeing after a future edit to one but not the other.
 */
export function toSingular(word: string): string {
	return word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word
}

export const STOP_WORDS = new Set([
	'the',
	'a',
	'an',
	'and',
	'or',
	'for',
	'of',
	'to',
	'in',
	'on',
	'with',
	'app',
	'apps',
	'your',
	'you',
])

function round1(n: number): number {
	return Math.round(n * 10) / 10
}

/**
 * Splits text into meaningful lowercase words — filters stop-words and very
 * short tokens. Shared by screenshotCaptions.ts's caption-keyword extraction
 * and keywordDiscovery.ts's competitor-metadata mining, so both "what counts
 * as a meaningful word" decisions can't drift apart from each other.
 */
export function significantWords(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9']+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

/**
 * Contiguous n-word phrases (minN..maxN) from a text's significant words —
 * shared by screenshotCaptions.ts (caption keyword-seed extraction and
 * cross-caption repetition detection) and keywordDiscovery.ts
 * (competitor-metadata keyword mining).
 */
export function ngramPhrases(text: string, minN: number, maxN: number): string[] {
	const words = significantWords(text)
	const phrases: string[] = []
	for (let n = minN; n <= maxN; n++) {
		for (let i = 0; i + n <= words.length; i++) {
			phrases.push(words.slice(i, i + n).join(' '))
		}
	}
	return phrases
}

/**
 * Score one keyword from its current top-ranking apps. Works identically for
 * both stores against the normalized `StoreApp` shape — see that type's doc
 * comment for what `popularitySignal` means on each store.
 * `targetAppId` is the tracked app's own store id, if known — used to
 * compute a position score when the app already ranks for this term.
 * `relevance`/`intent` are the LLM classification from keyword discovery;
 * omit them for ad-hoc lookups that skip that step (no LLM call available/
 * needed) — `traffic`/`difficulty`/`overall` never depend on either, so
 * leaving them undefined doesn't degrade this function's other output, it
 * just avoids fabricating a fake classification for terms nothing ever
 * looked at.
 */
export function scoreKeyword(
	term: string,
	rankedApps: StoreApp[],
	targetAppId: string | undefined,
	relevance?: number,
	intent?: KeywordIntent
): KeywordScore {
	const top10 = rankedApps.slice(0, 10)

	const totalPopularity = top10.reduce((sum, a) => sum + a.popularitySignal, 0)
	const traffic = normalizeLog(totalPopularity, MAX_REVIEWS_FOR_TRAFFIC_NORM) * 100

	const avgRating = top10.length ? top10.reduce((sum, a) => sum + a.rating, 0) / top10.length : 0
	const usageRate = top10.length
		? top10.filter((a) => matchesWord(a.title, term) || matchesWord(a.description, term)).length /
			top10.length
		: 0

	const difficulty = (avgRating / 5) * 40 + (traffic / 100) * 30 + usageRate * 30

	const position = targetAppId ? rankedApps.findIndex((a) => a.id === targetAppId) + 1 : 0
	const positionScore = position > 0 ? Math.max(0, 10 - Math.log2(position)) * 10 : 0

	const rewardTerm = (positionScore / 100) * (difficulty / 100) * 100
	const overall = traffic * 0.3 + positionScore * 0.3 + difficulty * 0.2 + rewardTerm * 0.2

	return {
		traffic: round1(traffic),
		difficulty: round1(difficulty),
		relevance,
		intent,
		overall: round1(overall),
		usageRate: round1(usageRate),
	}
}

/**
 * Thresholds marking a keyword as "proven demand": real, already-measured
 * search volume (`traffic`) AND heavy existing usage by the apps that
 * already rank for it (`usageRate`) — i.e. successful, top-ranking apps have
 * already validated that people search this term and that using it in your
 * metadata works. For a term like this, ASO (organic) and Apple Search Ads
 * (bidding into demand that already exists) are a more efficient bet than
 * paying to manufacture new demand from scratch via Meta/TikTok ads — the
 * whole point of mining competitor-metadata keywords in keywordDiscovery.ts.
 */
export const PROVEN_DEMAND_TRAFFIC_THRESHOLD = 50
export const PROVEN_DEMAND_USAGE_RATE_THRESHOLD = 0.3

export function isProvenDemandKeyword(score: KeywordScore): boolean {
	return (
		score.traffic >= PROVEN_DEMAND_TRAFFIC_THRESHOLD &&
		score.usageRate >= PROVEN_DEMAND_USAGE_RATE_THRESHOLD
	)
}

/**
 * Tiering thresholds per designDigitalMarketingPro.md §4.2, adapted from the
 * numeric cutoffs in researchDigitalMarketingPro.md §9.1 (borghei's
 * keyword_analyzer.py): potential >=70 and relevance >=0.8 -> primary;
 * 50-70 -> secondary; the rest split into long-tail vs. aspirational.
 */
export function tierForScore(overall: number, relevance: number): KeywordTier {
	if (overall >= 70 && relevance >= 0.8) return 'primary'
	if (overall >= 50) return 'secondary'
	if (overall >= 25) return 'long-tail'
	return 'aspirational'
}

export function normalizeKeywordTerm(term: string): string {
	return term.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Exclude the app's own store category name — Apple indexes category
 * membership automatically, so targeting it wastes keyword budget
 * (design doc §4.2 / research §7.1).
 */
export function excludeOwnCategoryName(
	terms: string[],
	category: string
): { kept: string[]; excluded: string[] } {
	const cat = normalizeKeywordTerm(category)
	const kept: string[] = []
	const excluded: string[] = []
	for (const term of terms) {
		if (cat && normalizeKeywordTerm(term) === cat) excluded.push(term)
		else kept.push(term)
	}
	return { kept, excluded }
}
