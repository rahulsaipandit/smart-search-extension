/**
 * VectorStore - Persistence Layer for Vector Embeddings with Orama-based Vector Store for Native (React Native)
 * Uses op-sqlite for fast local storage with flexible metadata filtering
 *
 * Design Principles:
 * - Persistence only - search/vector index handled by Orama at higher layer
 * - Flexible where filters used for filtering (and not hardcoded userId)
 * - TypeScript-First: Generic type support for metadata
 * - Self-Contained: Can optionally generate embeddings internally
 * - Page-Level Tracking: Each chunk stores page metadata for PDF navigation
 *
 * Uses Orama for:
 * - Vector similarity search
 * - Full-text search
 * - Hybrid search (vector + keyword)
 * - In-memory indexing with optional persistence
 */
import { create, search as oramaSearch } from '@orama/orama'

import type { IEmbeddingService } from '../embeddings/IEmbeddingService'
import { getDatabase } from '../storage/DatabaseManager'
import { log } from '../utils/logger'
import type {
	IVectorStore,
	Metadata,
	VectorRecord,
	VectorSearchOptions,
	VectorSearchResult,
	VectorStoreConfig,
} from './IVectorStore'

type OramaDB = any

export class VectorStore implements IVectorStore {
	private db: OramaDB = null
	private config: VectorStoreConfig
	private embeddingService: IEmbeddingService | null = null
	private ready = false
	private dimensions: number = 768 // Default for nomic-embed-text-v1.5.Q4_K_M.gguf but the default dimensions are overridden in instantiations

	constructor(config: VectorStoreConfig = {}) {
		this.config = {
			dbName: config.dbName || 'default',
			dimensions: config.dimensions || 768,
			persistTo: config.persistTo || 'memory',
			requireUserScope: config.requireUserScope || false,
			...config,
		}
		this.dimensions = this.config.dimensions || 768
		this.embeddingService = config.embeddingProvider || null
	}

	/**
	 * Validate userScope is provided when required
	 */
	private validateUserScope(operation: string, userId?: string): void {
		if (this.config.requireUserScope && !userId) {
			throw new Error(`[VectorStore] ${operation} requires userId (requireUserScope is enabled)`)
		}
	}

	async init(): Promise<void> {
		try {
			// Create Orama database schema
			const schema = this.config.schema || {
				id: 'string',
				text: 'string',
				vector: `vector[${this.dimensions}]`,
				userId: 'string',
				metadata: 'string', // JSON stringified
				createdAt: 'number',
				updatedAt: 'number',
			}

			this.db = await create({
				schema: schema as any,
			} as any)

			this.ready = true
			log.debug('[VectorStore] Initialized with dimensions:', this.dimensions)
		} catch (error) {
			console.error('[VectorStore] Init error:', error)
			throw error
		}
	}

	async close(): Promise<void> {
		if (this.db) {
			this.db = null
			this.ready = false
		}
	}

	isReady(): boolean {
		return this.ready && this.db !== null
	}

	// ===============================
	// Write Operations
	// ===============================

	async add(records: VectorRecord[]): Promise<string[]> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		// Check userId from first record if requireUserScope is enabled
		const firstUserId = records[0]?.userId
		this.validateUserScope('add', firstUserId)

		const ids: string[] = []

