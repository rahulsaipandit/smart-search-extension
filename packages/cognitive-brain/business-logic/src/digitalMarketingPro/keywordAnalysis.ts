/**
 * Per-keyword analysis view (the "keyword intelligence" screen) — for one
 * candidate keyword, shows exactly who currently ranks for it and why,
 * alongside the Popularity/Competitiveness scores already computed by
 * scoring.ts. Deliberately does not show estimated revenue or an
 * "advertisers" panel the way commercial ASO dashboards do: this project has
 * no reliable data source for either (see designDigitalMarketingPro.md §4.7's
 * "coarse tiers, not fake-precise numbers" principle) — install/review-count
 * volume and store rank are real, fetched data; revenue never is here.
 */
import { matchesWord } from './scoring'
import type { StoreApp } from './types'

export interface KeywordRankingRow {
	rank: number
	id: string
	title: string
	rating: number
	/** Review count (iOS) or install-count floor (Android) — see StoreApp.popularitySignal's doc comment. */
	popularitySignal: number
	inTitle: boolean
	inDescription: boolean
	isYourApp: boolean
}

/** Build the ranked-apps table for one keyword from a fresh store search — always re-fetched on demand rather than cached, so the table reflects current standings, not whatever was true when discovery last ran. */
export function buildKeywordRankingRows(
	term: string,
	rankedApps: StoreApp[],
	targetAppId: string | undefined
): KeywordRankingRow[] {
	return rankedApps.map((app, index) => ({
		rank: index + 1,
		id: app.id,
		title: app.title,
		rating: app.rating,
		popularitySignal: app.popularitySignal,
		inTitle: matchesWord(app.title, term),
		inDescription: matchesWord(app.description, term),
		isYourApp: targetAppId != null && app.id === targetAppId,
	}))
}
