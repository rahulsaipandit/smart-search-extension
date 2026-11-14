import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { IMemoryIndex } from '../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../interfaces/IMemoryStore'
import type { MemoryEntry } from '../types'
import { MemoryService } from './MemoryService'

/**
 * close() must stop the pipeline: a failed job leaves a retry timer pending, and a timer that fires after close()
 * (an account switch closes the engine) would reload and write against a closed store.
 */
function makeService() {
	const stored = new Map<string, MemoryEntry>()
	let closed = false
	let putsAfterClose = 0
	let enrichmentPuts = 0
	const store = {
		initialize: async () => {},
		close: async () => {
			closed = true
		},
		get: async (id: string) => stored.get(id) ?? null,
		put: async (e: MemoryEntry) => {
			if (closed) putsAfterClose += 1
			if (e.id.startsWith('graph-snapshot') || e.tags?.includes('graph-snapshot')) {
				stored.set(e.id, e)
				return
			}
			// the first put is create() itself; every later put is the pipeline writing its enrichment: fail those
			if (stored.has(e.id)) {
				enrichmentPuts += 1
				throw new Error('store down')
			}
			stored.set(e.id, { ...e })
		},
		query: async () => ({ entries: [], cursor: null }),
		count: async () => 0,
		getRelations: async () => [],
	} as unknown as IMemoryStore
	const index = {
		initialize: async () => {},
		close: async () => {},
		index: async () => {},
	} as unknown as IMemoryIndex
	const service = new MemoryService({ store, index })
	return { service, enrichmentPuts: () => enrichmentPuts, putsAfterClose: () => putsAfterClose }
}

const settle = async () => {
	for (let i = 0; i < 30; i += 1) await Promise.resolve()
}

describe('MemoryService.close()', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test('disposes the pipeline before the stores are closed', async () => {
		const t = makeService()
		await t.service.initialize()
		const order: string[] = []
		const pipeline = (t.service as unknown as { pipeline: { dispose(): void } }).pipeline
		const dispose = pipeline.dispose.bind(pipeline)
		pipeline.dispose = () => {
			order.push('dispose')
			dispose()
		}
		const store = (t.service as unknown as { memStore: { close(): Promise<void> } }).memStore
		const close = store.close.bind(store)
		store.close = async () => {
			order.push('store.close')
			await close()
		}
		await t.service.close()
		expect(order).toEqual(['dispose', 'store.close'])
	})

	test('a retry that was pending when close() ran never fires', async () => {
		const t = makeService()
		await t.service.initialize()
		await t.service.create({ type: 'episodic', content: 'I ran the marathon today' })
		await settle()
		const before = t.enrichmentPuts()
		expect(before).toBeGreaterThan(0) // the failed attempt happened, so a retry is scheduled

		await t.service.close()
		await vi.advanceTimersByTimeAsync(10 * 60_000)
		await settle()

		expect(t.enrichmentPuts()).toBe(before) // no retry after close()
	})
})
