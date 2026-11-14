// Cross-platform entry point for EmbeddingService
// React Native will automatically resolve to:
// - EmbeddingService.native.ts for native platforms (iOS/Android)
// - EmbeddingService.web.ts for web platforms
import { Platform } from 'react-native'

import { NativeEmbeddingService } from './EmbeddingService.native'
// Import both classes
import { WebEmbeddingService } from './EmbeddingService.web'

// Type re-exports for external use
export type { IEmbeddingService } from './IEmbeddingService'
export type { EmbeddingResult } from './IEmbeddingService'

// Export classes directly
export { WebEmbeddingService, NativeEmbeddingService }

// Factory function to create the appropriate embedding service
export function createEmbeddingService(config?: any) {
	if (Platform.OS === 'web') {
		// WebEmbeddingService defaults to mock mode internally when no config is provided
		return new WebEmbeddingService(config)
	} else {
		// NativeEmbeddingService requires either a .gguf modelPath or explicit mockMode: true.
		// When called without a model path (no dedicated embedding GGUF downloaded), default
		// to mock mode so RAG can initialize. Callers that have an embedding model should
		// pass { modelPath: '/path/to/model.gguf' } explicitly for real semantic search.
		const nativeConfig = config ?? {}
		if (!nativeConfig.modelPath && !nativeConfig.modelId && nativeConfig.mockMode === undefined) {
			nativeConfig.mockMode = true
		}
		return new NativeEmbeddingService(nativeConfig)
	}
}
