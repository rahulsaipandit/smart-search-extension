/**
 * On-demand listing audit (design doc §4.2's `aso-audit`-inspired feature,
 * scoped per explicit direction into four categories rather than the
 * original 10-factor breakdown): Metadata (title/subtitle/description),
 * Keyword selection strategy + live rankings, Health (update frequency,
 * ratings, legacy/launch date), and Localizations (iOS only for now — Google
 * Play's public listing page doesn't expose supported-locale metadata the
 * way iTunes lookup does, see googlePlayClient.ts).
 *
 * Deliberately deterministic, no LLM call: every check here is a rule
 * applied to real fetched data (the app's own live listing, its target
 * keyword set, live search results) — consistent with this project's
 * "coarse tiers, not fake-precise numbers" principle (designDigitalMarketingPro.md
 * §4.7) and its general preference for explainable, inspectable scoring
 * over an opaque model call wherever a plain rule suffices.
 */
import { FIELD_LIMITS } from './contentGeneration'
import { STOP_WORDS as SHARED_STOP_WORDS, escapeRegExp, scoreKeyword } from './scoring'
import { buildScreenshotCaptionChecks } from './screenshotCaptions'
import { lookupStoreApp, searchStoreApps } from './storeClient'
import type {
	AppMarketingContext,
	KeywordCandidate,
	ScreenshotCaption,
	StoreAppDetail,
} from './types'

export type AuditStatus = 'good' | 'warning' | 'critical' | 'unknown'
export type AuditCategory = 'metadata' | 'keywords' | 'health' | 'localization' | 'screenshots'

export interface AuditCheck {
	id: string
	category: AuditCategory
	label: string
	/** Short current-value display, e.g. the title text, or "4.6 (12,345)". */
	value: string
	status: AuditStatus
	findings: string[]
	/** 0-100, derived from `status` via `statusToScore` — deliberately coarse (3 bands), not a fabricated continuous number, consistent with this project's "coarse, not fake-precise" principle. Attached centrally in `runAudit`, not per check-function. */
	score: number
	/**
	 * True for a check that can never resolve to a real pass/fail from more
	 * data or more user input — a standing reminder to manually verify
	 * something this audit has no automated way to check (e.g. visual
	 * screenshot legibility — see screenshotCaptions.ts's
	 * `checkLegibilityReminder`), not a "not enough data yet" gap that
	 * closes on its own (like a brand-new app's ratings, which is plain
	 * `'unknown'` without this flag). Excluded from `scorableChecks` — and
	 * therefore from the overall/category score average and
	 * `buildActionCentre` — so a check that can never be "fixed" doesn't cap
	 * how high the audit score can go or permanently occupy an action-item
	 * slot. The UI shows these separately instead, as a persistent
	 * "manual review" note.
	 */
	manualCheck?: boolean
}

/**
 * Checks that count toward the score average and the Action Centre —
 * excludes standing "manual review" reminders that can never resolve (see
 * `AuditCheck.manualCheck`). Callers computing an overall/category score, or
 * a "N of M checks passing" count, should use this instead of the report's
 * raw `checks` array.
 */
export function scorableChecks(checks: AuditCheck[]): AuditCheck[] {
	return checks.filter((c) => !c.manualCheck)
}

/** Coarse 3-band mapping used both for each check's own `score` and the overall report score. */
export function statusToScore(status: AuditStatus): number {
	switch (status) {
		case 'good':
			return 100
		case 'warning':
			return 60
		case 'critical':
			return 20
		default:
			return 70
	}
}

/**
 * What each individual `checkXxx` function builds — `score` is attached
 * centrally in `runAudit` (a single `.map()`) rather than repeated in every
 * function, so the status→score mapping can't drift between checks.
 * Exported so screenshotCaptions.ts's checks share the exact same shape.
 */
export type CheckDraft = Omit<AuditCheck, 'score'>

