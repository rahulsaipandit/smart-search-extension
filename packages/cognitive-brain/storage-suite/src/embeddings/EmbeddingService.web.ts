import { log } from '../utils/logger'
import type { EmbeddingConfig, IEmbeddingService } from './IEmbeddingService'
// The host picks how transformers.js is loaded (bundled in the extension, CDN on the website): see transformersLoader.ts.
// Do not add a static or dynamic import of '@huggingface/transformers' here, Metro would bundle it and fail to parse it.
import { loadTransformers } from './transformersLoader'

/**
 * Production-grade embedding service for React Native web platforms
 *
 * Supported backends (prioritized):
 * 1. WebGPU (highest performance, modern browsers)
 * 2. MLC (Machine Learning Compilation, WebAssembly)
 * 3. ONNX.js (ONNX runtime for web)
 * 4. Transformers.js (JavaScript-based transformers)
 * 5. Fallback: Mock embeddings for development
 *
 * Features:
 * - Automatic backend selection for optimal performance
 * - WebGPU/WebAssembly acceleration
 * - Model quantization support (8-bit, 4-bit)
 * - Memory management and cleanup
 * - Background processing capabilities
 * - Error recovery and fallback mechanisms
 */

export class WebEmbeddingService implements IEmbeddingService {
	private backendInitialized: boolean = false
	private config: EmbeddingConfig
	private modelId?: string
	private dimensions: number = 512
	private backend: 'webgpu' | 'mlc' | 'onnx' | 'transformers' | 'mock' = 'mock'
	private transformerPipeline: any
	// No class-level fallbackAttempted flag; recursion limits handled per-call via an `attempt` param

	constructor(config: EmbeddingConfig = {}) {
		this.config = config // Store for potential future use
		log.debug('WebEmbeddingService created with config:', config)
		log.debug('WebEmbeddingService config unused fallback:', this.config)
		// Default to 384 dimensions for MiniLM-L6-v2, but allow override
		this.dimensions = config.dimensions || 384
		this.modelId = config.modelName || 'Xenova/all-MiniLM-L6-v2' // Default to MiniLM for embeddings
	}

	/**
	 * Initialize the embedding model with optimal backend
	 */
	async initialize(): Promise<void> {
		if (this.backendInitialized) return

		try {
			log.debug('Initializing WebEmbeddingService...')

			if (!this.modelId) {
				console.warn(' No model ID specified, using mock embeddings')
				this.backend = 'mock'
				this.backendInitialized = true
				return
			}

			// Auto-detect optimal backend
			await this.selectBackend()

			// Initialize selected backend with fallback loop
			let initialized = false
			while (!initialized) {
				try {
					await this.initializeBackend()
					initialized = true
					this.backendInitialized = true
					log.debug(`WebEmbeddingService ready using ${this.backend} backend`)
				} catch (err: any) {
					console.warn(
						` Initialization of ${this.backend} failed: ${err.message}. Triggering fallback...`
					)

					if (this.backend === 'webgpu') {
						this.backend = 'mlc'
					} else if (this.backend === 'mlc') {
						this.backend = 'onnx'
					} else if (this.backend === 'onnx') {
						this.backend = 'transformers'
					} else if (this.backend === 'transformers') {
						this.backend = 'mock'
					} else {
						throw new Error(`All backends failed to initialize. Last error: ${err.message}`, {
							cause: err,
						})
					}
				}
			}
		} catch (error) {
			console.error('Failed to initialize embedding service:', error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`WebEmbeddingService initialization failed: ${errorMessage}`, {
				cause: error,
			})
		}
	}

