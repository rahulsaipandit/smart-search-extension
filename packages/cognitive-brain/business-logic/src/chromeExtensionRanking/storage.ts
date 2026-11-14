/**
 * Persistence contract for tracked extensions + their keyword rank history.
 *
 * The package stays platform-neutral by taking the store as a parameter instead of reaching for
 * `localStorage`. The browser extension backs it with `localStorage` (extension pages share one
 * origin, so the `extension-ranker` tab and the sidepanel's widget runtime see the same data);
 * another host can back it with any synchronous key-value storage.
 */
import type { TrackedExtension } from './types'

const STORAGE_KEY = 'chromeExtensionRanker:tracked'

export interface TrackedExtensionStore {
	load(): TrackedExtension[]
	save(entries: TrackedExtension[]): void
}

/** The subset of the Web Storage API the store needs. */
export type SyncKeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export function createTrackedExtensionStore(storage: SyncKeyValueStorage): TrackedExtensionStore {
	return {
		load() {
			try {
				const raw = storage.getItem(STORAGE_KEY)
				return raw ? (JSON.parse(raw) as TrackedExtension[]) : []
			} catch (error) {
				console.error('[chromeExtensionRanking] failed to load tracked extensions:', error)
				return []
			}
		},
		save(entries) {
			storage.setItem(STORAGE_KEY, JSON.stringify(entries))
		},
	}
}
