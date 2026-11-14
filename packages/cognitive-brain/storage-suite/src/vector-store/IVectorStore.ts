/**
 * IVectorStore Interface
 * Consolidated vector database interface using Orama for vector + text search
 *
 * Key features:
 * - Interface-based abstraction
 * - Multi-tenancy support (userId)
 * - Batch ingestion
 * - Embedding provider abstraction
 * - Metadata filtering
 * - Hybrid search (vector + keyword)
 */
import type { IEmbeddingService } from '../embeddings/IEmbeddingService'

// ===============================
// Core Types
// ===============================

export type Metadata = Record<string, any>

// VectorRecord - must have either vector or text (or both)
export type VectorRecord<T = Metadata> = (
	{ vector: number[]; text?: string } | { text: string; vector?: number[] }
) & {
	id?: string
	metadata: T
	userId?: string
}

export interface VectorSearchOptions<T = Metadata> {
	topK: number
	userId?: string

	/**
	 * Metadata filters (flexible, backend-agnostic)
	 */
	where?: Partial<T> & Record<string, any>

	/**
	 * Optional hybrid search weight (if supported)
	 */
	hybrid?: {
		text?: string
		vector?: number[]
		alpha?: number // balance between text and vector (0 = text only, 1 = vector only)
	}

	/**
	 * Include vectors/text in response
	 */
	includeVector?: boolean
	includeText?: boolean
}

export interface VectorSearchResult<T = Metadata> {
	id: string
	score: number
	metadata: T
	text?: string
	vector?: number[]
}

// ===============================
// Vector Store Interface
// ===============================

export interface IVectorStore<T = Metadata> {
	/**
	 * Initialize the database / index
	 */
	init(): Promise<void>

	/**
	 * Close / cleanup resources
	 */
	close(): Promise<void>

	/**
	 * Health check
	 */
	isReady(): boolean

	// -------------------------------
	// Write Operations
	// -------------------------------

	/**
	 * Add records to the vector store (supports batch)
	 */
	add(records: VectorRecord<T>[]): Promise<string[]>

	/**
	 * Update an existing record
	 */
	update(id: string, data: Partial<VectorRecord<T>>): Promise<boolean>

	/**
	 * Delete a single record
	 */
	delete(id: string, userId?: string): Promise<boolean>

	/**
	 * Delete records matching filter
	 */
	deleteWhere(where: Partial<T> & Record<string, any>, userId?: string): Promise<number>

	/**
	 * Clear all records (optionally for specific user)
	 */
	clear(userId?: string): Promise<void>

	// -------------------------------
	// Read / Search Operations
	// -------------------------------

	/**
	 * Search by vector similarity
	 * Use options.hybrid for combined vector + text search
	 */
	search(query: number[], options: VectorSearchOptions<T>): Promise<VectorSearchResult<T>[]>

	// -------------------------------
	// Retrieval
	// -------------------------------

	/**
	 * Get a single record by ID
	 */
	getById(id: string, userId?: string): Promise<VectorRecord<T> | null>

	/**
	 * List records with optional filtering and pagination
	 */
	list(options?: {
		userId?: string
		limit?: number
		offset?: number
		where?: Partial<T> & Record<string, any>
	}): Promise<VectorRecord<T>[]>

	// -------------------------------
	// Index Lifecycle (Optional)
	// -------------------------------

	/**
	 * Rebuild the search index (useful after bulk operations)
	 */
	rebuildIndex?(): Promise<void>

	/**
	 * Explicitly persist data to storage
	 */
	persist?(): Promise<void>

	/**
	 * Warm up the index for faster initial queries
	 */
	warmup?(): Promise<void>

	// -------------------------------
	// Stats / Introspection
	// -------------------------------

	/**
	 * Count total records (optionally for specific user)
	 */
	count(userId?: string): Promise<number>

	/**
	 * Get storage statistics
	 */
	stats(userId?: string): Promise<{
		totalVectors: number
		dimensions?: number
		storageSizeBytes?: number
	}>

	// -------------------------------
	// Embedding Utilities
	// -------------------------------

	/**
	 * Generate embedding for text (if embedding provider configured)
	 */
	generateEmbedding?(text: string, provider?: IEmbeddingService): Promise<number[]>
}

// ===============================
// Configuration
// ===============================

export interface VectorStoreConfig {
	/**
	 * Database name
	 */
	dbName?: string

	/**
	 * Embedding dimensions (auto-detected if not provided)
	 */
	dimensions?: number

	/**
	 * Embedding provider for auto-embedding
	 */
	embeddingProvider?: IEmbeddingService

	/**
	 * Storage type for persistence
	 */
	persistTo?: 'memory' | 'indexeddb' | 'sqlite'

	/**
	 * Distance metric for vector similarity
	 * - 'cosine' (default): cosine similarity
	 * - 'l2': Euclidean distance
	 * - 'ip': inner product (dot product)
	 */
	distanceMetric?: 'cosine' | 'l2' | 'ip'

	/**
	 * Require userId for all operations (multi-tenant safety)
	 * When true, operations without userId will throw error
	 */
	requireUserScope?: boolean

	/**
	 * Schema for Orama
	 */
	schema?: Record<string, unknown>
}