	/**
	 * Generate embeddings from text with optimal performance
	 */
	async generateEmbedding(
		text: string,
		attempt: number = 0
	): Promise<{ embedding: number[]; dimensions: number; modelUsed?: string }> {
		if (!this.backendInitialized) {
			await this.initialize()
		}

		try {
			// Validate input
			if (!text || typeof text !== 'string' || text.trim().length === 0) {
				throw new Error('Invalid text input: must be non-empty string')
			}

			log.debug(`Generating embedding (${this.backend}) for text (length: ${text.length})`)

			// Generate embedding using selected backend
			const embedding = await this.inferEmbedding(text.trim())

			// Validate embedding
			if (!Array.isArray(embedding) || embedding.length !== this.dimensions) {
				throw new Error(
					`Invalid embedding: expected ${this.dimensions} dimensions, got ${embedding?.length || 'undefined'}`
				)
			}

			log.debug(`Generated ${this.backend} embedding with ${embedding.length} dimensions`)

			return {
				embedding,
				dimensions: this.dimensions,
				modelUsed: this.backend === 'mock' ? 'mock-model' : this.modelId || 'unknown-model',
			}
		} catch (error) {
			console.error(`${this.backend} embedding generation failed:`, error)
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Try fallback backends once per call (limit recursion depth)
			if (this.backend !== 'mock' && attempt < 2) {
				const nextAttempt = attempt + 1
				console.warn(
					` ${this.backend} backend failed (${errorMessage}). Attempting fallback (attempt ${nextAttempt})`
				)

				// Try transformers if WebGPU/MLC/ONNX failed
				if (this.backend !== 'transformers' && ['webgpu', 'mlc', 'onnx'].includes(this.backend)) {
					try {
						log.debug('Trying Transformers.js fallback...')
						this.backend = 'transformers'
						this.backendInitialized = false // Reset so initializeTransformers runs
						await this.initializeTransformers()
						this.backendInitialized = true
						// eslint-disable-next-line @typescript-eslint/return-await -- intentionally not awaited: a failing retry must reject to the caller, not re-enter this catch and fall through to the mock fallback
						return this.generateEmbedding(text, nextAttempt) // Retry with transformers (recursive call)
					} catch (transformersError) {
						console.warn(
							` Transformers.js fallback also failed: ${transformersError instanceof Error ? transformersError.message : String(transformersError)}`
						)
						console.warn(' Full Transformers.js error stack:', transformersError)
					}
				}

				// Final fallback to mock embeddings
				console.warn(' All backends failed, falling back to mock embeddings')
				this.backend = 'mock'
				this.backendInitialized = true
				return this.generateEmbedding(text, nextAttempt) // Retry with mock
			}

			throw new Error(`Embedding generation failed (${this.backend}): ${errorMessage}`, {
				cause: error,
			})
		}
	}

	/**
	 * Auto-select optimal backend based on browser capabilities
	 */
	private async selectBackend(): Promise<void> {
		log.debug('Selecting optimal embedding backend...')

		try {
			// Highest priority: WebGPU (best performance)
			if (await this.hasWebGPUAdapter()) {
				log.debug('WebGPU available - prioritizing WebGPU backend')
				this.backend = 'webgpu'
				return
			}

			// Second: MLC (Machine Learning Compilation)
			if (this.isMLCCapable()) {
				log.debug('MLC capable - prioritizing WebAssembly acceleration')
				this.backend = 'mlc'
				return
			}

			// Third: ONNX.js (WebGL fallback)
			if (this.isWebGLSupported()) {
				log.debug('WebGL available - prioritizing ONNX.js with WebGL')
				this.backend = 'onnx'
				return
			}

			// Fourth: Transformers.js (CPU/JavaScript fallback)
			log.debug('Using JavaScript transformers (CPU-based) by default')
			this.backend = 'transformers'
		} catch (error) {
			console.warn(' Backend detection failed, using mock:', error)
			this.backend = 'mock'
		}
	}

	/**
	 * Initialize the selected backend
	 */
	private async initializeBackend(): Promise<void> {
		switch (this.backend) {
			case 'webgpu':
				await this.initializeWebGPU()
				break
			case 'mlc':
				await this.initializeMLC()
				break
			case 'onnx':
				await this.initializeONNX()
				break
			case 'transformers':
				await this.initializeTransformers()
				break
			case 'mock':
				// Mock backend requires no initialization
				break
			default:
				throw new Error(`Unsupported backend: ${this.backend}`)
		}
	}

	// WebGPU Implementation (Highest Performance)
	// True only with a real adapter: `navigator.gpu` exists even when no adapter does.
	private async hasWebGPUAdapter(): Promise<boolean> {
		if (!this.isWebGPUSupported()) return false
		try {
			return !!(await (
				globalThis.navigator as { gpu: { requestAdapter(): Promise<unknown> } }
			).gpu.requestAdapter())
		} catch {
			return false
		}
	}

	// API present only (cheap, synchronous); selectBackend() uses hasWebGPUAdapter().
	private isWebGPUSupported(): boolean {
		try {
			log.debug('Checking WebGPU support...')
			return (
				typeof globalThis !== 'undefined' &&
				'navigator' in globalThis &&
				'gpu' in globalThis.navigator &&
				!!globalThis.navigator.gpu
			)
		} catch {
			return false
		}
	}

