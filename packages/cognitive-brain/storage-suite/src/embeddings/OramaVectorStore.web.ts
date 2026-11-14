import { create, insert, load, remove, save, search } from '@orama/orama'

import { log } from '../utils/logger'
import type { IEmbeddingService } from './IEmbeddingService'

export interface GetResult {
	id: string
	document: string
	embedding: number[]
	metadata: Record<string, any>
}

export interface QueryResult extends GetResult {
	score: number
}

export interface VectorStore {
	load(): Promise<this>
	unload(): Promise<void>
	add(params: {
		id?: string
		document?: string
		embedding?: number[]
		metadata?: Record<string, any>
	}): Promise<string>
	update(params: {
		id: string
		document?: string
		embedding?: number[]
		metadata?: Record<string, any>
	}): Promise<void>
	delete(params: { predicate: (value: GetResult) => boolean }): Promise<void>
	query(params: {
		queryText?: string
		queryEmbedding?: number[]
		nResults?: number
		predicate?: (value: QueryResult) => boolean
	}): Promise<QueryResult[]>
}

export interface OramaVectorStoreConfig {
	dimensions: number
	persistToDisk?: boolean
	dbName?: string
}

export class OramaVectorStore implements VectorStore {
	private db: any = null
	private embeddings: IEmbeddingService
	private config: OramaVectorStoreConfig
	private initialized: boolean = false
	private dbName: string

