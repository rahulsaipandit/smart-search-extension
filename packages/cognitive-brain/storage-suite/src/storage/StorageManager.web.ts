import { log } from '../utils/logger'
import type { StorageFactory, StorageManager } from './StorageManager'

// Override getDefaultStorageManager for web platform
export function getDefaultStorageManager(dbName?: string): StorageManager {
	return new WebStorageManager(dbName)
}

/**
 * Web implementation using IndexedDB
 */
export class WebStorageManager implements StorageManager {
	private db: IDBDatabase | null = null
	private initialized = false

	private dbName: string

	constructor(dbName: string = 'memsoftstore') {
		this.dbName = dbName
		log.debug(`WebStorageManager: Using IndexedDB database "${dbName}"`)
	}

	async initialize(): Promise<void> {
		if (this.initialized) return

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 1)

			request.onerror = () => {
				console.error('IndexedDB error:', request.error)
				reject(request.error ?? new Error('IndexedDB request failed'))
			}

			request.onsuccess = () => {
				this.db = request.result
				this.initialized = true
				log.debug('WebStorageManager: Database initialized')
				resolve()
			}

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result

				if (!db.objectStoreNames.contains('entries')) {
					const store = db.createObjectStore('entries', { keyPath: 'path' })
					store.createIndex('updated_at', 'updated_at')
				}
			}
		})
	}

	async writeEntry(path: string, content: string): Promise<void> {
		await this.initialize()
		if (!this.db) throw new Error('Database not initialized')

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(['entries'], 'readwrite')
			const store = transaction.objectStore('entries')

			const request = store.put({
				path,
				content,
				updated_at: Date.now(),
			})

			request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
			request.onsuccess = () => resolve()
		})
	}

	async readEntry(path: string): Promise<string | null> {
		await this.initialize()
		if (!this.db) throw new Error('Database not initialized')

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(['entries'], 'readonly')
			const store = transaction.objectStore('entries')
			const request = store.get(path)

			request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
			request.onsuccess = () => {
				const result = request.result
				resolve(result ? result.content : null)
			}
		})
	}

	async listEntries(directory: string): Promise<string[]> {
		await this.initialize()
		if (!this.db) throw new Error('Database not initialized')

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(['entries'], 'readonly')
			const store = transaction.objectStore('entries')
			const request = store.openCursor()

			const paths: string[] = []

			request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
			request.onsuccess = () => {
				const cursor = request.result
				if (cursor) {
					if (cursor.value.path.startsWith(directory)) {
						paths.push(cursor.value.path)
					}
					cursor.continue()
				} else {
					resolve(paths)
				}
			}
		})
	}

	async deleteEntry(path: string): Promise<void> {
		await this.initialize()
		if (!this.db) throw new Error('Database not initialized')

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(['entries'], 'readwrite')
			const store = transaction.objectStore('entries')
			const request = store.delete(path)

			request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
			request.onsuccess = () => resolve()
		})
	}

	async close(): Promise<void> {
		if (this.db) {
			this.db.close()
			this.db = null
			this.initialized = false
		}
	}
}

/**
 * Factory to create web storage manager
 */
class WebStorageFactory implements StorageFactory {
	getStorageManager(dbName?: string): StorageManager {
		log.debug('WebStorageFactory: Creating WebStorageManager (IndexedDB)')

		// Web implementation using IndexedDB
		return new WebStorageManager(dbName)
	}
}

const factory = new WebStorageFactory()
export default factory
