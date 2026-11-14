/**
 * Import an already-published app's context straight from its store listing
 * URL, instead of asking the user to retype details the store already has —
 * e.g. https://apps.apple.com/us/app/vantage-private-ai-life-coach/id6759304658
 * or https://play.google.com/store/apps/details?id=com.example.app
 */
import { lookupStoreApp } from './storeClient'
import type { AppMarketingContext, StoreId } from './types'

export interface ParsedStoreUrl {
	store: StoreId
	appId: string
	country: string
}

/** Parse an App Store or Google Play listing URL into a store + app id + storefront country. Returns null if the URL doesn't match either pattern. */
export function parseStoreUrl(rawUrl: string): ParsedStoreUrl | null {
	let url: URL
	try {
		url = new URL(rawUrl.trim())
	} catch {
		return null
	}

	if (/(^|\.)apps\.apple\.com$/.test(url.hostname)) {
		const idMatch = /\/id(\d+)/.exec(url.pathname)
		if (!idMatch) return null
		// Path shape is usually /<country>/app/<slug>/id<digits>, but Apple also
		// serves locale-less URLs (/app/<slug>/id<digits>, or even /app/id<digits>)
		// with no country segment at all — find the "app" segment and only treat
		// whatever comes immediately before it as a country code, rather than
		// blindly assuming the first path segment always is one.
		const segments = url.pathname.split('/').filter(Boolean)
		const appIndex = segments.indexOf('app')
		const country = appIndex > 0 ? segments[appIndex - 1] : 'us'
		return { store: 'ios', appId: idMatch[1], country }
	}

	if (/(^|\.)play\.google\.com$/.test(url.hostname)) {
		const packageName = url.searchParams.get('id')
		if (!packageName) return null
		const country = url.searchParams.get('gl') || 'us'
		return { store: 'android', appId: packageName, country }
	}

	return null
}

export interface StoreImportResult {
	context: Omit<AppMarketingContext, 'audience' | 'competitors' | 'goal'>
	/** Fields the store listing couldn't supply — the caller should ask the user to fill these in rather than silently leaving them blank. */
	missingFields: string[]
}

/** Fetch an already-published app's listing and map it onto a starter AppMarketingContext. Audience/competitors/goal can't be inferred from a listing and are left for the user to fill in. */
export async function importFromStoreUrl(rawUrl: string): Promise<StoreImportResult> {
	const parsed = parseStoreUrl(rawUrl)
	if (!parsed) {
		throw new Error(
			'Not a recognized App Store or Google Play listing URL (expected apps.apple.com/.../id123456789 or play.google.com/store/apps/details?id=...).'
		)
	}

	const app = await lookupStoreApp(parsed.store, parsed.appId, parsed.country)
	if (!app) {
		throw new Error(
			`Could not find an app at that URL (store: ${parsed.store}, id: ${parsed.appId}).`
		)
	}

	const missingFields: string[] = []
	if (!app.category) missingFields.push('category')

	return {
		context: {
			store: parsed.store,
			name: app.title,
			category: app.category ?? '',
			description: app.description,
			storeAppId: parsed.appId,
			storeCountry: parsed.country,
		},
		missingFields,
	}
}
