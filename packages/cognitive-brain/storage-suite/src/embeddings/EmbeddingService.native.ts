import { initLlama } from 'llama.rn'

import { log } from '../utils/logger'
import type { IEmbeddingService, IEmbeddings } from './IEmbeddingService'

export type EmbeddingMode = 'gguf' | 'mock'

export interface NativeEmbeddingConfig {
	modelId?: string
	modelPath?: string
	dimensions?: number
	contextLength?: number
	mockMode?: boolean
	nGpuLayers?: number
	nThreads?: number
}

/**
 * Production-grade embedding service for React Native native platforms
 *
 * Uses llama.rn with embedding: true for embedding extraction.
 * Recommended model: nomic-ai/nomic-embed-text-v1.5-GGUF
 *
 * Features:
 * - Uses same llama.rn package as LlamaService (no extra native dependencies)
 * - Supports GGUF models with native embedding support
 * - Automatic dimension discovery from model
 * - Optional config dimensions validation
 *
 * Mode handling:
 * - Provide .gguf modelPath for production
 * - Set mockMode: true explicitly for development/testing
 * - Ambiguous configuration throws an error
 */

export class NativeEmbeddingService implements IEmbeddingService, IEmbeddings {
	private modelLoaded: boolean = false
	private readonly mode: EmbeddingMode
	private readonly modelPath?: string
	private readonly expectedDimensions?: number
	private readonly nGpuLayers?: number
	private readonly nThreads?: number
	private readonly contextLength?: number
	private dimensions: number = 768 // default fallback, will be overridden by model discovery
	private context: any = null

	constructor(config: NativeEmbeddingConfig = {}) {
		this.expectedDimensions = config.dimensions
		this.modelPath = config.modelId || config.modelPath
		this.nGpuLayers = config.nGpuLayers
		this.nThreads = config.nThreads
		this.contextLength = config.contextLength

		if (this.modelPath?.endsWith('.gguf')) {
			this.mode = 'gguf'
		} else if (config.mockMode === true) {
			this.mode = 'mock'
		} else {
			throw new Error(
				'NativeEmbeddingService: provide a .gguf modelPath (or modelId), ' +
					'or set mockMode: true explicitly for development'
			)
		}

		log.debug('NativeEmbeddingService initialized in mode:', this.mode)
	}

	/**
	 * Initialize the embedding model via llama.rn with embedding: true
	 */
	async initialize(): Promise<void> {
		if (this.modelLoaded) return

		try {
			log.debug(`Initializing NativeEmbeddingService in ${this.mode} mode...`)

			if (this.mode === 'mock') {
				console.warn(' Running in MOCK mode - embeddings will be deterministic but meaningless')
				if (this.expectedDimensions) {
					this.dimensions = this.expectedDimensions
				}
				this.modelLoaded = true
				return
			}

			if (!this.modelPath) {
				throw new Error('No model path specified')
			}

			await this.loadModel(this.modelPath)
			this.modelLoaded = true

			log.debug('NativeEmbeddingService ready')
		} catch (error) {
			console.error('Failed to initialize embedding service:', error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`EmbeddingService initialization failed: ${errorMessage}`, { cause: error })
		}
	}

	/**
	 * Load the embedding model (react-native-rag compatible)
	 * @returns Promise that resolves to this instance for fluent chaining
	 */
	async load(): Promise<this> {
		await this.initialize()
		return this
	}

	/**
	 * Unload the embedding model and release resources (react-native-rag compatible)
	 */
	async unload(): Promise<void> {
		await this.cleanup()
	}

	/**
	 * Generate embedding for text (react-native-rag compatible)
	 * @returns Promise that resolves to the embedding vector
	 */
	async embed(text: string): Promise<number[]> {
		if (!this.modelLoaded) {
			await this.initialize()
		}

		if (!text || typeof text !== 'string' || text.trim().length === 0) {
			throw new Error('Invalid text input')
		}

		return this.inferEmbedding(text.trim())
	}

	/**
	 * Generate embedding from text
	 */
	async generateEmbedding(
		text: string
	): Promise<{ embedding: number[]; dimensions: number; modelUsed: string }> {
		if (!this.modelLoaded) {
			await this.initialize()
		}

		try {
			if (!text || typeof text !== 'string' || text.trim().length === 0) {
				throw new Error('Invalid text input')
			}

			log.debug(`Generating embedding for text (length: ${text.length})`)

			const embedding = await this.inferEmbedding(text.trim())

			if (embedding.length !== this.dimensions) {
				throw new Error(
					`Embedding dimensions mismatch: expected ${this.dimensions}, got ${embedding.length}`
				)
			}

			log.debug(`Generated embedding with ${embedding.length} dimensions`)

			return {
				embedding,
				dimensions: this.dimensions,
				modelUsed: this.modelPath || `mock-${this.mode}`,
			}
		} catch (error) {
			console.error('Embedding generation failed:', error)

			if (error instanceof Error) {
				if (error.message.includes('model')) {
					throw new Error('Model inference failed. Please check model configuration.', {
						cause: error,
					})
				} else if (error.message.includes('memory')) {
					throw new Error('Insufficient memory for embedding generation.', { cause: error })
				} else {
					throw new Error(`Embedding generation failed: ${error.message}`, { cause: error })
				}
			} else {
				throw new Error('Embedding generation failed with unknown error', { cause: error })
			}
		}
	}