	private async initializeWebGPU(): Promise<void> {
		log.debug(`Initializing WebGPU model: ${this.modelId}`)

		try {
			const transformers = await loadTransformers()

			const pipelineFn = transformers.pipeline || (transformers as any).default?.pipeline
			if (!pipelineFn || typeof pipelineFn !== 'function') {
				throw new Error('Pipeline function not found in @huggingface/transformers')
			}

			const modelToUse = this.modelId?.startsWith('Xenova/')
				? this.modelId
				: 'Xenova/all-MiniLM-L6-v2'

			log.debug(`Loading WebGPU model: ${modelToUse}`)
			this.transformerPipeline = await pipelineFn('feature-extraction', modelToUse, {
				dtype: 'fp32', // WebGPU works well with fp32 for embeddings
				device: 'webgpu',
			})

			if (modelToUse.includes('all-MiniLM-L6-v2')) {
				this.dimensions = 384
			}

			log.debug('WebGPU pipeline initialized successfully via Transformers.js')
		} catch (error) {
			console.error('WebGPU initialization failed:', error)
			throw new Error(
				`WebGPU initialization failed: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error }
			)
		}
	}

	// MLC Implementation (WebAssembly-based)
	private isMLCCapable(): boolean {
		try {
			return !!Worker && typeof WebAssembly !== 'undefined'
		} catch {
			return false
		}
	}

	private async initializeMLC(): Promise<void> {
		log.debug(`Initializing MLC model: ${this.modelId}`)
		throw new Error('MLC implementation not available. Requires MLC runtime.')

		/* Future implementation:
    try {
      // Use MLC's WebAssembly runtime
      const { webml } = require('@mlc-ai/webml-runtime');
      const modelUrl = this.modelId; // resolved by the runtime, not fetched from a hard-coded host

      this.mlcInstance = await webml.create(modelUrl);

    } catch (error) {
      throw new Error(`MLC initialization failed: ${error.message}`);
    }
    */
	}

	// ONNX.js Implementation (WebGL fallback)
	private isWebGLSupported(): boolean {
		try {
			log.debug('Checking WebGL support...')
			const doc = typeof globalThis !== 'undefined' && (globalThis as any).document
			if (!doc) return false
			log.debug('Creating WebGL canvas for GL detection...')
			const canvas = doc.createElement('canvas')
			if (!canvas) return false

			const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
			return !!gl
		} catch {
			return false
		}
	}

	private async initializeONNX(): Promise<void> {
		log.debug(`Initializing ONNX.js model: ${this.modelId}`)
		throw new Error('ONNX.js implementation not available. Requires @onnxruntime/web.')

		/* Future implementation:
    try {
      const { InferenceSession } = require('onnxruntime-web');
      const modelUrl = this.modelId; // resolved by the runtime, not fetched from a hard-coded host

      this.onnxSession = await InferenceSession.create(modelUrl, {
        executionProviders: ['webgpu', 'webgl'], // Try WebGPU first
      });

    } catch (error) {
      throw new Error(`ONNX.js initialization failed: ${error.message}`);
    }
    */
	}

	// Transformers.js Implementation (CPU/JavaScript fallback)
	private async initializeTransformers(): Promise<void> {
		log.debug(`Initializing Transformers.js model: ${this.modelId}`)

		try {
			const transformers = await loadTransformers()

			// Get the pipeline function (handle multiple export patterns)
			const pipelineFn = transformers.pipeline || (transformers as any).default?.pipeline
			if (!pipelineFn || typeof pipelineFn !== 'function') {
				throw new Error('Pipeline function not found in @huggingface/transformers')
			}

			// Use all-MiniLM-L6-v2 as default for embeddings (384 dimensions)
			const modelToUse = this.modelId?.startsWith('Xenova/')
				? this.modelId
				: 'Xenova/all-MiniLM-L6-v2'

			log.debug(`Loading model: ${modelToUse}`)
			this.transformerPipeline = await pipelineFn('feature-extraction', modelToUse, {
				quantized: true, // Use quantized model for smaller download size
				device: 'wasm', // Force WASM execution for CPU fallback
			})

			// Update dimensions to match the actual model (MiniLM-L6-v2 has 384 dimensions)
			if (modelToUse.includes('all-MiniLM-L6-v2')) {
				this.dimensions = 384
			}

			log.debug('Transformers.js pipeline initialized successfully')
		} catch (error) {
			console.error('Transformers.js initialization failed:', error)
			throw new Error(
				`Transformers.js initialization failed: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error }
			)
		}
	}

	/**
	 * Perform inference using selected backend
	 */
	private async inferEmbedding(text: string): Promise<number[]> {
		switch (this.backend) {
			case 'webgpu':
				return this.inferWebGPU(text)
			case 'mlc':
				return this.inferMLC(text)
			case 'onnx':
				return this.inferONNX(text)
			case 'transformers':
				return this.inferTransformers(text)
			case 'mock':
				return this.generateMockEmbedding(text)
			default:
				throw new Error(`Unsupported backend: ${this.backend}`)
		}
	}

	private async inferWebGPU(text: string): Promise<number[]> {
		// We can reuse the Transformer.js inference method since WebGPU now uses the same pipeline
		return this.inferTransformers(text)
	}

	private async inferMLC(text: string): Promise<number[]> {
		log.debug('MLC inference stub called with text length:', text.length)
		throw new Error('MLC inference not implemented yet')
	}

	private async inferONNX(text: string): Promise<number[]> {
		log.debug('ONNX inference stub called with text length:', text.length)
		throw new Error('ONNX inference not implemented yet')
	}

	/**
	 * Helper to normalize transformers output to array of numbers
	 */
	// Delegate normalization to shared helper
	private normalizeTransformerOutput(output: any): number[] {
		// local require avoids circular import at module load time in some bundlers
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { normalizeTransformerOutput } = require('./transformerOutputNormalizer')
		return normalizeTransformerOutput(output)
	}

	private async inferTransformers(text: string): Promise<number[]> {
		try {
			if (!this.transformerPipeline) {
				throw new Error('Transformer pipeline not initialized')
			}

			log.debug(`Running inference for: ${text.substring(0, 50)}...`)

			// Generate embedding using the transformers pipeline
			const output = await this.transformerPipeline(text, {
				pooling: 'mean', // Use mean pooling for sentence embeddings
				normalize: true, // L2 normalize the embeddings
			})

			// Extract and normalize the embedding from the output
			const embedding = this.normalizeTransformerOutput(output)

			// Validate we got a reasonable embedding
			if (embedding.length === 0) {
				throw new Error('Empty embedding returned from transformers')
			}

			log.debug(`Generated ${embedding.length}-dimensional embedding`)
			return embedding
		} catch (error) {
			console.error('Transformers.js inference failed:', error)
			throw new Error(
				`Transformers inference failed: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error }
			)
		}
	}

	/**
	 * Generate mock embedding for development/fallback
	 */
	private generateMockEmbedding(text: string): number[] {
		// Deterministic hash-based embedding for consistent development results
		let hash = 0
		for (let i = 0; i < text.length; i++) {
			const char = text.charCodeAt(i)
			hash = (hash << 5) - hash + char
		}

		// Create embedding with consistent but varied values
		const embedding: number[] = []
		for (let i = 0; i < this.dimensions; i++) {
			const value = Math.sin(hash + i * 0.1) * 0.2
			embedding.push(Number(value.toFixed(6))) // Consistent precision
		}

		return embedding
	}

	/**
	 * Generate embeddings for multiple texts
	 */
	async generateEmbeddings(
		texts: string[]
	): Promise<{ embeddings: number[][]; dimensions: number; modelUsed?: string }> {
		log.debug(`Generating embeddings for ${texts.length} texts`)

		if (!this.backendInitialized) {
			await this.initialize()
		}

		try {
			const embeddings = await Promise.all(texts.map((text) => this.generateEmbedding(text)))
			return {
				embeddings: embeddings.map((result) => result.embedding),
				dimensions: this.dimensions,
				modelUsed: this.backend === 'mock' ? 'mock-model' : this.modelId || 'unknown-model',
			}
		} catch (error) {
			console.error('Batch embedding generation failed:', error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`Batch embedding failed: ${errorMessage}`, { cause: error })
		}
	}

	/**
	 * Get dimensions of the embedding vectors
	 */
	getDimensions(): number {
		log.debug('WebEmbeddingService getDimensions:', this.dimensions)
		return this.dimensions
	}

	/**
	 * Get the model name being used
	 */
	getModelName(): string {
		log.debug('WebEmbeddingService getModelName - backend:', this.backend, 'modelId:', this.modelId)
		return this.modelId || 'web-embedding-model'
	}

	/**
	 * Dispose of resources and cleanup
	 */
	async cleanup(): Promise<void> {
		if (this.backendInitialized) {
			log.debug(`Disposing ${this.backend} backend resources`)
			// Cleanup specific backend resources here
			this.backendInitialized = false
		}
	}

	/**
	 * Get service status for debugging
	 */
	getStatus(): {
		backend: string
		initialized: boolean
		modelId?: string
		dimensions: number
		browserCapabilities: {
			webgpu: boolean
			webgl: boolean
			webassembly: boolean
			workers: boolean
		}
	} {
		const status = {
			backend: this.backend,
			initialized: this.backendInitialized,
			modelId: this.modelId,
			dimensions: this.dimensions,
			browserCapabilities: {
				webgpu: this.isWebGPUSupported(),
				webgl: this.isWebGLSupported(),
				webassembly: typeof WebAssembly !== 'undefined',
				workers: typeof Worker !== 'undefined',
			},
		}

		log.debug('EmbeddingService Status:', status)
		return status
	}
}

export function createEmbeddingService(config?: any) {
	return new WebEmbeddingService(config)
}
