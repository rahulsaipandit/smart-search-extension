import { describe, expect, it } from 'vitest'

import { createProviderResolver, isDemoProvider } from './providers'

const demo = { baseURL: 'https://demo.example/v1', apiKey: 'NA', model: 'demo-model' }
const { createLLMConfigFromProvider, getTextLLMConfig, getBaseURLForProvider } =
	createProviderResolver({ demo })

describe('getTextLLMConfig decision table', () => {
	it('blocks (null) when global is demo and there is no text override', () => {
		expect(getTextLLMConfig({ apiProvider: 'demo' })).toBeNull()
		expect(getTextLLMConfig({ apiProvider: 'demo', textLLMProvider: 'use-global' })).toBeNull()
	})

	it('uses the override when global is demo, so navigation can stay on demo', () => {
		const config = getTextLLMConfig({
			apiProvider: 'demo',
			textLLMProvider: 'anthropic',
			anthropicApiKey: 'sk-ant',
		})
		expect(config).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant' })
	})

	it('inherits the global provider when it is not demo and nothing is overridden', () => {
		const config = getTextLLMConfig({ apiProvider: 'openai', openaiApiKey: 'sk-1' })
		expect(config).toMatchObject({ provider: 'openai', apiKey: 'sk-1', model: 'gpt-4o' })
	})

	it('falls back to global model/endpoint when the override fields are empty strings', () => {
		const config = getTextLLMConfig({
			apiProvider: 'browser',
			currentLocalModel: 'Llama-3-8B',
			textLLMProvider: 'browser',
			textLLMModel: '',
		})
		expect(config).toMatchObject({ provider: 'browser', model: 'Llama-3-8B' })

		const local = getTextLLMConfig({
			apiProvider: 'openai',
			localEndpointUrl: 'http://localhost:9999/v1',
			textLLMProvider: 'local',
			textLLMEndpoint: '',
		})
		expect(local?.baseURL).toBe('http://localhost:9999/v1')
	})

	it('prefers the text override fields over the global ones when set', () => {
		const config = getTextLLMConfig({
			apiProvider: 'openai',
			currentLocalModel: 'global-model',
			localEndpointUrl: 'http://global/v1',
			textLLMProvider: 'local',
			textLLMModel: 'text-model',
			textLLMEndpoint: 'http://text/v1',
		})
		expect(config).toMatchObject({
			provider: 'local',
			model: 'text-model',
			baseURL: 'http://text/v1',
		})
	})
})

describe('createLLMConfigFromProvider', () => {
	it('uses the host-supplied demo endpoint, letting demoBaseURL override only the URL', () => {
		expect(createLLMConfigFromProvider({ apiProvider: 'demo' })).toMatchObject({
			provider: 'openai',
			baseURL: demo.baseURL,
			model: demo.model,
		})
		expect(
			createLLMConfigFromProvider({ apiProvider: 'demo', demoBaseURL: 'https://other/v1' }).baseURL
		).toBe('https://other/v1')
	})

	it('uses the browser:// sentinel and leaves the model empty when none was chosen', () => {
		const config = createLLMConfigFromProvider({ apiProvider: 'browser' })
		expect(config).toMatchObject({ provider: 'browser', baseURL: 'browser://', model: '' })
		expect(config.disableNamedToolChoice).toBe(true)
	})

	it('respects an explicit disableNamedToolChoice=false for local servers', () => {
		const config = createLLMConfigFromProvider({
			apiProvider: 'local',
			disableNamedToolChoice: false,
		})
		expect(config.disableNamedToolChoice).toBe(false)
	})

	it('throws on an unknown provider instead of guessing', () => {
		expect(() =>
			createLLMConfigFromProvider({ apiProvider: 'nope' as unknown as 'openai' })
		).toThrow(/Unknown provider/)
	})
})

describe('helpers', () => {
	it('isDemoProvider only matches the demo provider', () => {
		expect(isDemoProvider({ apiProvider: 'demo' })).toBe(true)
		expect(isDemoProvider({ apiProvider: 'openai' })).toBe(false)
	})

	it('getBaseURLForProvider maps providers, using the injected demo URL', () => {
		expect(getBaseURLForProvider('demo')).toBe(demo.baseURL)
		expect(getBaseURLForProvider('browser')).toBe('browser://')
		expect(getBaseURLForProvider('whatever')).toBe('https://api.openai.com/v1')
	})
})
