import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LlamaEmbeddings } from './LlamaEmbeddings'

// llama.rn is a native module that is not installed in the monorepo, so the mock stands in for it.
const { initLlama } = vi.hoisted(() => ({
	initLlama: vi.fn(async () => ({ embedding: async () => ({ embedding: [0.1, 0.2, 0.3] }) })),
}))
vi.mock('llama.rn', () => ({ initLlama }))

beforeEach(() => {
	initLlama.mockClear()
})

/** The options the model was started with. */
async function loadOptions(config: ConstructorParameters<typeof LlamaEmbeddings>[0]) {
	await new LlamaEmbeddings(config).load()
	expect(initLlama).toHaveBeenCalledTimes(1)
	return (initLlama.mock.calls[0] as unknown as [Record<string, unknown>])[0]
}

describe('LlamaEmbeddings.load', () => {
	it('passes contextLength to llama.rn as the context window (n_ctx)', async () => {
		const options = await loadOptions({ modelPath: '/models/e.gguf', contextLength: 2048 })
		expect(options.n_ctx).toBe(2048)
	})

	it('does not use the thread count as the context window', async () => {
		// nThreads used to be passed as n_ctx, which started the model with an 8-token context.
		const options = await loadOptions({ modelPath: '/models/e.gguf', nThreads: 8 })
		expect(options.n_ctx).toBe(512)
	})

	it('prefers contextLength when both are set', async () => {
		const options = await loadOptions({
			modelPath: '/models/e.gguf',
			nThreads: 8,
			contextLength: 4096,
		})
		expect(options.n_ctx).toBe(4096)
	})

	it('starts the model in embedding mode with the requested path and GPU layers', async () => {
		const options = await loadOptions({ modelPath: '/models/e.gguf', nGpuLayers: 20 })
		expect(options).toMatchObject({ model: '/models/e.gguf', embedding: true, n_gpu_layers: 20 })
	})
})
