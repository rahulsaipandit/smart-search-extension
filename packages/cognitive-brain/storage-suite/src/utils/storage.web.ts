/**
 * WEB STORAGE IMPLEMENTATION (storage.web.ts)
 *
 * This is the web implementation of the storage module, specifically for web browsers.
 * It uses the browser's localStorage API with a Promise-based interface.
 */

interface KeyValueStorageInterface {
	setString(key: string, value: string): Promise<void>
	setBoolean(key: string, value: boolean): Promise<void>
	setNumber(key: string, value: number): Promise<void>
	setObject(key: string, value: unknown): Promise<void>
	getString(key: string): Promise<string | null>
	getBoolean(key: string): Promise<boolean | null>
	getNumber(key: string): Promise<number | null>
	getObject(key: string): Promise<unknown>
	delete(key: string): Promise<void>
	contains(key: string): Promise<boolean>
	getAllKeys(): Promise<string[]>
	clearAll(): Promise<void>
}

declare const localStorage: {
	setItem(key: string, value: string): void
	getItem(key: string): string | null
	removeItem(key: string): void
	clear(): void
	length: number
	key(index: number): string | null
}

// Check if we're in an actual browser tab. `window` only exists in a real browser — Expo
// Router's static web output runs a Node.js SSR pass (expo-router/node/render.js) to
// pre-render routes, and that Node process can expose a truthy but non-functional
// `localStorage` global of its own (e.g. via `--localstorage-file` without a valid path).
// Gating on `window` (rather than `localStorage` presence) keeps this storage server-inert,
// since this code is only meant to run client-side.
const isBrowser: boolean =
	typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function'

// Memory fallback for server-side rendering or when localStorage is not available
const memoryStore = new Map<string, string>()

/**
 * Web Storage Implementation (using browser localStorage with in-memory SSR fallback)
 *
 * Provides a Promise-based key-value API consistent with the native (MMKV) implementation.
 * Falls back to an in-memory Map when localStorage is unavailable (e.g. SSR / test environments).
 *
 * Available methods (all return Promises):
 * - setString / getString
 * - setBoolean / getBoolean
 * - setNumber / getNumber
 * - setObject / getObject
 * - delete, clearAll, getAllKeys, contains
 */

const Storage: KeyValueStorageInterface = {
	// String
	setString: (key: string, value: string): Promise<void> => {
		// console.log(`[CrossPlatformStorage - WEB] SET key: '${key}', value:`, value);
		try {
			if (!isBrowser) {
				memoryStore.set(key, value)
				return Promise.resolve()
			}
			localStorage.setItem(key, value)
			return Promise.resolve()
		} catch (e) {
			console.error('Error setting string in storage', e)
			return Promise.reject(e instanceof Error ? e : new Error(String(e)))
		}
	},

	getString: (key: string): Promise<string | null> => {
		try {
			if (!isBrowser) {
				const value = memoryStore.has(key) ? String(memoryStore.get(key)) : null
				// console.log(`[CrossPlatformStorage - WEB] GET key: '${key}', value:`, value);
				return Promise.resolve(value)
			}
			const value = localStorage.getItem(key)
			// console.log(`[CrossPlatformStorage - WEB] GET key: '${key}', value:`, value);
			return Promise.resolve(value)
		} catch (e) {
			console.error('Error getting string from storage', e)
			return Promise.resolve(null)
		}
	},

	// Boolean
	setBoolean: (key: string, value: boolean): Promise<void> => {
		return Storage.setString(key, value ? 'true' : 'false')
	},

	getBoolean: (key: string): Promise<boolean | null> => {
		return Storage.getString(key).then((value) => {
			if (value === null) return null
			return value === 'true'
		})
	},

	// Number
	setNumber: (key: string, value: number): Promise<void> => {
		return Storage.setString(key, value.toString())
	},

	getNumber: (key: string): Promise<number | null> => {
		return Storage.getString(key).then((value) => {
			if (value === null || value === '') return null
			return parseFloat(value) || 0
		})
	},

	// Object/Array (serialized as JSON)
	setObject: (key: string, value: unknown): Promise<void> => {
		try {
			const jsonString = JSON.stringify(value)
			if (!isBrowser) {
				memoryStore.set(key, jsonString)
				return Promise.resolve()
			}
			localStorage.setItem(key, jsonString)
			return Promise.resolve()
		} catch (e) {
			console.error('Error setting object in storage', e)
			return Promise.reject(e instanceof Error ? e : new Error(String(e)))
		}
	},

	getObject: (key: string): Promise<unknown> => {
		try {
			if (!isBrowser) {
				const value = memoryStore.get(key)
				return Promise.resolve(value ? JSON.parse(value) : null)
			}
			const jsonString = localStorage.getItem(key)
			return Promise.resolve(jsonString ? JSON.parse(jsonString) : null)
		} catch (e) {
			console.error('Error getting object from storage', e)
			return Promise.resolve(null)
		}
	},

	// Delete
	delete: (key: string): Promise<void> => {
		try {
			if (!isBrowser) {
				memoryStore.delete(key)
				return Promise.resolve()
			}
			localStorage.removeItem(key)
			return Promise.resolve()
		} catch (e) {
			console.error('Error removing item from storage', e)
			return Promise.reject(e instanceof Error ? e : new Error(String(e)))
		}
	},

	// Clear all
	clearAll: (): Promise<void> => {
		try {
			if (!isBrowser) {
				memoryStore.clear()
				return Promise.resolve()
			}
			localStorage.clear()
			return Promise.resolve()
		} catch (e) {
			console.error('Error clearing storage', e)
			return Promise.reject(e instanceof Error ? e : new Error(String(e)))
		}
	},

	// Get all keys
	getAllKeys: (): Promise<string[]> => {
		try {
			if (!isBrowser) {
				return Promise.resolve(Array.from(memoryStore.keys()))
			}
			const keys: string[] = []
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)
				if (key) keys.push(key)
			}
			return Promise.resolve(keys)
		} catch (e) {
			console.error('Error getting all keys from storage', e)
			return Promise.resolve([])
		}
	},

	// Check if key exists
	contains: (key: string): Promise<boolean> => {
		try {
			if (!isBrowser) {
				return Promise.resolve(memoryStore.has(key))
			}
			return Promise.resolve(localStorage.getItem(key) !== null)
		} catch (e) {
			console.error('Error checking if key exists in storage', e)
			return Promise.resolve(false)
		}
	},
}

export default Storage
