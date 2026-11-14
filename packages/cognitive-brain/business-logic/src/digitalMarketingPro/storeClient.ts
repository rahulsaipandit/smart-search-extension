/**
 * Store-agnostic dispatch — every other module (scoring, keyword discovery,
 * content generation) works against `StoreApp[]`/`StoreId` and never imports
 * itunesClient.ts or googlePlayClient.ts directly, so App Store vs. Google
 * Play stays a single branch point instead of scattered throughout the
 * codebase.
 */
import { lookupPlayApp, searchPlayApps } from './googlePlayClient'
import { lookupItunesApp, searchApps as searchItunesApps } from './itunesClient'
import type { StoreApp, StoreAppDetail, StoreId } from './types'

export function searchStoreApps(
	store: StoreId,
	term: string,
	country: string,
	limit = 50
): Promise<StoreApp[]> {
	return store === 'ios'
		? searchItunesApps(term, country, limit)
		: searchPlayApps(term, country, limit)
}

export function lookupStoreApp(
	store: StoreId,
	appId: string,
	country: string
): Promise<StoreAppDetail | null> {
	return store === 'ios' ? lookupItunesApp(appId, country) : lookupPlayApp(appId, country)
}
