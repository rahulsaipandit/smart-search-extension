import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const unload = vi.fn()
const create = vi.fn(async () => ({
	chat: { completions: { create: async () => ({ choices: [{ message: { content: 'hi' } }] }) } },
	unload,
}))
vi.mock('@mlc-ai/web-llm', () => ({ CreateMLCEngine: create }))

import { BrowserLLMClient, ENGINE_UNLOAD_GRACE_MS } from './BrowserLLMClient'

const config = (model: string) => ({ currentLocalModel: model, model, onBrowserModelProgress: () => {} }) as never
const messages = [{ role: 'user' as const, content: 'hello' }]

describe('BrowserLLMClient engine lifetime', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		create.mockClear()
		unload.mockClear()
		vi.spyOn(console, 'log').mockImplementation(() => {})
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('keeps the engine for a client that takes over right after the last one disposes', async () => {
		const first = new BrowserLLMClient(config('handover'))
		await first.invokeText(messages)
		first.dispose()

		const second = new BrowserLLMClient(config('handover'))
		await second.invokeText(messages)
		await vi.advanceTimersByTimeAsync(ENGINE_UNLOAD_GRACE_MS + 1)

		expect(create).toHaveBeenCalledTimes(1)
		expect(unload).not.toHaveBeenCalled()
	})

	it('unloads once nobody has used the engine for the grace period', async () => {
		const client = new BrowserLLMClient(config('idle'))
		await client.invokeText(messages)
		client.dispose()
		await vi.advanceTimersByTimeAsync(ENGINE_UNLOAD_GRACE_MS - 1)
		expect(unload).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(2)
		expect(unload).toHaveBeenCalledTimes(1)
	})

	it('reloads the engine when a disposed client is used again after the grace period unloaded it', async () => {
		const client = new BrowserLLMClient(config('reloaded'))
		await client.invokeText(messages)
		client.dispose()
		await vi.advanceTimersByTimeAsync(ENGINE_UNLOAD_GRACE_MS + 1)
		expect(unload).toHaveBeenCalledTimes(1)

		await client.invokeText(messages)
		expect(create).toHaveBeenCalledTimes(2)

		// The revived client owns a fresh reference: disposing again unloads the new engine exactly once.
		client.dispose()
		await vi.advanceTimersByTimeAsync(ENGINE_UNLOAD_GRACE_MS + 1)
		expect(unload).toHaveBeenCalledTimes(2)
	})

	it('takes its reference back when a disposed client is used again', async () => {
		const client = new BrowserLLMClient(config('revived'))
		await client.invokeText(messages)
		client.dispose()
		await client.invokeText(messages)
		await vi.advanceTimersByTimeAsync(ENGINE_UNLOAD_GRACE_MS + 1)
		expect(unload).not.toHaveBeenCalled()

		client.dispose()
		await vi.advanceTimersByTimeAsync(ENGINE_UNLOAD_GRACE_MS + 1)
		expect(unload).toHaveBeenCalledTimes(1)
	})
})