export interface AuditReport {
	generatedAt: number
	appSummary: {
		title: string
		rating: number
		ratingCount: number
		category?: string
		iconUrl?: string
	}
	checks: AuditCheck[]
	/** Null when the app has no storeAppId set yet — most checks fall back to saved draft data and say so explicitly rather than silently using stale/incomplete info. */
	usedLiveListing: boolean
}

function daysBetween(a: Date, b: Date): number {
	return Math.round((a.getTime() - b.getTime()) / 86_400_000)
}

function checkTextField(
	id: AuditCheck['id'],
	label: string,
	text: string,
	limit: number,
	brandName?: string
): CheckDraft {
	const usagePct = limit > 0 ? Math.round((text.length / limit) * 100) : 0
	const words = text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
	const stopWordsUsed = words.filter((w) => SHARED_STOP_WORDS.has(w))
	const usesBrand = brandName
		? new RegExp(`\\b${escapeRegExp(brandName)}\\b`, 'i').test(text)
		: false

	const findings: string[] = []
	let status: AuditStatus = 'good'

	if (!text) {
		findings.push(`${label} is empty.`)
		status = 'critical'
	} else {
		if (usagePct < 80) {
			findings.push(
				`${label} is not using the character limit effectively (${text.length} out of ${limit} characters).`
			)
			status = 'warning'
		} else {
			findings.push(
				`${label} is using its character budget well (${text.length} out of ${limit} characters).`
			)
		}
		if (stopWordsUsed.length > 0) {
			findings.push(
				`${label} contains stop word(s) (${[...new Set(stopWordsUsed)].join(', ')}) — removing them frees up character budget for keywords.`
			)
			if (status === 'good') status = 'warning'
		} else {
			findings.push(
				`${label} does not have stop word(s), which means character limit is not being wasted.`
			)
		}
		if (brandName) {
			findings.push(
				usesBrand ? `${label} includes the brand name.` : `${label} is not using a brand name.`
			)
		}
	}

	return { id, category: 'metadata', label, value: text || '(empty)', status, findings }
}

function checkRatingsAndReviews(detail: StoreAppDetail): CheckDraft {
	// A brand-new app with zero ratings/reviews isn't a *bad* app — there's simply
	// no signal yet, the same "not enough data" situation checkUpdateRecency/
	// checkLegacyScore already treat as 'unknown' rather than penalizing. Scoring
	// it 'critical' (as the generic low-rating branch below would) unfairly tanks
	// the whole audit for every not-yet-launched app, conflating "no reviews yet"
	// with "reviews that are actually bad."
	if (detail.popularitySignal === 0) {
		return {
			id: 'ratingsAndReviews',
			category: 'health',
			label: 'Ratings & Reviews',
			value: 'No ratings yet',
			status: 'unknown',
			findings: [
				'App has no ratings or reviews yet — too new to judge on this dimension. Prompting early users for a review will start building this signal.',
			],
		}
	}

	const findings: string[] = []
	let status: AuditStatus = 'good'

	if (detail.rating >= 4.5) {
		findings.push(
			`App rating is high enough for good visibility (${detail.rating.toFixed(2)} out of 5, recommended 4.5+).`
		)
	} else if (detail.rating >= 3.5) {
		findings.push(
			`App rating is acceptable but below the recommended threshold (${detail.rating.toFixed(2)} out of 5, recommended 4.5+).`
		)
		status = 'warning'
	} else {
		findings.push(
			`App rating is low (${detail.rating.toFixed(2)} out of 5, recommended 4.5+) — this can actively hurt ranking.`
		)
		status = 'critical'
	}

	if (detail.popularitySignal >= 1000) {
		findings.push(
			`App has enough ratings/reviews to compete for high-traffic, difficult keywords (${detail.popularitySignal.toLocaleString()} vs. a recommended 1,000+).`
		)
	} else {
		findings.push(
			`App has relatively few ratings/reviews so far (${detail.popularitySignal.toLocaleString()} vs. a recommended 1,000+) — competing for high-difficulty keywords will be harder until this grows.`
		)
		if (status === 'good') status = 'warning'
	}

	return {
		id: 'ratingsAndReviews',
		category: 'health',
		label: 'Ratings & Reviews',
		value: `${detail.rating.toFixed(2)} (${detail.popularitySignal.toLocaleString()})`,
		status,
		findings,
	}
}

