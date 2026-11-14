import { type AnyOrama, create, insert, remove, search } from '@orama/orama'

import { log } from '../utils/logger'
import type { IEmbeddings } from './IEmbeddingService'

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
}

export class OramaVectorStore implements VectorStore {
	private db: AnyOrama | null = null
	private embeddings: IEmbeddings
	private config: OramaVectorStoreConfig

	constructor(embeddings: IEmbeddings, config: OramaVectorStoreConfig) {
		this.embeddings = embeddings
		this.config = config
	}

	async load(): Promise<this> {
		// eslint-disable-next-line @typescript-eslint/await-thenable -- Orama's types are sync, but components can be async at runtime; keep the await
		this.db = await create({
			schema: {
				id: 'string',
				document: 'string',
				embedding: `vector[${this.config.dimensions}]`,
				metadata: 'string',
			},
		})

		log.debug('[OramaVectorStore] Initialized with dimensions:', this.config.dimensions)
		return this
	}

	async unload(): Promise<void> {
		if (this.db) {
			this.db = null
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
			vector = await this.embeddings.embed(params.document)
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
	}

	async delete(params: { predicate: (value: GetResult) => boolean }): Promise<void> {
		if (!this.db) {
			throw new Error('Vector store not loaded')
		}

		const all = await search(this.db, { term: '', limit: 10000 })
		const toDelete = all.hits
			.map((h) => h.document as unknown as GetResult)
			.filter(params.predicate)

		// eslint-disable-next-line @typescript-eslint/await-thenable -- Orama's types are sync, but components can be async at runtime; keep the await
		await Promise.all(toDelete.map((doc) => remove(this.db!, doc.id)))
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
			vector = await this.embeddings.embed(params.queryText)
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
			id: (h.document as unknown as GetResult).id,
			document: (h.document as unknown as GetResult).document,
			embedding: (h.document as unknown as GetResult).embedding,
			metadata: JSON.parse(
				((h.document as unknown as GetResult).metadata as unknown as string) || '{}'
			),
			score: h.score,
		}))

		return params.predicate ? mapped.filter(params.predicate) : mapped
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
	}
}
