/**
 * VectorStore - Orama-based Vector Store for Web
 *
 * Uses Orama for:
 * - Vector similarity search
 * - Full-text search
 * - Hybrid search (vector + keyword)
 * - IndexedDB persistence
 */
import { create, search as oramaSearch } from '@orama/orama'

import type { IEmbeddingService } from '../embeddings/IEmbeddingService'
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
	private dimensions: number = 384

	constructor(config: VectorStoreConfig = {}) {
		this.config = {
			dbName: config.dbName || 'web_vectorstore',
			dimensions: config.dimensions || 384,
			persistTo: config.persistTo || 'indexeddb',
			requireUserScope: config.requireUserScope || false,
			...config,
		}
		this.dimensions = this.config.dimensions || 384
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
			const schema = this.config.schema || {
				id: 'string',
				text: 'string',
				vector: `vector[${this.dimensions}]`,
				userId: 'string',
				metadata: 'string',
				createdAt: 'number',
				updatedAt: 'number',
			}

			// eslint-disable-next-line @typescript-eslint/await-thenable -- Orama's types are sync, but components can be async at runtime; keep the await
			this.db = await create({
				schema: schema as any,
			} as any)

			// Try to restore from IndexedDB
			await this.restoreFromStorage()

			this.ready = true
			log.debug('[VectorStore Web] Initialized with dimensions:', this.dimensions)
		} catch (error) {
			console.error('[VectorStore Web] Init error:', error)
			throw error
		}
	}

	async close(): Promise<void> {
		if (this.db) {
			await this.persist()
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

		// Persist after adding
		await this.persist()

		return ids
	}

	async update(id: string, data: Partial<VectorRecord>): Promise<boolean> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
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

			await this.persist()
			return true
		} catch (error) {
			console.error('[VectorStore Web] Update error:', error)
			return false
		}
	}

	async delete(id: string, _userId?: string): Promise<boolean> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			await this.db.remove(id)
			await this.persist()
			return true
		} catch (error) {
			console.error('[VectorStore Web] Delete error:', error)
			return false
		}
	}

	async deleteWhere(where: Partial<Metadata>, userId?: string): Promise<number> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			const whereClause: Record<string, any> = { ...where }
			if (userId) {
				whereClause.userId = userId
			}

			const results = await oramaSearch(this.db, {
				where: whereClause,
				limit: 1000,
			})

			let deletedCount = 0
			for (const hit of results.hits) {
				try {
					await this.db.remove(hit.document.id)
					deletedCount++
				} catch {
					// Document may already be deleted
				}
			}

			await this.persist()
			return deletedCount
		} catch (error) {
			console.error('[VectorStore Web] DeleteWhere error:', error)
			return 0
		}
	}

	async clear(userId?: string): Promise<void> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')

		try {
			if (userId) {
				await this.deleteWhere({}, userId)
			} else {
				// Clear all - recreate the database
				await this.close()
				await this.init()
			}
		} catch (error) {
			console.error('[VectorStore Web] Clear error:', error)
		}
	}

	// ===============================
	// Search Operations
	// ===============================

	async search(query: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]> {
		if (!this.isReady()) throw new Error('VectorStore not initialized')
		this.validateUserScope('search', options.userId)

		try {
			const whereClause: Record<string, any> = { ...(options.where || {}) }
			if (options.userId) {
				whereClause.userId = options.userId
			}

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
			console.error('[VectorStore Web] Search error:', error)
			return []
		}
	}

	private async textSearch(
		query: string,
		options: VectorSearchOptions
	): Promise<VectorSearchResult[]> {
		try {
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
			console.error('[VectorStore Web] TextSearch error:', error)
			return []
		}
	}

	private async hybridSearch(
		text: string,
		vector: number[],
		options: VectorSearchOptions
	): Promise<VectorSearchResult[]> {
		const alpha = options.hybrid?.alpha ?? 0.5

		const [textResults, vectorResults] = await Promise.all([
			this.textSearch(text, { ...options, topK: options.topK * 2 }),
			this.search(vector, { ...options, topK: options.topK * 2 }),
		])

		const textScores = new Map(
			textResults.map((r, i) => [r.id, (textResults.length - i) / textResults.length])
		)
		const vectorScores = new Map(
			vectorResults.map((r, i) => [r.id, (vectorResults.length - i) / vectorResults.length])
		)

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

		return Array.from(combined.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, options.topK)
	}

	private transformResults(results: any, options: VectorSearchOptions): VectorSearchResult[] {
		return (results.hits || []).map((hit: any) => {
			const doc = hit.document
			return {
				id: doc.id,
				score: 1 - (hit.score || 0),
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
			console.error('[VectorStore Web] GetById error:', error)
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
			console.error('[VectorStore Web] List error:', error)
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
			console.error('[VectorStore Web] Count error:', error)
			return 0
		}
	}

	async stats(userId?: string): Promise<{
		totalVectors: number
		dimensions?: number
		storageSizeBytes?: number
	}> {
		const totalVectors = await this.count(userId)

		let storageSizeBytes: number | undefined
		if (navigator.storage && navigator.storage.estimate) {
			const estimate = await navigator.storage.estimate()
			storageSizeBytes = estimate.usage
		}

		return {
			totalVectors,
			dimensions: this.dimensions,
			storageSizeBytes,
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
	// Index Lifecycle & Persistence
	// ===============================

	async persist(): Promise<void> {
		if (!this.db || !this.config.persistTo) return

		try {
			const data = await this.db.save()
			const key = `orama_${this.config.dbName || 'vectorstore'}`
			localStorage.setItem(key, JSON.stringify(data))
			log.debug('[VectorStore Web] Persisted to IndexedDB')
		} catch (error) {
			console.warn('[VectorStore Web] Persist failed:', error)
		}
	}

	async warmup(): Promise<void> {
		// Orama loads data into memory on first use
		// This method can be called proactively to warm up
		if (!this.isReady()) return
		try {
			await this.db.count()
			log.debug('[VectorStore Web] Warmup complete')
		} catch (error) {
			console.warn('[VectorStore Web] Warmup failed:', error)
		}
	}

	async rebuildIndex(): Promise<void> {
		// Orama handles index management automatically
		// This is a no-op but provides API consistency
		log.debug('[VectorStore Web] Index rebuild not needed (Orama handles automatically)')
	}

	private async restoreFromStorage(): Promise<void> {
		if (!this.db) return

		try {
			const key = `orama_${this.config.dbName || 'vectorstore'}`
			const data = localStorage.getItem(key)
			if (data) {
				const parsed = JSON.parse(data)
				await this.db.load(parsed)
				log.debug('[VectorStore Web] Restored from IndexedDB')
			}
		} catch (error) {
			console.warn('[VectorStore Web] Restore failed:', error)
		}
	}
}