function checkUpdateRecency(detail: StoreAppDetail): CheckDraft {
	if (!detail.lastUpdated) {
		return {
			id: 'updateRecency',
			category: 'health',
			label: 'Last Update Recency',
			value: 'Not available',
			status: 'unknown',
			findings: ['Update-recency data is not reliably available for this store yet.'],
		}
	}
	const days = daysBetween(new Date(), new Date(detail.lastUpdated))
	let status: AuditStatus = 'good'
	let message: string
	if (days <= 30) {
		message = `App has been updated recently, signalling positive focus to store algorithms (<30 days ago).`
	} else if (days <= 180) {
		message = `App was last updated ${days} days ago — still reasonably fresh, but updating more often can help.`
		status = 'warning'
	} else {
		message = `App hasn't been updated in over 6 months (${days} days) — stale apps can lose ranking priority.`
		status = 'critical'
	}
	return {
		id: 'updateRecency',
		category: 'health',
		label: 'Last Update Recency',
		value: new Date(detail.lastUpdated).toLocaleDateString(),
		status,
		findings: [message],
	}
}

function checkLegacyScore(detail: StoreAppDetail): CheckDraft {
	if (!detail.releaseDate) {
		return {
			id: 'legacyScore',
			category: 'health',
			label: 'Legacy Score (Launch Date)',
			value: 'Not available',
			status: 'unknown',
			findings: ['Launch-date data is not reliably available for this store yet.'],
		}
	}
	const years = daysBetween(new Date(), new Date(detail.releaseDate)) / 365
	let status: AuditStatus = 'good'
	let message: string
	if (years >= 2) {
		message = `App is old enough to benefit from legacy/trust effects (~${years.toFixed(1)} years old).`
	} else {
		message = `App is not yet old enough to gain from legacy effects (~${years.toFixed(1)} years old, typically 2+ years helps).`
		status = 'warning'
	}
	return {
		id: 'legacyScore',
		category: 'health',
		label: 'Legacy Score (Launch Date)',
		value: new Date(detail.releaseDate).toLocaleDateString(),
		status,
		findings: [message],
	}
}

function checkLocalizations(detail: StoreAppDetail): CheckDraft {
	const languages = detail.languages ?? []
	const status: AuditStatus = languages.length > 1 ? 'good' : 'warning'
	return {
		id: 'localizations',
		category: 'localization',
		label: 'Localizations',
		value: languages.length ? languages.join(',') : 'Unknown',
		status,
		findings:
			languages.length > 1
				? [`App has ${languages.length} localizations — good reach across markets.`]
				: [
						`App appears to support only ${languages.length || 'an unknown number of'} language(s) — consider localizing your metadata for more markets.`,
					],
	}
}

function checkDescription(
	text: string,
	limit: number,
	store: AppMarketingContext['store']
): CheckDraft {
	const usagePct = limit > 0 ? Math.round((text.length / limit) * 100) : 0
	const indexingNote =
		store === 'ios'
			? "While not directly indexed by the App Store's own search ranking, keywords in a long iOS description can still help discovery via Google/web search."
			: 'Google Play indexes your full description for keyword matching directly, unlike iOS — keyword placement here carries real ranking weight.'
	const findings = [
		usagePct < 50
			? `Description is not using the character limit effectively (${text.length} out of ${limit} characters). ${indexingNote}`
			: `Description makes reasonable use of its character budget (${text.length} out of ${limit} characters). ${indexingNote}`,
	]
	return {
		id: 'description',
		category: 'metadata',
		label: 'Description',
		value: text,
		status: usagePct < 50 ? 'warning' : 'good',
		findings,
	}
}