		for (const record of records) {
			const id = record.id || `vec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

			const doc = {
				id,
				text: record.text || '',
				vector: record.vector || new Array(this.dimensions).fill(0),
				userId: record.userId || '',
				metadata: JSON.stringify(record.metadata || {}),
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}

			await this.db.insert(doc)
			ids.push(id)
		}

		return ids
	}

	async update(id: string, data: Partial<VectorRecord>): Promise<boolean> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			// Get existing doc
			const results = await oramaSearch(this.db, {
				where: { id },
				limit: 1,
			})

			if (!results.hits || results.hits.length === 0) return false

			const existing = results.hits[0].document

			const updated = {
				...existing,
				...(data.text !== undefined && { text: data.text }),
				...(data.vector !== undefined && { vector: data.vector }),
				...(data.metadata !== undefined && { metadata: JSON.stringify(data.metadata) }),
				...(data.userId !== undefined && { userId: data.userId }),
				updatedAt: Date.now(),
			}

			await this.db.remove(id)
			await this.db.insert(updated)
			return true
		} catch (error) {
			console.error('[VectorStore] Update error:', error)
			return false
		}
	}

	async delete(id: string, _userId?: string): Promise<boolean> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			await this.db.remove(id)
			return true
		} catch (error) {
			console.error('[VectorStore] Delete error:', error)
			return false
		}
	}

	async deleteWhere(where: Partial<Metadata>, userId?: string): Promise<number> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			// Build where clause for Orama
			const whereClause: Record<string, any> = { ...where }
			if (userId) {
				whereClause.userId = userId
			}

			// Search for matching documents
			const results = await oramaSearch(this.db, {
				where: whereClause,
				limit: 1000,
			})

			// Delete each matching document
			let deletedCount = 0
			for (const hit of results.hits) {
				try {
					await this.db.remove(hit.document.id)
					deletedCount++
				} catch {
					// Document may already be deleted
				}
			}

			return deletedCount
		} catch (error) {
			console.error('[VectorStore] DeleteWhere error:', error)
			return 0
		}
	}

	async clear(userId?: string): Promise<void> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			if (userId) {
				// Clear only for specific user
				await this.deleteWhere({}, userId)
			} else {
				// Clear all - recreate the database
				await this.close()
				await this.init()
			}
		} catch (error) {
			console.error('[VectorStore] Clear error:', error)
		}
	}

	// ===============================
	// Search Operations
	// ===============================

	async search(query: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')
		this.validateUserScope('search', options.userId)

		try {
			// Build where clause
			const whereClause: Record<string, any> = { ...(options.where || {}) }
			if (options.userId) {
				whereClause.userId = options.userId
			}

			// Use Orama's vector search
			const results = await oramaSearch(this.db, {
				mode: 'vector',
				vector: {
					value: query,
					property: 'vector',
				},
				limit: options.topK,
				where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
			} as any)

			return this.transformResults(results, options)
		} catch (error) {
			console.error('[VectorStore] Search error:', error)
			return []
		}
	}

	private async textSearch(
		query: string,
		options: VectorSearchOptions
	): Promise<VectorSearchResult[]> {
		try {
			// Build where clause
			const whereClause: Record<string, any> = { ...(options.where || {}) }
			if (options.userId) {
				whereClause.userId = options.userId
			}

			const results = await oramaSearch(this.db, {
				term: query,
				limit: options.topK,
				where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
			})

			return this.transformResults(results, options)
		} catch (error) {
			console.error('[VectorStore] TextSearch error:', error)
			return []
		}
	}

	private async hybridSearch(
		text: string,
		vector: number[],
		options: VectorSearchOptions
	): Promise<VectorSearchResult[]> {
		const alpha = options.hybrid?.alpha ?? 0.5

		// Run both searches in parallel
		const [textResults, vectorResults] = await Promise.all([
			this.textSearch(text, { ...options, topK: options.topK * 2 }),
			this.search(vector, { ...options, topK: options.topK * 2 }),
		])

		// Create score maps
		const textScores = new Map(
			textResults.map((r, i) => [r.id, (textResults.length - i) / textResults.length])
		)
		const vectorScores = new Map(
			vectorResults.map((r, i) => [r.id, (vectorResults.length - i) / vectorResults.length])
		)

		// Combine scores
		const combined = new Map<string, VectorSearchResult>()

		for (const r of textResults) {
			combined.set(r.id, { ...r, score: (textScores.get(r.id) || 0) * alpha })
		}

		for (const r of vectorResults) {
			const existing = combined.get(r.id)
			const vectorScore = (vectorScores.get(r.id) || 0) * (1 - alpha)
			if (existing) {
				existing.score += vectorScore
			} else {
				combined.set(r.id, { ...r, score: vectorScore })
			}
		}

		// Sort by combined score and return topK
		return Array.from(combined.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, options.topK)
	}

	private transformResults(results: any, options: VectorSearchOptions): VectorSearchResult[] {
		return (results.hits || []).map((hit: any) => {
			const doc = hit.document
			return {
				id: doc.id,
				score: 1 - (hit.score || 0), // Convert distance to similarity
				text: options.includeText ? doc.text : undefined,
				vector: options.includeVector ? doc.vector : undefined,
				metadata: doc.metadata ? JSON.parse(doc.metadata) : {},
			}
		})
	}

	// ===============================
	// Retrieval
	// ===============================

	async getById(id: string, userId?: string): Promise<VectorRecord | null> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			const results = await oramaSearch(this.db, {
				where: { id },
				limit: 1,
			})

			if (!results.hits || results.hits.length === 0) return null

			const doc = results.hits[0].document

			if (userId && doc.userId !== userId) return null

			return {
				id: doc.id,
				text: doc.text,
				vector: doc.vector,
				metadata: doc.metadata ? JSON.parse(doc.metadata) : {},
				userId: doc.userId,
			}
		} catch (error) {
			console.error('[VectorStore] GetById error:', error)
			return null
		}
	}

	async list(options?: {
		userId?: string
		limit?: number
		offset?: number
		where?: Partial<Metadata>
	}): Promise<VectorRecord[]> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			const whereClause: Record<string, any> = { ...(options?.where || {}) }
			if (options?.userId) {
				whereClause.userId = options.userId
			}

			const results = await oramaSearch(this.db, {
				where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
				limit: options?.limit || 100,
				offset: options?.offset || 0,
			})

			return (results.hits || []).map((hit: any) => {
				const doc = hit.document
				return {
					id: doc.id,
					text: doc.text,
					vector: doc.vector,
					metadata: doc.metadata ? JSON.parse(doc.metadata) : {},
					userId: doc.userId,
				}
			})
		} catch (error) {
			console.error('[VectorStore] List error:', error)
			return []
		}
	}

	// ===============================
	// Stats
	// ===============================

	async count(userId?: string): Promise<number> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			if (userId) {
				const results = await oramaSearch(this.db, {
					where: { userId },
					limit: 1,
				})
				return results.count || 0
			}
			return await this.db.count()
		} catch (error) {
			console.error('[VectorStore] Count error:', error)
			return 0
		}
	}

	async stats(userId?: string): Promise<{
		totalVectors: number
		dimensions?: number
		storageSizeBytes?: number
	}> {
		const totalVectors = await this.count(userId)

		return {
			totalVectors,
			dimensions: this.dimensions,
			storageSizeBytes: undefined,
		}
	}

	// ===============================
	// Utilities
	// ===============================

	async generateEmbedding(text: string, provider?: IEmbeddingService): Promise<number[]> {
		const embProvider = provider || this.embeddingService
		if (!embProvider) {
			throw new Error('No embedding provider configured')
		}

		const result = await embProvider.generateEmbedding(text)
		return result.embedding
	}

	// ===============================
	// Index Lifecycle (Optional - Orama handles automatically)
	// ===============================

	async rebuildIndex(): Promise<void> {
		// Orama manages index automatically - no manual rebuild needed
		log.debug('[VectorStore Native] Index rebuild not needed (Orama handles automatically)')
	}

	async persist(): Promise<void> {
		if (!this.isReady()) return
		const { db, initializationPromise } = getDatabase()
		if (!db || !initializationPromise) return
		await initializationPromise

		try {
			const results = await oramaSearch(this.db, { limit: 10000 } as any)
			const rows = results.hits || []
			for (const hit of rows) {
				const doc = hit.document as any
				await db.execute(
					`INSERT OR REPLACE INTO vectors
             (id, user_id, vector, metadata, text_content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[
						doc.id,
						doc.userId || '',
						JSON.stringify(doc.vector || []),
						doc.metadata || '{}',
						doc.text || '',
						doc.createdAt || Date.now(),
						doc.updatedAt || Date.now(),
					]
				)
			}
			log.debug(`[VectorStore Native] Persisted ${rows.length} vectors to op-sqlite`)
		} catch (error) {
			console.error('[VectorStore Native] Persist error:', error)
		}
	}

	async warmup(): Promise<void> {
		if (!this.isReady()) return
		const { db, initializationPromise } = getDatabase()
		if (!db || !initializationPromise) return
		await initializationPromise

		try {
			const result = await db.execute('SELECT * FROM vectors LIMIT 10000')
			const rows: any[] = result.rows || []
			let loaded = 0
			for (const row of rows) {
				try {
					await this.db.insert({
						id: row.id,
						text: row.text_content || '',
						vector: JSON.parse(row.vector || '[]'),
						userId: row.user_id || '',
						metadata: row.metadata || '{}',
						createdAt: row.created_at || Date.now(),
						updatedAt: row.updated_at || Date.now(),
					})
					loaded++
				} catch {
					// Skip rows already in Orama or with bad data
				}
			}
			log.debug(`[VectorStore Native] Warmed up: loaded ${loaded} vectors from op-sqlite`)
		} catch (error) {
			console.error('[VectorStore Native] Warmup error:', error)
		}
	}
}
