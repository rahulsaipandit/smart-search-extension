// src/local-llm/llmModelManager.ts
// API-based LLM model manager for Web (MLC WebGPU) and Native (GGUF via llama.rn)
// No UI, only API endpoints for model selection, loading, and downloading
import { Directory, File } from 'expo-file-system'
import { Platform } from 'react-native'

import { log } from '../utils/logger'

// Type declarations to handle API inconsistencies
declare module 'expo-file-system' {
	// eslint-disable-next-line @typescript-eslint/no-namespace -- module augmentation: namespace merges static members into the expo-file-system class
	namespace Directory {
		function fromUri(uri: string): Directory
	}
	// eslint-disable-next-line @typescript-eslint/no-namespace -- module augmentation: namespace merges static members into the expo-file-system class
	namespace File {
		function downloadFileAsync(
			url: string,
			destination: Directory | File,
			options?: any
		): Promise<File>
	}
}

// Placeholder imports for actual LLM libraries
// import { MLCWebGPU } from 'mlc-webgpu'; // For web
// import { LlamaRN } from 'llama.rn'; // For native

export type LLMModelType = 'mlc-webgpu' | 'gguf-native'

export interface LLMModelRequest {
	modelName: string
	modelPath: string
	modelType: LLMModelType
	downloadUrl?: string
}

export class LLMModelManager {
	private loadedModel: any = null
	private modelInfo: LLMModelRequest | null = null

	async ensureModel(request: LLMModelRequest): Promise<any> {
		// If no model path provided, skip model loading (use fallback reasoning)
		if (!request.modelPath || request.modelPath.trim() === '') {
			log.debug('No model path provided, using fallback reasoning')
			return null
		}

		const file = new File(request.modelPath)
		if (!file.exists) {
			if (!request.downloadUrl) throw new Error('Model file not found and no download URL provided')
			await this.downloadModel(request.downloadUrl, request.modelPath)
		}
		return this.loadModel(request)
	}

	async downloadModel(url: string, destPath: string): Promise<void> {
		// Create parent directory if needed
		const destDir = destPath.substring(0, destPath.lastIndexOf('/'))
		const directory = Directory.fromUri(destDir)
		if (!directory.exists) {
			directory.create({ intermediates: true })
		}

		const downloadedFile = await File.downloadFileAsync(url, directory)
		if (!downloadedFile || !downloadedFile.uri) throw new Error('Failed to download model')
	}

	async loadModel(request: LLMModelRequest): Promise<any> {
		if (Platform.OS === 'web') {
			// Load MLC WebGPU model
			// this.loadedModel = await MLCWebGPU.loadModel(request.modelPath, request.modelName);
			this.loadedModel = { type: 'mlc-webgpu', path: request.modelPath, name: request.modelName }
		} else {
			// Load GGUF model via llama.rn
			// this.loadedModel = await LlamaRN.loadModel(request.modelPath, request.modelName);
			this.loadedModel = { type: 'gguf-native', path: request.modelPath, name: request.modelName }
		}
		this.modelInfo = request
		return this.loadedModel
	}

	getLoadedModel(): any {
		return this.loadedModel
	}

	getModelInfo(): LLMModelRequest | null {
		return this.modelInfo
	}
}

// Example API usage:
// const manager = new LLMModelManager();
// await manager.ensureModel({ modelName: 'llama-3', modelPath: '/models/llama-3.gguf', modelType: 'gguf-native', downloadUrl: 'https://...' });
// const model = manager.getLoadedModel();