function checkKeywordStrategy(candidates: KeywordCandidate[], targetIds: string[]): CheckDraft {
	const targets = candidates.filter((c) => targetIds.includes(c.id))
	const primaryCount = targets.filter((c) => c.tier === 'primary').length
	const findings: string[] = []
	let status: AuditStatus = 'good'

	if (targets.length === 0) {
		findings.push(
			'No target keywords selected yet — run keyword discovery and pick a target set first.'
		)
		status = 'critical'
	} else {
		findings.push(`${targets.length} target keyword(s) selected (${primaryCount} primary).`)
		if (primaryCount === 0) {
			findings.push(
				'No primary-tier keyword selected — pick at least one high-potential term for your title.'
			)
			status = 'warning'
		}
	}

	return {
		id: 'keywordStrategy',
		category: 'keywords',
		label: 'Keyword Selection Strategy',
		value: `${targets.length} selected`,
		status,
		findings,
	}
}

/**
 * Runs every synchronous-ish check (metadata, health, localization, keyword
 * *selection* strategy) against the app's live listing when a store id is
 * set, falling back to saved draft context — and explicitly says which was
 * used. Live per-keyword ranking checks are deliberately NOT included here:
 * they're slow (one store search per keyword) and the UI drives them
 * incrementally via `fetchKeywordRankingSummary`, matching the reference
 * report's per-row loading behavior rather than blocking the whole audit on
 * every keyword resolving first.
 *
 * `savedListing` is the app's own generated/saved content draft (§4.2's
 * Listing Content panel), used for the subtitle check — neither store's
 * public listing API/scrape exposes a "subtitle"/"short description" field
 * distinctly from the main description, so this is the only real source for
 * it; falls back to the app name only when no draft has been generated yet.
 */
export async function runAudit(
	ctx: AppMarketingContext,
	candidates: KeywordCandidate[],
	targetIds: string[],
	savedListing?: { subtitle?: string },
	screenshotCaptions?: ScreenshotCaption[]
): Promise<AuditReport> {
	const limits = FIELD_LIMITS[ctx.store]

	// A transient network/HTTP failure on the live-listing lookup shouldn't fail
	// the whole audit — degrade to the same "no live listing" path as an app
	// with no store id set, rather than throwing out of runAudit entirely.
	let detail: StoreAppDetail | null = null
	let lookupFailed = false
	if (ctx.storeAppId) {
		try {
			detail = await lookupStoreApp(ctx.store, ctx.storeAppId, ctx.storeCountry)
		} catch {
			lookupFailed = true
		}
	}

	const title = detail?.title ?? ctx.name
	const description = detail?.description ?? ctx.description
	const subtitle = savedListing?.subtitle || ctx.name

	const drafts: CheckDraft[] = [
		checkTextField('title', 'Title', title, limits.title, ctx.name),
		checkTextField(
			'subtitle',
			ctx.store === 'ios' ? 'Subtitle' : 'Short description',
			subtitle,
			limits.subtitle
		),
		checkDescription(description, limits.description, ctx.store),
		checkKeywordStrategy(candidates, targetIds),
		...buildScreenshotCaptionChecks(screenshotCaptions ?? []),
	]

	if (detail) {
		drafts.push(checkRatingsAndReviews(detail))
		drafts.push(checkUpdateRecency(detail))
		drafts.push(checkLegacyScore(detail))
		if (ctx.store === 'ios') drafts.push(checkLocalizations(detail))
	} else {
		drafts.push({
			id: 'noLiveListing',
			category: 'health',
			label: 'Live listing data',
			value: 'Unavailable',
			status: 'unknown',
			findings: [
				lookupFailed
					? 'Could not fetch the live listing just now (a temporary network or store error) — ratings, update recency, legacy score, and localization checks are unavailable this run. Try running the audit again.'
					: 'No store id is set for this app yet — ratings, update recency, legacy score, and localization checks need a live listing. Add your App Store id / Google Play package name in setup for a full audit.',
			],
		})
	}

	// Score is attached here, once, for every check — see CheckDraft's doc comment.
	const checks: AuditCheck[] = drafts.map((draft) => ({
		...draft,
		score: statusToScore(draft.status),
	}))

	return {
		generatedAt: Date.now(),
		appSummary: {
			title,
			rating: detail?.rating ?? 0,
			ratingCount: detail?.popularitySignal ?? 0,
			category: detail?.category ?? ctx.category,
			iconUrl: detail?.iconUrl,
		},
		checks,
		usedLiveListing: detail != null,
	}
}