	/**
	 * Load GGUF embedding model via llama.rn with embedding: true
	 */
	private async loadModel(modelPath: string): Promise<void> {
		log.debug(`Loading GGUF embedding model: ${modelPath}`)

		try {
			this.context = await initLlama({
				model: modelPath,
				embedding: true,
				n_ctx: this.contextLength || 512,
				n_gpu_layers: this.nGpuLayers,
			})

			const { embedding } = await this.context.embedding('test')
			this.dimensions = embedding.length

			if (this.expectedDimensions && this.expectedDimensions !== this.dimensions) {
				throw new Error(
					`Config specifies dimensions=${this.expectedDimensions} but model outputs ${this.dimensions} dimensions`
				)
			}

			log.debug(`Model output dimensions: ${this.dimensions}`)
			log.debug('GGUF embedding model loaded successfully')
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to load GGUF model: ${errorMessage}`, { cause: error })
		}
	}

	/**
	 * Perform inference to generate embedding
	 */
	private async inferEmbedding(text: string): Promise<number[]> {
		switch (this.mode) {
			case 'gguf':
				return this.inferGGUFEmbedding(text)
			case 'mock':
				return this.generateMockEmbedding(text)
			default:
				throw new Error(`Unsupported embedding mode: ${this.mode}`)
		}
	}

	/**
	 * GGUF model inference - extract embeddings using llama.rn
	 */
	private async inferGGUFEmbedding(text: string): Promise<number[]> {
		if (!this.context) {
			throw new Error('GGUF model not loaded')
		}

		try {
			const { embedding } = await this.context.embedding(text)
			return Array.from(embedding)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`GGUF embedding extraction failed: ${errorMessage}`, { cause: error })
		}
	}

	/**
	 * Generate embeddings for multiple texts
	 *
	 * Note: Uses sequential processing instead of concurrent (Promise.all) because:
	 * - GGUF runtime on native is single-threaded
	 * - Concurrent calls would queue anyway, potentially causing memory spikes
	 * - Sequential ensures predictable memory usage on resource-constrained devices
	 */
	async generateEmbeddings(
		texts: string[]
	): Promise<{ embeddings: number[][]; dimensions: number; modelUsed?: string }> {
		log.debug(`Generating embeddings for ${texts.length} texts`)

		if (!this.modelLoaded) {
			await this.initialize()
		}

		try {
			const embeddings: number[][] = []
			for (const text of texts) {
				const result = await this.generateEmbedding(text)
				embeddings.push(result.embedding)
			}
			return {
				embeddings,
				dimensions: this.dimensions,
				modelUsed: this.modelPath || `mock-${this.mode}`,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`Batch embedding failed: ${errorMessage}`, { cause: error })
		}
	}

	/**
	 * Get dimensions of embedding vectors
	 */
	getDimensions(): number {
		log.debug('NativeEmbeddingService getDimensions:', this.dimensions)
		return this.dimensions
	}

	/**
	 * Get the current embedding mode
	 */
	getMode(): EmbeddingMode {
		return this.mode
	}

	/**
	 * Get name of the current model
	 */
	getModelName(): string {
		log.debug('NativeEmbeddingService getModelName:', this.modelPath || `mock-${this.mode}`)
		return this.modelPath || `mock-${this.mode}`
	}

	/**
	 * Generate mock embedding for development/testing
	 */
	private generateMockEmbedding(text: string): number[] {
		let hash = 0
		for (let i = 0; i < text.length; i++) {
			const char = text.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash
		}

		const embedding: number[] = []
		for (let i = 0; i < this.dimensions; i++) {
			const value = Math.sin(hash + i) * 0.1
			embedding.push(value)
		}

		return embedding
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		if (this.modelLoaded) {
			try {
				if (this.context) {
					this.context = null
				}
			} catch (error) {
				console.warn('Error releasing model resources:', error)
			}
			log.debug('Cleaned up NativeEmbeddingService resources')
			this.modelLoaded = false
		}
	}

	/**
	 * Get service status for debugging
	 */
	getStatus(): {
		modelLoaded: boolean
		modelType: EmbeddingMode
		dimensions: number
		modelPath?: string
	} {
		return {
			modelLoaded: this.modelLoaded,
			modelType: this.mode,
			dimensions: this.dimensions,
			modelPath: this.modelPath,
		}
	}
}

export function createEmbeddingService(config?: NativeEmbeddingConfig) {
	// NativeEmbeddingService requires either a .gguf modelPath or explicit mockMode: true.
	// Default to mock when called without a model path so callers (e.g. useRAGOrchestrator)
	// don't crash on initialisation. Callers with a resolved asset path should pass
	// { modelPath } explicitly for real semantic embeddings.
	const resolvedConfig: NativeEmbeddingConfig = config ?? { mockMode: true }
	if (
		!resolvedConfig.modelPath &&
		!resolvedConfig.modelId &&
		resolvedConfig.mockMode === undefined
	) {
		resolvedConfig.mockMode = true
	}
	return new NativeEmbeddingService(resolvedConfig)
}
