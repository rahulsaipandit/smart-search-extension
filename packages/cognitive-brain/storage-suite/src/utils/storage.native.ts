/**
 * NATIVE STORAGE IMPLEMENTATION (storage.native.ts)
 *
 * This is the native implementation of the storage module, specifically for React Native.
 * It uses react-native-mmkv for fast, synchronous storage with an in-memory fallback.
 *
 * For web implementation, see storage.web.ts which uses @react-native-async-storage/async-storage.
 *
 * The module provides a consistent Promise-based API across both platforms.
 */
import { MMKV } from 'react-native-mmkv'

interface KeyValueStorageInterface {
	setString(key: string, value: string): Promise<void>
	setBoolean(key: string, value: boolean): Promise<void>
	setNumber(key: string, value: number): Promise<void>
	setObject(key: string, value: unknown): Promise<void>
	getString(key: string): Promise<string | null>
	getBoolean(key: string): Promise<boolean | null>
	getNumber(key: string): Promise<number | null>
	getObject(key: string): Promise<unknown | null>
	delete(key: string): Promise<void>
	contains(key: string): Promise<boolean>
	getAllKeys(): Promise<string[]>
	clearAll(): Promise<void>
}

// MMKV interface
interface MMKVInstance {
	set(key: string, value: string): void
	getString(key: string): string | undefined
	delete(key: string): void
	clearAll(): void
	getAllKeys(): string[] | undefined
	contains(key: string): boolean
}

// In-memory storage fallback
const inMemoryStore = new Map<string, string>()

// Initialize MMKV storage for React Native
let mmkv: MMKVInstance | undefined

try {
	mmkv = new MMKV()
} catch (e) {
	console.warn('Failed to initialize MMKV storage, using in-memory fallback', e)
}

/**
 * Native Storage Implementation (using react-native-mmkv)
 *
 * This module provides a fast key-value storage solution for React Native apps
 * using MMKV with an in-memory fallback.
 *
 * All methods return Promises for consistency with the web implementation.
 *
 * Available methods:
 * - setString(key, value): Store a string value
 * - getString(key): Get a string value (resolves to null if not found)
 * - setBoolean(key, value): Store a boolean value
 * - getBoolean(key): Get a boolean value (resolves to false if not found)
 * - setNumber(key, value): Store a number
 * - getNumber(key): Get a number (resolves to 0 if not found)
 * - setObject(key, value): Store an object/array (automatically serialized to JSON)
 * - getObject(key): Get an object/array (parsed from JSON, resolves to null if not found)
 * - delete(key): Remove an item
 * - clearAll(): Remove all items
 * - getAllKeys(): Get all storage keys
 * - contains(key): Check if a key exists
 */