export interface ActionItem {
	checkId: string
	label: string
	/** The check's own most important finding — used as the recommendation's headline. */
	headline: string
	/** Any remaining findings for this check, joined — supporting detail under the headline. */
	detail: string
	priority: 'high' | 'medium' | 'low'
	/**
	 * How much the overall (checks-only) score would rise if this one check
	 * were fully resolved — a real measured delta (this check's score
	 * replaced with 100, the rest held fixed, re-averaged), not a forecast.
	 * Deliberately scoped to `checks` only, not the async keyword-ranking
	 * scores the UI blends in separately — see the caller's own caption for
	 * that scoping note.
	 */
	scoreGain: number
}

/**
 * Ranks every non-"good" *scorable* check into a prioritized action list,
 * each with a measured score-gain estimate — the "Action centre" view.
 * Excludes `manualCheck` reminders internally (via `scorableChecks`) — a
 * check that can never be "fixed" by more data or user action doesn't
 * belong in a list of things to go fix; the UI surfaces those separately.
 * Returns an empty list when every scorable check is already good.
 *
 * `checks` must be the report's *full* check list, not an already-filtered
 * subset — each item's `scoreGain` is this check's score deficit divided by
 * the total *scorable* check count, matching how `overallScore` averages
 * over `scorableChecks(report.checks)` in main.tsx. Passing a partial list
 * (e.g. one category's checks) would silently inflate every gain relative
 * to the real overall-score impact, since the denominator would shrink
 * along with it.
 */
export function buildActionCentre(checks: AuditCheck[]): ActionItem[] {
	const scorable = scorableChecks(checks)
	const totalChecks = scorable.length
	const items = scorable
		.filter((c) => c.status !== 'good')
		.map((c) => ({
			checkId: c.id,
			label: c.label,
			headline: c.findings[0] ?? c.label,
			detail: c.findings.slice(1).join(' '),
			priority: (c.status === 'critical'
				? 'high'
				: c.status === 'warning'
					? 'medium'
					: 'low') as ActionItem['priority'],
			scoreGain: Math.round(((100 - c.score) / totalChecks) * 10) / 10,
		}))
	return items.sort((a, b) => b.scoreGain - a.scoreGain)
}

export interface KeywordRankingSummary {
	country: string
	term: string
	traffic: number
	difficulty: number
	/** Position in the fetched results (1-based), or null if the app wasn't found there or has no storeAppId set. */
	ranking: number | null
}

/** Fetches one target keyword's live traffic/difficulty/ranking — called per-row by the UI so each result can render as it resolves, rather than blocking the audit on the slowest keyword. */
export async function fetchKeywordRankingSummary(
	ctx: AppMarketingContext,
	term: string
): Promise<KeywordRankingSummary> {
	const rankedApps = await searchStoreApps(ctx.store, term, ctx.storeCountry, 50)
	const score = scoreKeyword(term, rankedApps, ctx.storeAppId)
	const position = ctx.storeAppId ? rankedApps.findIndex((a) => a.id === ctx.storeAppId) + 1 : 0
	return {
		country: ctx.storeCountry,
		term,
		traffic: score.traffic,
		difficulty: score.difficulty,
		ranking: position > 0 ? position : null,
	}
}
