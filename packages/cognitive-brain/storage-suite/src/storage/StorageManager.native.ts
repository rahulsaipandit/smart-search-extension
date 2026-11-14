import type { DB as SQLDatabase } from '@op-engineering/op-sqlite'

import { log } from '../utils/logger'
import { getDatabase } from './DatabaseManager'
import type { StorageFactory, StorageManager } from './StorageManager'

let instance: StorageManager | null = null

export function getDefaultStorageManager(): StorageManager {
	if (!instance) {
		instance = new NativeStorageManager()
	}
	return instance
}

/**
 * Native implementation using op-sqlite.
 * Relies on the global DatabaseManager for connection and initialization.
 */
export class NativeStorageManager implements StorageManager {
	private db: SQLDatabase | null = null

	/**
	 * Ensures the global database is initialized and retrieves the connection.
	 */
	async initialize(): Promise<void> {
		if (this.db) return
		const { db, initializationPromise } = getDatabase()
		await initializationPromise
		this.db = db
		if (!this.db) {
			throw new Error('[NativeStorageManager] Database connection failed after initialization.')
		}
	}

	async writeEntry(path: string, content: string): Promise<void> {
		await this.initialize()
		await this.db!.execute(
			`INSERT OR REPLACE INTO entries (path, content, updated_at)
       VALUES (?, ?, datetime('now'))`,
			[path, content]
		)
	}

	async readEntry(path: string): Promise<string | null> {
		await this.initialize()
		const result = await this.db!.execute(`SELECT content FROM entries WHERE path = ?`, [path])

		const row = result.rows?.[0]
		return row ? String(row.content) : null
	}

	async listEntries(directory: string): Promise<string[]> {
		await this.initialize()
		const result = await this.db!.execute(`SELECT path FROM entries WHERE path LIKE ?`, [
			`${directory}%`,
		])

		return result.rows?.map((row: any) => String(row.path)) || []
	}

	async deleteEntry(path: string): Promise<void> {
		await this.initialize()
		await this.db!.execute(`DELETE FROM entries WHERE path = ?`, [path])
	}

	/**
	 * Closing the global database is not handled here.
	 * It's assumed to live for the duration of the app.
	 */
	async close(): Promise<void> {
		// No-op, as the database connection is managed globally.
		return Promise.resolve()
	}
}

/**
 * Factory to create native storage manager
 */
class NativeStorageFactory implements StorageFactory {
	getStorageManager(): StorageManager {
		log.debug('[NativeStorageFactory] Getting shared NativeStorageManager')
		return getDefaultStorageManager()
	}
}

const factory = new NativeStorageFactory()
export default factory
