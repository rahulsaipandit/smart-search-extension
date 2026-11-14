import { log } from '../utils/logger'

/**
 * Defines the interface for a key-value storage system.
 * This can be implemented using different backends like IndexedDB, AsyncStorage, or native file systems.
 */
export interface StorageManager {
	initialize(): Promise<void>
	writeEntry(path: string, content: string): Promise<void>
	readEntry(path: string): Promise<string | null>
	listEntries(directory: string): Promise<string[]>
	deleteEntry(path: string): Promise<void>
	close(): Promise<void>
}

/**
 * Defines the factory interface for creating platform-specific storage managers.
 */
export interface StorageFactory {
	getStorageManager(dbName?: string): StorageManager
}

/**
 * Default storage factory - platform-specific implementation will be resolved by bundler
 */
export declare function getDefaultStorageManager(dbName?: string): StorageManager

/**
 * Default storage factory instance - platform-specific implementation will be resolved by bundler
 */
const defaultStorageFactory: StorageFactory = {
	getStorageManager: (dbName?: string) => {
		throw new Error(
			'Default storage factory not implemented - this should be resolved by platform-specific implementation'
		)
	},
}

export default defaultStorageFactory

/**
 * A simple in-memory storage manager as a fallback.
 * This is not intended for production use but for environments where no persistent storage is available.
 */
export class FileSystemStorageManager implements StorageManager {
	private storage = new Map<string, string>()

	async initialize(): Promise<void> {
		log.debug('FileSystemStorageManager: Initialized (in-memory)')
		return Promise.resolve()
	}

	async writeEntry(path: string, content: string): Promise<void> {
		this.storage.set(path, content)
		return Promise.resolve()
	}

	async readEntry(path: string): Promise<string | null> {
		return Promise.resolve(this.storage.get(path) || null)
	}

	async listEntries(directory: string): Promise<string[]> {
		const keys = Array.from(this.storage.keys()).filter((k) => k.startsWith(directory))
		return Promise.resolve(keys)
	}

	async deleteEntry(path: string): Promise<void> {
		this.storage.delete(path)
		return Promise.resolve()
	}

	async close(): Promise<void> {
		this.storage.clear()
		log.debug('FileSystemStorageManager: Closed (in-memory)')
		return Promise.resolve()
	}
}
