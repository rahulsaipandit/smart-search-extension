/**
 * Provider settings -> LLMConfig resolution.
 *
 * Platform-neutral: the settings shapes are structural types, and the shared demo
 * endpoint is passed in by the host app (its URL comes from build-time env, which this
 * package must not know about). Use `createProviderResolver({ demo })` once at app start.
 */
import type { LLMConfig } from './types'

/** Provider identifiers a host app can store in its settings. */
export type ApiProvider = 'openai' | 'anthropic' | 'local' | 'browser' | 'demo'

/** Provider-specific settings, a structural subset of the host app's settings object. */
export interface ProviderSettings {
	apiProvider: ApiProvider
	openaiApiKey?: string
	openaiModel?: string
	anthropicApiKey?: string
	anthropicModel?: string
	localEndpointUrl?: string
	currentLocalModel?: string | null
	currentLocalModelContextWindow?: number
	demoBaseURL?: string
	disableNamedToolChoice?: boolean
}

/**
 * Settings read by getTextLLMConfig: the provider settings plus an optional override
 * for text-only features (see getTextLLMConfig for the decision table).
 */
export interface TextLLMSettings extends ProviderSettings {
	textLLMProvider?: 'use-global' | 'local' | 'browser' | 'openai' | 'anthropic'
	/** Endpoint URL when textLLMProvider === 'local' (falls back to localEndpointUrl) */
	textLLMEndpoint?: string
	/** Model name when textLLMProvider === 'local' or 'browser' (falls back to currentLocalModel) */
	textLLMModel?: string
}

/** The shared demo endpoint a host app offers to users who have not configured a provider. */
export interface DemoProviderConfig {
	baseURL: string
	apiKey: string
	model: string
}

export interface ProviderResolver {
	/** Creates LLMConfig from provider-specific settings */
	createLLMConfigFromProvider: (settings: ProviderSettings) => LLMConfig
	/**
	 * Resolves the effective LLM config for simple text/language features (Resume Manager,
	 * Social Post Manager, and other non-navigation text operations).
	 *
	 * Decision table:
	 *   global=demo  + no text override  →  null  (caller must block + show warning)
	 *   global=demo  + text override     →  override config (navigation keeps demo)
	 *   global≠demo  + no text override  →  global config (zero friction for real-key users)
	 *   any          + text override     →  override config
	 *
	 * Returns null to signal "blocked - prompt the user to configure a private provider."
	 */
	getTextLLMConfig: (settings: TextLLMSettings) => LLMConfig | null
	/** Gets the effective baseURL for a provider (for UI display) */
	getBaseURLForProvider: (provider: string) => string
}

/**
 * Returns true when the global navigation provider is the shared demo endpoint.
 * Used by the Resume Customizer to decide whether to show the privacy warning.
 */
export function isDemoProvider(settings: Pick<ProviderSettings, 'apiProvider'>): boolean {
	return settings.apiProvider === 'demo'
}

export function createProviderResolver(options: { demo: DemoProviderConfig }): ProviderResolver {
	const { demo } = options

	function createLLMConfigFromProvider(settings: ProviderSettings): LLMConfig {
		const { apiProvider } = settings

		switch (apiProvider) {
			case 'openai':
				return {
					provider: 'openai',
					baseURL: 'https://api.openai.com/v1',
					apiKey: settings.openaiApiKey || '',
					model: settings.openaiModel || 'gpt-4o',
					maxRetries: 3,
					openaiApiKey: settings.openaiApiKey,
					openaiModel: settings.openaiModel,
				}

			case 'anthropic':
				return {
					provider: 'anthropic',
					baseURL: 'https://api.anthropic.com/v1',
					apiKey: settings.anthropicApiKey || '',
					model: settings.anthropicModel || 'claude-sonnet-4-6',
					maxRetries: 3,
					anthropicApiKey: settings.anthropicApiKey,
					anthropicModel: settings.anthropicModel,
				}

			case 'local':
				return {
					provider: 'local',
					baseURL: settings.localEndpointUrl || 'http://localhost:1234/v1',
					apiKey: 'NA',
					model: settings.currentLocalModel || 'local-model',
					maxRetries: 3,
					localEndpointUrl: settings.localEndpointUrl,
					// Default to true for local servers (LM Studio, Ollama, etc.)
					// See OpenAIClient.ts for explanation
					disableNamedToolChoice: settings.disableNamedToolChoice ?? true,
				}

			case 'browser':
				return {
					provider: 'browser',
					// Sentinel only: the browser provider never makes a network request.
					baseURL: 'browser://',
					apiKey: 'NA',
					// Leave unset (rather than a placeholder like 'default') when no model was
					// chosen in Settings, so BrowserLLMClient's own guard throws a clear
					// "No browser model selected" error instead of WebLLM's cryptic
					// "Cannot find model record in appConfig" for a nonexistent model id.
					model: settings.currentLocalModel || '',
					maxRetries: 3,
					currentLocalModel: settings.currentLocalModel,
					currentLocalModelContextWindow: settings.currentLocalModelContextWindow,
					// Browser LLM also benefits from string tool_choice
					disableNamedToolChoice: settings.disableNamedToolChoice ?? true,
				}

			case 'demo':
				return {
					provider: 'openai',
					baseURL: settings.demoBaseURL || demo.baseURL,
					apiKey: demo.apiKey,
					model: demo.model,
					maxRetries: 3,
				}

			default:
				throw new Error(`Unknown provider: ${apiProvider as string}`)
		}
	}

	function getTextLLMConfig(settings: TextLLMSettings): LLMConfig | null {
		const { textLLMProvider } = settings

		if (textLLMProvider && textLLMProvider !== 'use-global') {
			// Build effective provider settings from the text-LLM override, falling back
			// to global fields for anything not explicitly overridden.
			const overrideSettings: ProviderSettings = {
				...settings,
				apiProvider: textLLMProvider,
				// `|| ` (not `??`) on purpose: textLLMModel/textLLMEndpoint can be persisted
				// as an empty string (e.g. Text LLM Settings saved with "browser" selected but no
				// model chosen yet) - `??` only falls back on null/undefined and would then
				// permanently pin the override to '', ignoring a model picked later in the
				// global Browser LLM settings page.
				localEndpointUrl: settings.textLLMEndpoint || settings.localEndpointUrl,
				currentLocalModel: settings.textLLMModel || settings.currentLocalModel,
			}
			return createLLMConfigFromProvider(overrideSettings)
		}

		// No override - inherit global. Block only if the global provider is demo.
		if (settings.apiProvider === 'demo') return null

		return createLLMConfigFromProvider(settings)
	}

	function getBaseURLForProvider(provider: string): string {
		switch (provider) {
			case 'openai':
				return 'https://api.openai.com/v1'
			case 'anthropic':
				return 'https://api.anthropic.com/v1'
			case 'local':
				return 'http://localhost:1234/v1'
			case 'browser':
				return 'browser://'
			case 'demo':
				return demo.baseURL
			default:
				return 'https://api.openai.com/v1'
		}
	}

	return { createLLMConfigFromProvider, getTextLLMConfig, getBaseURLForProvider }
}
