/**
 * Shared types for Digital Marketing Pro's business logic.
 * See packages/extension/docs/designDigitalMarketingPro.md for the requirements
 * these implement, and researchDigitalMarketingPro.md for the evidence behind them.
 */

export type DmpGoal = 'visibility' | 'conversion' | 'brand'

/** Which store this app is tracked on — the UI and scoring both branch on this (e.g. iOS's dedicated keyword field has no Google Play equivalent). */
export type StoreId = 'ios' | 'android'

/** Per-app shared context (design doc §4.1) — read by every other feature instead of re-asking. */
export interface AppMarketingContext {
	store: StoreId
	name: string
	category: string
	description: string
	audience: string
	/** Comma-separated competitor app names, as typed by the user. */
	competitors: string
	goal: DmpGoal
	/** iOS numeric track id, or the Android package name — enables rank/position lookups. Optional. */
	storeAppId?: string
	/** Storefront country code, e.g. "us". */
	storeCountry: string
}

/**
 * One app returned from a store search/lookup, normalized across the two
 * store clients (itunesClient.ts, googlePlayClient.ts) so scoring.ts and the
 * discovery pipeline don't need to branch on store type.
 */
export interface StoreApp {
	/** iOS numeric trackId (as a string) or Android package name. */
	id: string
	title: string
	description: string
	/** 0-5. */
	rating: number
	/**
	 * Traffic/volume proxy fed into scoring.ts's log-normalization. iOS: real
	 * review count. Android: Play's search results don't expose a review
	 * count, so this is the parsed install-count floor (e.g. "10,000,000+" ->
	 * 10000000) instead — an explicit approximation, not a review count, see
	 * googlePlayClient.ts's module doc comment.
	 */
	popularitySignal: number
}

/**
 * A single-app lookup (`lookupStoreApp`/`storeClient.ts`) returns a few extra
 * fields beyond `StoreApp` that only the detail page/endpoint exposes, not
 * the search results — used by audit.ts. All optional: not every store or
 * every app response includes them (see each client's doc comments for what
 * "best effort" means here, especially on the Android side).
 */
export interface StoreAppDetail extends StoreApp {
	category?: string
	/** iOS: a real artwork URL from the iTunes lookup response. Android: left undefined — not wired up yet (Play's icon lives inside the same scraped blob as everything else in googlePlayClient.ts, but hasn't been extracted; nothing stops it, just not done). */
	iconUrl?: string
	/**
	 * ISO date string of the app's most recent update. iOS: a real,
	 * documented API field (`currentVersionReleaseDate`). Android: left
	 * undefined — see googlePlayClient.ts's doc comment on why its one
	 * scraped date field is used for `releaseDate` instead, not this, given
	 * real ambiguity about which of the two it actually represents.
	 */
	lastUpdated?: string
	/**
	 * ISO date string of the app's original release. iOS: a real, documented
	 * API field (`releaseDate`). Android: best-effort, scraped, unverified
	 * which of release-vs-update date it actually is — see
	 * googlePlayClient.ts.
	 */
	releaseDate?: string
	/** ISO 639-1 codes of supported store-listing languages. iOS only — see designDigitalMarketingPro.md's localization audit note. */
	languages?: string[]
}

export type KeywordTier = 'primary' | 'secondary' | 'long-tail' | 'aspirational'
export type KeywordIntent = 'informational' | 'transactional' | 'unknown'

/** Four scoring dimensions per design doc §4.2 — volume/difficulty/relevance/intent. */
export interface KeywordScore {
	/** 0-100, log-normalized from competitor review-count volume. */
	traffic: number
	/** 0-100, weighted from competitor rating + traffic + keyword-usage rate. */
	difficulty: number
	/**
	 * 0-1, how well the term matches the app's own function (LLM-classified).
	 * Undefined for ad-hoc lookups that skip the LLM classification step
	 * (KeywordAnalysisPanel, fetchKeywordRankingSummary) — left unset rather
	 * than fabricated, per this project's "no fake-precise numbers" principle.
	 */
	relevance?: number
	/** Undefined for the same ad-hoc, unclassified lookups as `relevance`. */
	intent?: KeywordIntent
	/** 0-100 weighted composite ("potential") — drives tiering. */
	overall: number
	/**
	 * 0-1, fraction of the term's current top-10 ranked apps that already use
	 * it in their title/description — already computed inside `scoreKeyword`
	 * to derive `difficulty`, but also exposed on its own here because it's
	 * the "proven demand" signal: a high-traffic term already heavily used by
	 * successful, top-ranking apps is one where ASO/Apple Search Ads (riding
	 * demand competitors already validated) beats paying to manufacture new
	 * demand via Meta/TikTok ads. See `isProvenDemandKeyword` in scoring.ts.
	 */
	usageRate: number
}

export interface KeywordCandidate {
	id: string
	term: string
	/** Provenance tags, e.g. "llm-generated" (design doc §4.2 — tagged, not pooled anonymously). */
	sources: string[]
	score: KeywordScore
	tier: KeywordTier
}

export interface ListingContent {
	title: string
	/** iOS subtitle, or Android's short description — same slot, different store terminology. */
	subtitle: string
	description: string
	/** iOS-only hidden 100-char field. Google Play has no equivalent — omitted for Android apps. */
	keywordField?: string
}

export interface PolicyLintIssue {
	severity: 'block' | 'warning'
	message: string
}

/** Where a screenshot caption sits — the OCR-weighted top/bottom band vs. the rest (design doc §4.2's screenshot-caption-optimization section). */
export type ScreenshotPosition = 'top' | 'middle' | 'bottom'

/**
 * One screenshot caption, as typed in by the user rather than OCR'd from the
 * actual screenshot image. `@page-agent/llms`'s `Message.content` is
 * text-only (no image-input support yet), so this package can't run real
 * vision-based caption extraction — see screenshotCaptions.ts's module doc
 * and designDigitalMarketingPro.md §8.12 for why this is manual entry, not
 * automated OCR, for now.
 */
export interface ScreenshotCaption {
	id: string
	position: ScreenshotPosition
	text: string
}
