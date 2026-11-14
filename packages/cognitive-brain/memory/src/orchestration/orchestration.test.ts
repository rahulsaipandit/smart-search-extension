import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ConsolidationManager } from './consolidation'
import { InferenceAdapter, configureInferenceAdapter } from './inferenceAdapter'
import { SmritiOrchestrator } from './orchestrator'

beforeAll(() => {
	configureInferenceAdapter(
		() =>
			new InferenceAdapter({
				resolveClient: async () => ({
					kind: 'api',
					config: { baseURL: 'http://llm.invalid', apiKey: 'k', model: 'm' },
				}),
			})
	)
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

/** The orchestrator with every background timer off, so a test controls what runs. */
function makeOrchestrator(config: ConstructorParameters<typeof SmritiOrchestrator>[0] = {}) {
	return new SmritiOrchestrator({
		enableCachePolling: false,
		enableAutoConsolidation: false,
		enableSemanticSearch: false,
		...config,
	})
}

describe('SmritiOrchestrator listeners', () => {
	it('keeps one handler per event when a callback listens to two events', () => {
		const o = makeOrchestrator()
		const cb = vi.fn()
		o.on('entry.created', cb)
		o.on('entry.updated', cb)

		o.dispatchEvent(new CustomEvent('entry.created', { detail: 1 }))
		o.dispatchEvent(new CustomEvent('entry.updated', { detail: 2 }))
		expect(cb.mock.calls).toEqual([[1], [2]])

		// Removing it from one event must not detach it from the other.
		o.off('entry.created', cb)
		o.dispatchEvent(new CustomEvent('entry.created', { detail: 3 }))
		o.dispatchEvent(new CustomEvent('entry.updated', { detail: 4 }))
		expect(cb.mock.calls).toEqual([[1], [2], [4]])
	})

	it('does not call a callback twice when it is registered twice for one event', () => {
		const o = makeOrchestrator()
		const cb = vi.fn()
		o.on('entry.created', cb)
		o.on('entry.created', cb)
		o.dispatchEvent(new CustomEvent('entry.created', { detail: 1 }))
		expect(cb).toHaveBeenCalledTimes(1)
	})
})

describe('SmritiOrchestrator auto-consolidation', () => {
	it('logs a failed tick instead of leaving an unhandled rejection', async () => {
		vi.useFakeTimers()
		const o = makeOrchestrator({ consolidationIntervalMs: 1000 })
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
		o.consolidation.processNextJobs = vi.fn().mockRejectedValue(new Error('idb closed'))

		o.startAutoConsolidation()
		await vi.advanceTimersByTimeAsync(1000)
		o.stopAutoConsolidation()

		expect(logged).toHaveBeenCalledWith(
			expect.stringContaining('Auto-consolidation tick failed'),
			expect.objectContaining({ message: 'idb closed' })
		)
	})
})

describe('SmritiOrchestrator.think', () => {
	function withInference(model: string, text: string) {
		const o = makeOrchestrator()
		o.inference = { initialize: async () => {}, infer: async () => ({ text, model }) } as never
		vi.spyOn(o, 'getContext').mockResolvedValue({ formatted: 'ctx' } as never)
		return o
	}

	it('fails loudly when the adapter only returned its "LLM unavailable" placeholder', async () => {
		await expect(withInference('T3', '[unavailable]').think('q')).rejects.toThrow(
			/no LLM is available/
		)
	})

	it('returns the trimmed answer of a real model', async () => {
		const result = await withInference('T1', '  Paris  ').think('capital of France?')
		expect(result.answer).toBe('Paris')
	})
})

describe('SmritiOrchestrator.ingestTurn', () => {
	/**
	 * The orchestrator with the stores ingestTurn touches replaced, so no IndexedDB is needed. The tests deliberately
	 * assign these public fields (`episodic`, `retrieval`, `workingMemory`): renaming one means updating this stub.
	 */
	function withStubbedStores() {
		const o = makeOrchestrator()
		const createTurn = vi.fn(async () => {})
		const episodes: { id: string; sessionId: string }[] = []
		const updateEpisode = vi.fn(async () => {})
		o.episodic = {
			turns: { createTurn },
			episodes: {
				createEpisode: async (episode: { id: string; sessionId: string }) =>
					void episodes.push(episode),
				getRecentEpisodes: async () => [...episodes].reverse(),
				updateEpisode,
			},
		} as never
		o.retrieval = {
			retrieve: async () => ({ candidateSets: { semantic: [], episodic: [], procedural: [] } }),
		} as never
		o.workingMemory = { populateFromCandidates: vi.fn() } as never
		o.consolidation.scheduleJob = vi.fn(async () => '') as never
		const storedSessionId = async (sessionId: string) => {
			createTurn.mockClear()
			await o.ingestTurn({ sessionId, actor: 'user', content: 'hello' })
			return (createTurn.mock.calls[0] as unknown as [{ sessionId: string }])[0].sessionId
		}
		return { o, storedSessionId, updateEpisode }
	}

	it('keeps the session id the caller gave', async () => {
		const { storedSessionId } = withStubbedStores()
		expect(await storedSessionId('caller-session')).toBe('caller-session')
	})

	it('falls back to the current session when the caller gave an empty id', async () => {
		const { o, storedSessionId } = withStubbedStores()
		const stored = await storedSessionId('')
		expect(stored).toBeTruthy()
		expect(stored).toBe((o as unknown as { currentSessionId: string }).currentSessionId)
	})

	it('still lets reportOutcome find the episode when the caller gave its own session id', async () => {
		const { o, updateEpisode } = withStubbedStores()
		const episodeId = await o.ingestTurn({
			sessionId: 'caller-session',
			actor: 'user',
			content: 'hi',
		})

		// No task id was given, so reportOutcome has to find the episode through the session.
		await o.reportOutcome('unmapped-task', 'success')

		expect(updateEpisode).toHaveBeenCalledWith(
			episodeId,
			expect.objectContaining({ outcome: 'success' })
		)
	})
})

describe('ConsolidationManager', () => {
	/** The manager with fake stores, plus a way to run one private job directly. */
	function makeManager(inference: object, stores: { episodic: object; semantic: object }) {
		const graph = { upsertNode: vi.fn(async () => {}) }
		const manager = new ConsolidationManager(graph as never, {} as never, inference as never)
		manager.setStores(stores.episodic as never, stores.semantic as never)
		const run = (job: 'runSemanticExtraction' | 'runGenerateReflection', refs: string[]) =>
			(manager as unknown as Record<string, (j: unknown) => Promise<void>>)[job]({
				inputRefs: refs,
			})
		return { graph, run }
	}

	it('gives names in other scripts their own graph node ids', async () => {
		const inference = {
			extractEntities: async () => ({
				entities: ['東京', '北京', 'Café', 'cafe'],
				isProcedural: false,
			}),
			classifyOutcome: async () => ({ outcome: 'success', confidence: 0 }),
		}
		const episodic = { turns: { getTurn: async () => ({ content: 'x' }) } }
		const { graph, run } = makeManager(inference, { episodic, semantic: {} })

		await run('runSemanticExtraction', ['t1'])

		const ids = (graph.upsertNode.mock.calls as unknown as [{ id: string }][]).map(([n]) => n.id)
		// An ASCII-only slug turned both CJK names into the same "entity___" id and merged the nodes.
		expect(ids).toEqual(['entity_東京', 'entity_北京', 'entity_café', 'entity_cafe'])
	})

	it('never stores the "LLM unavailable" placeholder as a durable fact', async () => {
		const createFact = vi.fn()
		const episodic = {
			episodes: {
				getEpisode: async (id: string) => ({
					id,
					outcome: 'success',
					summary: 's',
					entities: ['a'],
				}),
			},
		}
		const reflect = async (model: string) => {
			createFact.mockClear()
			const inference = { infer: async () => ({ text: 'Plan early.', model }) }
			const { run } = makeManager(inference, { episodic, semantic: { createFact } })
			await run('runGenerateReflection', ['e1'])
		}

		await reflect('T3')
		expect(createFact).not.toHaveBeenCalled()

		await reflect('T1')
		expect(createFact).toHaveBeenCalledTimes(1)
	})
})
