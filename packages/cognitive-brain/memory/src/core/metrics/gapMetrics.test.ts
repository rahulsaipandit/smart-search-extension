import { afterEach, describe, expect, test, vi } from 'vitest'

import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import { Pipeline } from '../pipeline/Pipeline'
import { gapMetric, gapMetricsEnabled, setGapMetrics } from './gapMetrics'

afterEach(() => {
	setGapMetrics(undefined)
	vi.restoreAllMocks()
})

describe('gap metrics log', () => {
	test('off by default outside a dev build: nothing is printed', () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		expect(gapMetricsEnabled()).toBe(false)
		gapMetric('gap12', 'tag_query', { ms: 1 })
		expect(log).not.toHaveBeenCalled()
	})

	test('when on, one greppable line with the gap, the event and JSON data', () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		setGapMetrics(true)
		gapMetric('gap12', 'tag_query', { ms: 12.5, slow: false })
		expect(log).toHaveBeenCalledWith('[GAP-METRIC] gap12 tag_query {"ms":12.5,"slow":false}')
	})

	test('never throws, even for data that cannot be serialised', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		setGapMetrics(true)
		const circular: Record<string, unknown> = {}
		circular.self = circular
		expect(() => gapMetric('gap11', 'x', circular)).not.toThrow()
	})
})

describe('pipeline counters for gap 11', () => {
	test('a finished pass is counted as started and completed; a thrown one as failed (and failedFinal at the end)', async () => {
		const stored = new Map<string, any>()
		const entry = {
			id: 'e1',
			type: 'episodic',
			content: 'I ran the marathon today',
			createdAt: new Date().toISOString(),
		}
		stored.set('e1', entry)
		let fail = true
		const store = {
			get: async (id: string) => {
				if (fail) throw new Error('down')
				return stored.get(id) ?? null
			},
			put: async (e: any) => void stored.set(e.id, e),
		} as unknown as IMemoryStore
		const pipeline = new Pipeline(store, { index: async () => {} } as unknown as IMemoryIndex, {
			maxErrorRetries: 0,
		})
		pipeline.enqueue(entry as any)
		for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r))
		expect(pipeline.stats).toMatchObject({ started: 1, completed: 0, failed: 1, failedFinal: 1 })

		fail = false
		pipeline.enqueue({ ...entry, id: 'e2' } as any)
		stored.set('e2', { ...entry, id: 'e2' })
		for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r))
		expect(pipeline.stats).toMatchObject({ started: 2, completed: 1, failed: 1 })
	})
})
