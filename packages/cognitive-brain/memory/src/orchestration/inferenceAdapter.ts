/**
 * LLM Inference Adapter - platform-neutral implementation.
 *
 * Extends BaseInferenceAdapter with LLM wiring for API-based providers
 * (OpenAI-compatible chat/completions) and an in-browser model. Everything
 * platform-specific is injected by the host app via InferenceAdapterOptions:
 * how to resolve the active provider (settings storage) and, for the browser
 * model, how to reach the page that hosts it (e.g. chrome.runtime messaging).
 * T0 methods (extractEntities, classifyOutcome, extractWikiPage fallback)
 * are inherited from BaseInferenceAdapter.
 */
import { BaseInferenceAdapter } from '../core/inference/BaseInferenceAdapter'
import type { InferenceRequest, InferenceResult } from '../types'

export type { IInferenceAdapter, InferenceRequest, InferenceResult, InferenceTier } from '../index'

/** Connection details for an OpenAI-compatible chat/completions endpoint. */
export interface APIClientConfig {
	baseURL: string
	apiKey: string
	model: string
}

/** Which client the host wants the adapter to use right now. */
export type ResolvedInferenceClient =
	{ kind: 'api'; config: APIClientConfig } | { kind: 'browser'; modelId?: string }

/** Request sent to the host's browser-model transport. */
export interface BrowserInferenceRequest {
	prompt: string
	maxTokens: number
	temperature: number
	model: string
}

export interface BrowserInferenceResponse {
	text?: string
	tokensUsed?: number
	latencyMs?: number
}

export interface InferenceAdapterOptions {
	/** Reads the host's current provider settings. Called once, on first use. */
	resolveClient: () => Promise<ResolvedInferenceClient>
	/** Required only when resolveClient can return `{ kind: 'browser' }`. */
	browserInference?: (
		request: BrowserInferenceRequest
	) => Promise<BrowserInferenceResponse | undefined>
}

const DEFAULT_BROWSER_MODEL = 'gemma-2-2b-it-q4f16_1-MLC'

export class InferenceAdapter extends BaseInferenceAdapter {
	private llmClient: ((request: InferenceRequest) => Promise<InferenceResult>) | null = null

	private readonly options: InferenceAdapterOptions

	constructor(options: InferenceAdapterOptions) {
		super()
		this.options = options
	}

	// ── Initialization ────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this.isReady) return
		try {
			const resolved = await this.options.resolveClient()

			if (resolved.kind === 'browser') {
				this.llmClient = this._createBrowserClient(resolved.modelId)
				this._clientType = 'browser'
			} else {
				this.llmClient = this._createAPIClient(resolved.config)
				this._clientType = 'api'
			}
			this.isReady = true
		} catch (err) {
			console.warn('[InferenceAdapter] LLM init failed, using fallback:', err)
			this.llmClient = this._createFallbackClient()
			this._clientType = 'fallback'
			this.isReady = true
		}
	}

	// ── LLM inference ─────────────────────────────────────────────────────────

	async infer(request: InferenceRequest): Promise<InferenceResult> {
		if (!this.isReady) await this.initialize()
		return this.llmClient!(request)
	}

	// ── Private factories ─────────────────────────────────────────────────────

	private _createAPIClient(
		config: APIClientConfig
	): (request: InferenceRequest) => Promise<InferenceResult> {
		return async (request) => {
			const startTime = performance.now()
			const response = await fetch(`${config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
				body: JSON.stringify({
					model: config.model,
					messages: [{ role: 'user', content: request.prompt }],
					max_tokens: request.maxTokens ?? 512,
					temperature: request.temperature ?? 0.3,
				}),
			})
			if (!response.ok) throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
			const data = (await response.json()) as {
				choices?: { message?: { content?: string } }[]
				usage?: { total_tokens?: number }
			}
			return {
				text: data.choices?.[0]?.message?.content ?? '',
				tokensUsed: data.usage?.total_tokens ?? 0,
				latencyMs: Math.round(performance.now() - startTime),
				model: request.model,
			}
		}
	}

	private _createBrowserClient(
		modelId?: string
	): (request: InferenceRequest) => Promise<InferenceResult> {
		const { browserInference } = this.options
		if (!browserInference) {
			throw new Error(
				'InferenceAdapter: the host resolved a browser model but supplied no browserInference transport'
			)
		}
		return async (request) => {
			const response = await browserInference({
				prompt: request.prompt,
				maxTokens: request.maxTokens ?? 512,
				temperature: request.temperature ?? 0.3,
				model: modelId ?? DEFAULT_BROWSER_MODEL,
			})
			return {
				text: response?.text ?? '',
				tokensUsed: response?.tokensUsed ?? 0,
				latencyMs: response?.latencyMs ?? 0,
				model: request.model,
			}
		}
	}

	private _createFallbackClient(): (request: InferenceRequest) => Promise<InferenceResult> {
		return (request) =>
			Promise.resolve({
				text: `[LLM unavailable - cannot process: ${request.prompt.slice(0, 100)}]`,
				tokensUsed: 0,
				latencyMs: 0,
				model: 'T3' as const,
			})
	}
}

// ── Default adapter ───────────────────────────────────────────────────────────

let _factory: (() => InferenceAdapter) | null = null
let _instance: InferenceAdapter | null = null

/**
 * Registers how the shared adapter is built. The host app calls this once at startup,
 * before constructing a SmritiOrchestrator or ConsolidationManager (both fall back to the
 * shared adapter when none is passed in).
 */
export function configureInferenceAdapter(factory: () => InferenceAdapter): void {
	_factory = factory
	_instance = null
}

export function getInferenceAdapter(): InferenceAdapter {
	if (!_instance) {
		if (!_factory) {
			throw new Error(
				'InferenceAdapter is not configured: call configureInferenceAdapter() before using the memory orchestration'
			)
		}
		_instance = _factory()
	}
	return _instance
}
