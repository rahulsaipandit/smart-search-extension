/**
 * Llama model configuration
 * Contains model-specific settings for GGUF models
 */

export interface ModelConfig {
	n_ctx: number // Context size
	n_gpu_layers: number // Number of GPU layers
	temperature?: number
	top_k?: number
	top_p?: number
	min_p?: number
	max_tokens?: number
	// Vision-specific
	isVisionModel?: boolean
	isMultimodal?: boolean // Can handle both text and vision
	visionContextSize?: number
	visionInstructions?: string
}

// Model-specific configurations
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
	// TinyLlama - lightweight text model
	tinyllama: {
		n_ctx: 2048,
		n_gpu_layers: 1,
		temperature: 0.7,
		top_k: 40,
		top_p: 0.9,
		min_p: 0.0,
		max_tokens: 2048,
		isVisionModel: false,
		isMultimodal: false,
	},
	// Llava 1.5 - multimodal model (can do both text and vision)
	'llava-1.5-7b': {
		n_ctx: 4096,
		n_gpu_layers: 32, // More GPU layers for vision model
		temperature: 0.7,
		top_k: 40,
		top_p: 0.9,
		min_p: 0.0,
		max_tokens: 2048,
		isVisionModel: true,
		isMultimodal: true, // Can handle both text and vision
		visionContextSize: 4096,
		visionInstructions:
			'You are Llava, a large language model trained by LLaVA and Valley. You are a helpful assistant. User will provide you an image. Describe the image in detail.',
	},
	// Phi-3 Vision - multimodal
	'phi-3-vision': {
		n_ctx: 4096,
		n_gpu_layers: 32,
		temperature: 0.7,
		top_k: 40,
		top_p: 0.9,
		min_p: 0.0,
		max_tokens: 2048,
		isVisionModel: true,
		isMultimodal: true, // Can handle both text and vision
		visionContextSize: 4096,
		visionInstructions:
			'You are Phi-3 Vision, a helpful AI assistant. Analyze the provided image and answer questions about it.',
	},
	smolvlm: {
		n_ctx: 4096,
		n_gpu_layers: 32,
		isVisionModel: true,
		isMultimodal: true,
		visionContextSize: 4096,
		visionInstructions:
			'You are SmolVLM, a helpful AI assistant. Analyze the provided image and answer questions about it.',
	},
	qwen: {
		n_ctx: 4096,
		n_gpu_layers: 32,
		isVisionModel: true,
		isMultimodal: true,
		visionContextSize: 4096,
		visionInstructions:
			'You are Qwen, a helpful AI assistant. Analyze the provided image and answer questions about it.',
	},
	// Apple Intelligence on-device Foundation Model (iOS 26+, text-only)
	'apple-foundation-model': {
		n_ctx: 4096,
		n_gpu_layers: 0,
		temperature: 0.7,
		max_tokens: 2048,
		isVisionModel: false,
		isMultimodal: false,
	},
	// Default config for unknown models
	default: {
		n_ctx: 2048,
		n_gpu_layers: 1,
		temperature: 0.7,
		top_k: 40,
		top_p: 0.9,
		min_p: 0.0,
		max_tokens: 2048,
	},
}

/**
 * Get model configuration by model identifier
 * @param modelId - The model identifier (e.g., 'tinyllama', 'llava-1.5-7b')
 * @returns Model configuration object
 */
export const getModelConfig = (modelId: string): ModelConfig => {
	// Try exact match first
	if (MODEL_CONFIGS[modelId]) {
		return MODEL_CONFIGS[modelId]
	}

	// Try partial match (for models with version suffixes)
	for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
		if (modelId.toLowerCase().includes(key) || key.includes(modelId.toLowerCase())) {
			return config
		}
	}

	// Return default config
	return MODEL_CONFIGS.default
}

/**
 * Check if a model supports vision/multimodal inputs
 * @param modelId - The model identifier
 * @returns true if the model supports vision
 */
export const isVisionModel = (modelId: string): boolean => {
	const config = getModelConfig(modelId)
	return config.isVisionModel === true
}

/**
 * Check if a model is multimodal (can handle both text and vision)
 * @param modelId - The model identifier
 * @returns true if the model is multimodal
 */
export const isMultimodalModel = (modelId: string): boolean => {
	const config = getModelConfig(modelId)
	return config.isMultimodal === true
}

/**
 * Get vision-specific instructions for a model
 * @param modelId - The model identifier
 * @returns Vision instructions or empty string
 */
export const getVisionInstructions = (modelId: string): string => {
	const config = getModelConfig(modelId)
	return config.visionInstructions || ''
}
