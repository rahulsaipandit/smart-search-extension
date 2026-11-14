/** __Platform Support:__ Platform-agnostic storage module lets the bundler automatically use the correct platform-specific implementation:
    - `storage.native.js` for React Native(iOS/Android) (likely AsyncStorage)
    - `storage.web.js` for web (likely localStorage/indexedDB)
  It is a simple, platform-agnostic key-value storage wrapper designed for basic app data persistence. 
__Functionality:__
- Basic CRUD operations for primitives: strings, booleans, numbers, objects
- Provides both direct methods and an MMKV-compatible interface
- Simple key-based storage without complex relationships or querying

__Data Model:__
- Flat key-value pairs for configuration, settings, or simple app state

__Use Cases for when to use storage.ts versus LocalStorage.ts:__
- `LocalStorage`: Managing complex knowledge graphs, memory systems, or hierarchical content organization
- `storage.ts`: App preferences, user settings, authentication tokens, or other simple data persistence needs
 */
// Define interfaces for type safety
// Default to native implementation - the bundler will replace this with the web version when needed
import Storage from './storage.native'

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

interface MMKVInterface {
	set(key: string, value: string | number | boolean | object): Promise<void>
	getString(key: string): Promise<string>
	getBoolean(key: string): Promise<boolean>
	getNumber(key: string): Promise<number>
	delete(key: string): Promise<void>
	contains(key: string): Promise<boolean>
	getAllKeys(): Promise<string[]>
	clearAll(): Promise<void>
	recrypt?: (key: unknown) => Promise<void>
}

// Type assertion for the imported Storage
const TypedStorage = Storage as KeyValueStorageInterface

// MMKV-compatible storage implementation
const mmkv: MMKVInterface = {
	set: async (key: string, value: string | number | boolean | object): Promise<void> => {
		try {
			if (typeof value === 'string') {
				return await TypedStorage.setString(key, value)
			} else if (typeof value === 'boolean') {
				return await TypedStorage.setBoolean(key, value)
			} else if (typeof value === 'number') {
				return await TypedStorage.setNumber(key, value)
			} else if (typeof value === 'object') {
				return await TypedStorage.setObject(key, value)
			}
			return
		} catch (error) {
			console.error('Error in mmkv.set:', error)
			return Promise.reject(error instanceof Error ? error : new Error(String(error)))
		}
	},

	getString: async (key: string): Promise<string> => {
		try {
			const value = await TypedStorage.getString(key)
			return value || ''
		} catch (error) {
			console.error('Error in mmkv.getString:', error)
			return ''
		}
	},

	getBoolean: async (key: string): Promise<boolean> => {
		try {
			const value = await TypedStorage.getBoolean(key)
			return value || false
		} catch (error) {
			console.error('Error in mmkv.getBoolean:', error)
			return false
		}
	},

	getNumber: async (key: string): Promise<number> => {
		try {
			const value = await TypedStorage.getNumber(key)
			return value || 0
		} catch (error) {
			console.error('Error in mmkv.getNumber:', error)
			return 0
		}
	},

	delete: async (key: string): Promise<void> => {
		try {
			return await TypedStorage.delete(key)
		} catch (error) {
			console.error('Error in mmkv.delete:', error)
			return Promise.reject(error instanceof Error ? error : new Error(String(error)))
		}
	},

	contains: async (key: string): Promise<boolean> => {
		try {
			return await TypedStorage.contains(key)
		} catch (error) {
			console.error('Error in mmkv.contains:', error)
			return false
		}
	},

	getAllKeys: async (): Promise<string[]> => {
		try {
			return await TypedStorage.getAllKeys()
		} catch (error) {
			console.error('Error in mmkv.getAllKeys:', error)
			return []
		}
	},

	clearAll: async (): Promise<void> => {
		try {
			return await TypedStorage.clearAll()
		} catch (error) {
			console.error('Error in mmkv.clearAll:', error)
			return Promise.reject(error instanceof Error ? error : new Error(String(error)))
		}
	},

	// For backward compatibility
	recrypt: async (_key: unknown): Promise<void> => {
		console.warn('recrypt() is not implemented in this storage implementation')
		return Promise.resolve()
	},
}

export default TypedStorage
export { mmkv }
