// src/embeddings/IEmbeddingService.ts

export interface EmbeddingResult {
	embedding: number[]
	dimensions: number
	modelUsed: string
	processingTimeMs?: number
}

export interface EmbeddingBatchResult {
	embeddings: number[][]
	dimensions: number
	modelUsed: string
	processingTimeMs?: number
	failedIndices?: number[] // Indices of texts that failed to embed
}

export interface IEmbeddingService {
	initialize(): Promise<void>
	generateEmbedding(
		text: string
	): Promise<{ embedding: number[]; dimensions: number; modelUsed?: string }>
	generateEmbeddings(
		texts: string[]
	): Promise<{ embeddings: number[][]; dimensions: number; modelUsed?: string }>
	/**
	 * Optional: a model that embeds queries and documents differently (task prefixes, e.g. EmbeddingGemma 2) implements
	 * this for search queries; `generateEmbedding` is then the document side. Callers fall back to `generateEmbedding`.
	 */
	generateQueryEmbedding?(
		text: string
	): Promise<{ embedding: number[]; dimensions: number; modelUsed?: string }>
	getDimensions(): number
	getModelName(): string
	cleanup(): Promise<void>
	isInitialized?(): boolean
}

export interface IEmbeddings {
	load(): Promise<this>
	unload(): Promise<void>
	embed(text: string): Promise<number[]>
}

export interface EmbeddingConfig {
	provider?: 'openai' | 'mlc' | 'gguf' | 'auto'
	modelName?: string
	dimensions?: number
	openaiApiKey?: string
	mlcModel?: string
	ggufModel?: string
	maxBatchSize?: number
}

// Provider-specific configurations
export interface OpenAIEmbeddingConfig extends EmbeddingConfig {
	apiKey: string
	model?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002'
	dimensions?: 1536 | 3072 // Depends on model
}

export interface MLCEmbeddingConfig extends EmbeddingConfig {
	modelId: string
	modelPath?: string
	quantization?: string
	deviceType?: 'cpu' | 'gpu' | 'webgpu'
}

export interface GGUFEmbeddingConfig extends EmbeddingConfig {
	modelPath: string
	nGpuLayers?: number
	nThreads?: number
	contextLength?: number
}
