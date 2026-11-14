import { type DB as SQLDatabase } from '@op-engineering/op-sqlite'

import { getDatabase } from './DatabaseManager'

// Global SearchIndex instance and operation queue management
let globalSearchIndex: SearchIndex | null = null
const operationQueue: {
	operation: () => Promise<any>
	resolve: (value: any) => void
	reject: (error: any) => void
}[] = []
let isProcessingQueue = false

export class SearchIndex {
	// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- SQLDatabase resolves to `any` because op-sqlite types are absent in web builds
	private db: SQLDatabase | null = null

	/**
	 * Get the global SearchIndex singleton instance
	 */
	static getInstance(): SearchIndex {
		if (!globalSearchIndex) {
			globalSearchIndex = new SearchIndex()
		}
		return globalSearchIndex
	}

	/**
	 * Initialize the database connection
	 */
	private async initialize(): Promise<void> {
		if (this.db) return

		const { db, initializationPromise } = getDatabase()
		await initializationPromise
		this.db = db

		if (!this.db) {
			throw new Error('Database connection failed after initialization.')
		}
	}

	/**
	 * Queue a database operation to ensure serialized access
	 */
	private async queueOperation<T>(operation: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			operationQueue.push({ operation, resolve, reject })
			this.processQueue()
		})
	}

	/**
	 * Process the operation queue serially
	 */
	private async processQueue(): Promise<void> {
		if (isProcessingQueue || operationQueue.length === 0) {
			return
		}

		isProcessingQueue = true

		while (operationQueue.length > 0) {
			const { operation, resolve, reject } = operationQueue.shift()!

			try {
				const result = await operation()
				resolve(result)
			} catch (error) {
				reject(error)
			}
		}

		isProcessingQueue = false
	}

	async indexFile(_filePath: string, content: string): Promise<void> {
		return this.queueOperation(async () => {
			if (!this.db) {
				throw new Error('Database not initialized. Call init() first.')
			}

			const { frontmatter, body } = this.parseMarkdown(content)

			// NOTE: This INSERT statement must stay in sync with the table schema in StorageManager.native.ts
			// Both should match the specification in docs/specs/HMM/design.md
			// Schema: id, user_id, type, title, content, layer, tags, timestamp,
			//         importance, source_l0, source_l1, entities, confidence, persona_traits,
			//         status, priority, category, target_date

			await this.db.execute(
				`INSERT OR REPLACE INTO memory_search (
            id, user_id, type, title, content, layer, tags, timestamp,
            importance, source_l0, source_l1, entities, confidence, persona_traits,
            status, priority, category, target_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					frontmatter.permalink || frontmatter.id, // Use permalink as id
					frontmatter.user_id || null, // Assuming user_id might be in frontmatter
					frontmatter.type,
					frontmatter.title,
					body,
					frontmatter.layer,
					JSON.stringify(frontmatter.tags || []),
					frontmatter.timestamp,
					frontmatter.importance || null,
					JSON.stringify(frontmatter.source_l0 || []),
					JSON.stringify(frontmatter.source_l1 || []),
					JSON.stringify(frontmatter.entities || []),
					frontmatter.confidence || null,
					JSON.stringify(frontmatter.persona_traits || {}),
					frontmatter.status || null,
					frontmatter.priority || null,
					frontmatter.category || null,
					frontmatter.target_date || null,
				] as any[]
			)
		})
	}

	async searchMemories(query: string, options: any = {}): Promise<any[]> {
		return this.queueOperation(async () => {
			if (!this.db) {
				throw new Error('Database not initialized. Call init() first.')
			}

			const { layer, timeRange, limit = 10 } = options

			let sql = `SELECT * FROM memory_search WHERE memory_search MATCH ?`
			const params: any[] = [query]

			if (layer && layer !== 'all') {
				sql += ` AND layer = ?`
				params.push(layer)
			}

			if (timeRange) {
				if (timeRange.start) {
					sql += ` AND timestamp >= ?`
					params.push(timeRange.start)
				}
				if (timeRange.end) {
					sql += ` AND timestamp <= ?`
					params.push(timeRange.end)
				}
			}

			sql += ` ORDER BY rank LIMIT ?`
			params.push(limit)

			const results = await this.db.execute(sql, params)
			return results.rows || []
		})
	}

	async listMemories(
		options: { layer?: string; limit?: number; since?: number } = {}
	): Promise<any[]> {
		return this.queueOperation(async () => {
			if (!this.db) {
				throw new Error('Database not initialized. Call init() first.')
			}

			const { layer, limit = 20, since } = options

			let sql = `SELECT * FROM memory_search WHERE 1=1`
			const params: any[] = []

			if (layer && layer !== 'all') {
				sql += ` AND layer = ?`
				params.push(layer)
			}

			if (since) {
				sql += ` AND timestamp >= ?`
				params.push(new Date(since).toISOString())
			}

			sql += ` ORDER BY timestamp DESC LIMIT ?`
			params.push(limit)

			const results = await this.db.execute(sql, params)
			return results.rows || []
		})
	}

	private parseMarkdown(content: string): { frontmatter: Record<string, unknown>; body: string } {
		const parts = content.split('---')
		if (parts.length < 3 || !parts[1]) {
			return { frontmatter: {}, body: content }
		}
		const frontmatter = parts[1].split('\n').reduce<Record<string, unknown>>((acc, line) => {
			const [key, ...valueParts] = line.split(':')
			if (key && valueParts.length > 0) {
				const value = valueParts.join(':').trim()
				try {
					acc[key.trim()] = JSON.parse(value)
				} catch {
					acc[key.trim()] = value.replace(/['"]/g, '')
				}
			}
			return acc
		}, {})
		const body = parts.slice(2).join('---')
		return { frontmatter, body }
	}
}