// Helper to promisify MMKV methods for consistent API with web
const Storage: KeyValueStorageInterface = {
	// String
	setString: async (key: string, value: string): Promise<void> => {
		// console.log(`[CrossPlatformStorage - NATIVE] SET key: '${key}', value:`, value);
		const strValue = String(value)
		try {
			if (mmkv) {
				mmkv.set(key, strValue)
			}
			inMemoryStore.set(key, strValue)
			return Promise.resolve()
		} catch (e) {
			console.error('Error setting string in storage', e)
			inMemoryStore.set(key, strValue) // Ensure in-memory is always updated
			return Promise.resolve()
		}
	},

	getString: async (key: string): Promise<string | null> => {
		// Check in-memory store first for consistency
		if (inMemoryStore.has(key)) {
			const value = inMemoryStore.get(key) || null
			// console.log(`[CrossPlatformStorage - NATIVE] GET key: '${key}', value:`, value);
			return value
		}

		try {
			if (mmkv) {
				const value = mmkv.getString(key)
				// console.log(`[CrossPlatformStorage - NATIVE] GET key: '${key}', value:`, value);
				if (value !== undefined) {
					inMemoryStore.set(key, value) // Cache the value
					return value
				}
			}
			return null
		} catch (e) {
			console.error('Error getting string from storage', e)
			const value = inMemoryStore.get(key) || null
			// console.log(`[CrossPlatformStorage - NATIVE] GET key: '${key}' (from fallback), value:`, value);
			return value
		}
	},

	// Boolean
	setBoolean: async (key: string, value: boolean): Promise<void> => {
		const boolValue = value ? 'true' : 'false'
		try {
			if (mmkv) {
				mmkv.set(key, boolValue)
			}
			inMemoryStore.set(key, boolValue)
			return Promise.resolve()
		} catch (e) {
			console.error('Error setting boolean in storage', e)
			inMemoryStore.set(key, boolValue)
			return Promise.resolve()
		}
	},

	getBoolean: async (key: string): Promise<boolean | null> => {
		// Check in-memory store first for consistency
		if (inMemoryStore.has(key)) {
			const val = inMemoryStore.get(key)
			return val === 'true' ? true : val === 'false' ? false : null
		}

		try {
			if (mmkv) {
				const value = mmkv.getString(key)
				if (value !== undefined) {
					const boolValue = value === 'true'
					inMemoryStore.set(key, value) // Cache the value
					return boolValue
				}
			}
			return null
		} catch (e) {
			console.error('Error getting boolean from storage', e)
			const val = inMemoryStore.get(key)
			return val === 'true' ? true : val === 'false' ? false : null
		}
	},

	// Number
	setNumber: async (key: string, value: number): Promise<void> => {
		const numValue = String(value)
		try {
			if (mmkv) {
				mmkv.set(key, numValue)
			}
			inMemoryStore.set(key, numValue)
			return Promise.resolve()
		} catch (e) {
			console.error('Error setting number in storage', e)
			inMemoryStore.set(key, numValue)
			return Promise.resolve()
		}
	},

	getNumber: async (key: string): Promise<number | null> => {
		// Check in-memory store first for consistency
		if (inMemoryStore.has(key)) {
			const num = Number(inMemoryStore.get(key))
			return isNaN(num) ? null : num
		}

		try {
			if (mmkv) {
				const value = mmkv.getString(key)
				if (value !== undefined) {
					const numValue = Number(value) || 0
					inMemoryStore.set(key, String(numValue)) // Cache the value
					return numValue
				}
			}
			return null
		} catch (e) {
			console.error('Error getting number from storage', e)
			const num = Number(inMemoryStore.get(key))
			return isNaN(num) ? null : num
		}
	},

	// Object/Array (serialized as JSON)
	setObject: async (key: string, value: unknown): Promise<void> => {
		try {
			const jsonValue = JSON.stringify(value)
			if (mmkv) {
				mmkv.set(key, jsonValue)
			}
			inMemoryStore.set(key, jsonValue)
			return Promise.resolve()
		} catch (e) {
			console.error('Error stringifying object', e)
			return Promise.reject(e)
		}
	},

	getObject: async (key: string): Promise<unknown | null> => {
		// Check in-memory store first for consistency
		if (inMemoryStore.has(key)) {
			try {
				const val = inMemoryStore.get(key)
				return val ? JSON.parse(val) : null
			} catch (e) {
				console.error('Error parsing object from in-memory store', e)
				return null
			}
		}

		try {
			if (mmkv) {
				const jsonValue = mmkv.getString(key)
				if (jsonValue !== undefined) {
					inMemoryStore.set(key, jsonValue) // Cache the value
					return JSON.parse(jsonValue)
				}
			}
			return null
		} catch (e) {
			console.error('Error getting object from storage', e)
			return null
		}
	},

	// Delete
	delete: async (key: string): Promise<void> => {
		try {
			if (mmkv) {
				mmkv.delete(key)
			}
			inMemoryStore.delete(key)
			return Promise.resolve()
		} catch (e) {
			console.error('Error deleting key from storage', e)
			inMemoryStore.delete(key) // Ensure in-memory is consistent
			return Promise.resolve()
		}
	},

	// Clear all
	clearAll: async (): Promise<void> => {
		try {
			if (mmkv) {
				mmkv.clearAll()
			}
			inMemoryStore.clear()
			return Promise.resolve()
		} catch (e) {
			console.error('Error clearing storage', e)
			inMemoryStore.clear() // Clear in-memory even if MMKV fails
			return Promise.resolve()
		}
	},

	// Get all keys
	getAllKeys: async (): Promise<string[]> => {
		try {
			if (mmkv) {
				const keys = mmkv.getAllKeys()
				// Update in-memory store with all keys from MMKV
				if (Array.isArray(keys)) {
					keys.forEach((key) => {
						if (!inMemoryStore.has(key)) {
							const value = mmkv?.getString(key)
							if (value !== undefined) {
								inMemoryStore.set(key, value)
							}
						}
					})
				}
				return keys || []
			}
			return Array.from(inMemoryStore.keys())
		} catch (e) {
			console.error('Error getting all keys from storage', e)
			return Array.from(inMemoryStore.keys())
		}
	},

	// Check if key exists
	contains: async (key: string): Promise<boolean> => {
		if (inMemoryStore.has(key)) {
			return true
		}

		try {
			if (mmkv) {
				return mmkv.contains(key)
			}
			return inMemoryStore.has(key)
		} catch (e) {
			console.error('Error checking if key exists in storage', e)
			return inMemoryStore.has(key)
		}
	},
}

export default Storage
