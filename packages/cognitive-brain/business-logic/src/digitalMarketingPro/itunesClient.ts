/**
 * Thin client for Apple's public iTunes Search API — no API key, no account,
 * CORS-enabled. Chosen as the first rank/volume data source to implement per
 * designDigitalMarketingPro.md §8.1: the "public-data-only" candidate has the
 * lowest adoption friction of the three compared there (no Apple Search Ads
 * advertiser account, unlike the RespectASO-style session-cookie approach
 * that design doc explicitly recommends against replicating).
 */
import type { StoreApp, StoreAppDetail } from './types'

const SEARCH_URL = 'https://itunes.apple.com/search'
const LOOKUP_URL = 'https://itunes.apple.com/lookup'
const FETCH_TIMEOUT_MS = 15_000

function mapResult(r: any): StoreApp {
	return {
		id: String(r.trackId),
		title: r.trackName ?? '',
		description: r.description ?? '',
		rating: r.averageUserRating ?? 0,
		popularitySignal: r.userRatingCount ?? 0,
	}
}

/** Search the App Store for apps matching `term` — used both for competitor lookup and for scoring a keyword's current ranking set. */
export async function searchApps(term: string, country: string, limit = 50): Promise<StoreApp[]> {
	const url = `${SEARCH_URL}?term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&entity=software&limit=${limit}`
	const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
	if (!res.ok) throw new Error(`iTunes search failed (${res.status}) for "${term}"`)
	const data = await res.json()
	return (data.results ?? []).map(mapResult)
}

/**
 * Look up one app by its numeric App Store track id — used for URL-based
 * import of an already-published app, and for the audit's live listing/
 * quality/localization checks. `languageCodesISO2A` and
 * `currentVersionReleaseDate` are both real, documented fields on this
 * public API response — no scraping or guessing needed for iOS.
 */
export async function lookupItunesApp(
	trackId: string,
	country: string
): Promise<StoreAppDetail | null> {
	const url = `${LOOKUP_URL}?id=${encodeURIComponent(trackId)}&country=${encodeURIComponent(country)}`
	const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
	if (!res.ok) throw new Error(`iTunes lookup failed (${res.status}) for id ${trackId}`)
	const data = await res.json()
	const result = data.results?.[0]
	if (!result) return null
	return {
		...mapResult(result),
		category: result.primaryGenreName,
		lastUpdated: result.currentVersionReleaseDate,
		releaseDate: result.releaseDate,
		languages: result.languageCodesISO2A,
		iconUrl: result.artworkUrl512 ?? result.artworkUrl100 ?? result.artworkUrl60,
	}
}