	constructor(embeddings: IEmbeddingService, config: OramaVectorStoreConfig) {
		this.embeddings = embeddings
		this.config = config
		this.dbName = config.dbName || 'orama-vector-db'

		// Prevent "Database Blocked" errors on refresh
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', () => {
				if (this.db) {
					// Standard IDB practice: close connections before the tab dies
					const request = indexedDB.open(this.dbName, 2)
					request.onsuccess = (e) => {
						const db = (e.target as IDBOpenDBRequest).result
						db.close()
					}
				}
			})
		}
	}

	async load(): Promise<this> {
		if (this.initialized) {
			log.debug('[OramaVectorStore] Already initialized')
			return this
		}

		try {
			log.debug('[OramaVectorStore] Starting initialization...')

			// Create database schema
			// eslint-disable-next-line @typescript-eslint/await-thenable -- Orama's types are sync, but components can be async at runtime; keep the await
			this.db = await create({
				schema: {
					id: 'string',
					document: 'string',
					embedding: `vector[${this.config.dimensions}]`,
					metadata: 'string',
				},
			})

			// Try to load from IndexedDB if persistence is enabled
			if (this.config.persistToDisk) {
				const data = await this.restoreFromIndexedDB()
				if (data) {
					// eslint-disable-next-line @typescript-eslint/await-thenable -- Orama's types are sync, but components can be async at runtime; keep the await
					await load(this.db, data)
					log.debug('[OramaVectorStore] Loaded from IndexedDB')
				} else {
					log.debug('[OramaVectorStore] No data found in IndexedDB, starting fresh')
				}
			}

			this.initialized = true
			log.debug('[OramaVectorStore] Initialized with dimensions:', this.config.dimensions)
			return this
		} catch (error) {
			console.error('[OramaVectorStore] Initialization failed:', error)
			throw error
		}
	}

	async unload(): Promise<void> {
		if (this.db && this.config.persistToDisk) {
			await this.persist()
		}
		if (this.db) {
			this.db = null
		}
		this.initialized = false
	}

	// IndexedDB helpers
	private async saveToIndexedDB(data: any): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 2)

			request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result
				if (!db.objectStoreNames.contains('orama')) {
					db.createObjectStore('orama', { keyPath: 'id' })
				}
			}

			request.onsuccess = (event) => {
				const db = (event.target as IDBOpenDBRequest).result

				if (!db.objectStoreNames.contains('orama')) {
					db.close()
					return reject(new Error("Store 'orama' not found"))
				}

				const tx = db.transaction('orama', 'readwrite')
				const store = tx.objectStore('orama')

				store.put({ id: 'data', data: data })

				tx.oncomplete = () => {
					db.close()
					resolve()
				}

				tx.onerror = () => {
					db.close()
					reject(tx.error ?? new Error('IndexedDB transaction failed'))
				}
			}
		})
	}

	private async restoreFromIndexedDB(): Promise<any> {
		return new Promise((resolve) => {
			const request = indexedDB.open(this.dbName, 2)
			let isNew = false

			request.onerror = () => {
				console.warn('[OramaVectorStore] IndexedDB open error')
				resolve(null)
			}

			request.onupgradeneeded = (event) => {
				isNew = true
				const db = (event.target as IDBOpenDBRequest).result
				if (!db.objectStoreNames.contains('orama')) {
					db.createObjectStore('orama', { keyPath: 'id' })
				}
			}

			request.onsuccess = (event) => {
				const db = (event.target as IDBOpenDBRequest).result

				if (isNew || !db.objectStoreNames.contains('orama')) {
					db.close()
					return resolve(null)
				}

				try {
					const tx = db.transaction('orama', 'readonly')
					const store = tx.objectStore('orama')
					const getRequest = store.get('data')

					getRequest.onsuccess = () => {
						const result = getRequest.result
						db.close()
						if (result && result.data) {
							resolve(result.data)
						} else {
							resolve(null)
						}
					}

					getRequest.onerror = () => {
						db.close()
						resolve(null)
					}
				} catch {
					db.close()
					resolve(null)
				}
			}
		})
	}

	private async persist(): Promise<void> {
		if (!this.initialized || !this.db || !this.config.persistToDisk) return

		try {
			// eslint-disable-next-line @typescript-eslint/await-thenable -- Orama's types are sync, but components can be async at runtime; keep the await
			const data = await save(this.db)
			await this.saveToIndexedDB(data)
			log.debug('[OramaVectorStore] Persisted to IndexedDB')
		} catch (error) {
			console.error('[OramaVectorStore] Persist error:', error)
		}
	}

	async add(params: {
		id?: string
		document?: string
		embedding?: number[]
		metadata?: Record<string, any>
	}): Promise<string> {
		if (!this.db) {
			throw new Error('Vector store not loaded')
		}

		let vector = params.embedding

		if (!vector && params.document) {
			const result = await this.embeddings.generateEmbedding(params.document)
			vector = result.embedding
		}

		if (!vector) {
			throw new Error('Either document or embedding must be provided')
		}

		const docId = params.id || this.generateId()

		await insert(this.db, {
			id: docId,
			document: params.document || '',
			embedding: vector,
			metadata: JSON.stringify(params.metadata || {}),
		})

		if (this.config.persistToDisk) {
			await this.persist()
		}

		return docId
	}

	async update(params: {
		id: string
		document?: string
		embedding?: number[]
		metadata?: Record<string, any>
	}): Promise<void> {
		if (!this.db) {
			throw new Error('Vector store not loaded')
		}

		await this.delete({ predicate: (v) => v.id === params.id })
		await this.add({
			id: params.id,
			document: params.document,
			embedding: params.embedding,
			metadata: params.metadata,
		})
		// Persistence is handled in add method
	}

	async delete(params: { predicate: (value: GetResult) => boolean }): Promise<void> {
		if (!this.db) {
			throw new Error('Vector store not loaded')
		}

		const all = await search(this.db, { term: '', limit: 10000 })
		const toDelete = all.hits.map((h) => h.document as GetResult).filter(params.predicate)

		// eslint-disable-next-line @typescript-eslint/await-thenable -- Orama's types are sync, but components can be async at runtime; keep the await
		await Promise.all(toDelete.map((doc) => remove(this.db!, doc.id)))

		if (this.config.persistToDisk) {
			await this.persist()
		}
	}

	async query(params: {
		queryText?: string
		queryEmbedding?: number[]
		nResults?: number
		predicate?: (value: QueryResult) => boolean
	}): Promise<QueryResult[]> {
		if (!this.db) {
			throw new Error('Vector store not loaded')
		}

		let vector = params.queryEmbedding

		if (!vector && params.queryText) {
			const result = await this.embeddings.generateEmbedding(params.queryText)
			vector = result.embedding
		}

		if (!vector) {
			throw new Error('Either queryText or queryEmbedding must be provided')
		}

		const limit = params.nResults || 5

		const results = await search(this.db, {
			mode: 'hybrid',
			vector: { value: vector, property: 'embedding' },
			term: params.queryText || '',
			limit,
		})

		const mapped: QueryResult[] = results.hits.map((h) => ({
			id: (h.document as any).id,
			document: (h.document as any).document,
			embedding: (h.document as any).embedding,
			metadata: JSON.parse((h.document as any).metadata || '{}'),
			score: h.score,
		}))

		return params.predicate ? mapped.filter(params.predicate) : mapped
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
	}
}
