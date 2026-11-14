import { initLlama } from 'llama.rn'

import type { IEmbeddings } from './IEmbeddingService'

export interface LlamaEmbeddingsConfig {
	modelPath: string
	dimensions?: number
	nGpuLayers?: number
	nThreads?: number
	/** Context window (llama.rn `n_ctx`). Not the thread count. */
	contextLength?: number
}

export class LlamaEmbeddings implements IEmbeddings {
	private context: any = null
	private dimensions: number = 768 // default fallback, will be overridden by model discovery

	private config: LlamaEmbeddingsConfig

	constructor(config: LlamaEmbeddingsConfig) {
		this.config = config
	}

	async load(): Promise<this> {
		this.context = await initLlama({
			model: this.config.modelPath,
			embedding: true,
			n_ctx: this.config.contextLength || 512,
			n_gpu_layers: this.config.nGpuLayers,
		})

		const { embedding } = await this.context.embedding('test')
		this.dimensions = embedding.length

		return this
	}

	async unload(): Promise<void> {
		if (this.context) {
			try {
				await this.context.release()
			} catch (error) {
				console.warn('[LlamaEmbeddings] Error releasing:', error)
			}
			this.context = null
		}
	}

	async embed(text: string): Promise<number[]> {
		if (!this.context) {
			await this.load()
		}

		const { embedding } = await this.context.embedding(text)
		return Array.from(embedding)
	}

	getDimensions(): number {
		return this.dimensions
	}
}
