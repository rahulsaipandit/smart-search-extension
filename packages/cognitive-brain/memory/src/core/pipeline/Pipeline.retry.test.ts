import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { MemoryEntry } from '../../types'
import { Pipeline, type PipelineEvent } from './Pipeline'

/**
 * A job that THROWS is tried again, a bounded number of times, with a growing wait (designKnownGaps.md, section 10, gap 11). Before,
 * the catch only emitted `job.failed` and the entry was never enriched again. A step skipped for budget keeps its own single retry
 * (covered by the existing pipeline tests).
 */
function makePipeline(options: {
	failTimes: number
	maxErrorRetries?: number
	retryBaseMs?: number
}) {
	let writes = 0
	let attemptsSeen = 0
	const stored = new Map<string, MemoryEntry>()
	const store = {
		get: async (id: string) => stored.get(id) ?? null,
		// The failure is injected at the write (step 4), after the in-memory entry was already enriched - the case the
		// retry must survive. (A failing get would also break the retry's own reload.)
		put: async (e: MemoryEntry) => {
			attemptsSeen += 1
			if (attemptsSeen <= options.failTimes) throw new Error(`store down (attempt ${attemptsSeen})`)
			writes += 1
			stored.set(e.id, e)
		},
	} as unknown as IMemoryStore
	const index = { index: async () => {} } as unknown as IMemoryIndex
	const entry: MemoryEntry = {
		id: 'e1',
		type: 'episodic',
		content: 'I ran the marathon today',
		createdAt: new Date().toISOString(),
	}
	stored.set(entry.id, { ...entry }) // a copy: the store must not share the pipeline's in-memory object
	const pipeline = new Pipeline(store, index, {
		maxErrorRetries: options.maxErrorRetries,
		retryBaseMs: options.retryBaseMs ?? 1000,
	})
	const events: PipelineEvent[] = []
	pipeline.on((e) => events.push(e))
	return { pipeline, entry, stored, events, writes: () => writes, attempts: () => attemptsSeen }
}

const settle = async () => {
	// Let the queued job and its promise chain run to the end (the retry timer is faked).
	for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('Pipeline: a job that threw is tried again', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test('a transient failure is retried after the base wait and then succeeds, with the failure marked as retried', async () => {
		const t = makePipeline({ failTimes: 1 })
		t.pipeline.enqueue(t.entry)
		await settle()
		expect(t.events.filter((e) => e.type === 'job.failed')).toMatchObject([
			{ entryId: 'e1', willRetry: true },
		])
		expect(t.writes()).toBe(0) // nothing was written yet

		await vi.advanceTimersByTimeAsync(999)
		expect(t.attempts()).toBe(1) // not before the wait
		await vi.advanceTimersByTimeAsync(2)
		await settle()
		expect(t.events.some((e) => e.type === 'job.completed')).toBe(true)
		expect(t.writes()).toBe(1) // enriched on the second try
	})

	test('each retry waits 4 times longer, and after the last one the failure is final (willRetry false)', async () => {
		const t = makePipeline({ failTimes: 99, maxErrorRetries: 2, retryBaseMs: 1000 })
		t.pipeline.enqueue(t.entry)
		await settle()
		expect(t.attempts()).toBe(1)

		await vi.advanceTimersByTimeAsync(1000) // first retry after 1 s
		await settle()
		expect(t.attempts()).toBe(2)

		await vi.advanceTimersByTimeAsync(3999) // second retry after 4 s
		await settle()
		expect(t.attempts()).toBe(2)
		await vi.advanceTimersByTimeAsync(1)
		await settle()
		expect(t.attempts()).toBe(3)

		const failed = t.events.filter((e) => e.type === 'job.failed')
		expect(failed.map((e) => e.willRetry)).toEqual([true, true, false])

		await vi.advanceTimersByTimeAsync(60_000) // nothing more is scheduled
		await settle()
		expect(t.attempts()).toBe(3)
		expect(t.writes()).toBe(0)
	})

	test('maxErrorRetries 0 turns retries off: one failure, no timer', async () => {
		const t = makePipeline({ failTimes: 99, maxErrorRetries: 0 })
		t.pipeline.enqueue(t.entry)
		await settle()
		await vi.advanceTimersByTimeAsync(60_000)
		await settle()
		expect(t.attempts()).toBe(1)
		expect(t.events.filter((e) => e.type === 'job.failed')).toMatchObject([{ willRetry: false }])
	})

	test('the retry count is kept by the pipeline, not on the entry, so it neither resets nor leaks into stored data', async () => {
		const t = makePipeline({ failTimes: 99, maxErrorRetries: 2 })
		t.pipeline.enqueue(t.entry)
		await settle()
		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		await vi.advanceTimersByTimeAsync(4000)
		await settle()
		// 1 try + 2 retries, then final: the count survived each re-enqueue.
		expect(t.attempts()).toBe(3)
		expect(JSON.stringify(t.stored.get('e1'))).not.toContain('_pipeline')
		expect(JSON.stringify(t.entry)).not.toContain('_pipeline')
	})

	test('a retry after a failed write still persists the enrichment (the baseline is reloaded, not the mutated object)', async () => {
		const t = makePipeline({ failTimes: 1 })
		t.pipeline.enqueue(t.entry)
		await settle()
		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		const saved = t.stored.get('e1')!
		expect(t.writes()).toBe(1)
		// Salience is computed by the enrichment; before the fix the retry diffed against the already-enriched
		// object, saw no change and wrote the entry back without it.
		expect(saved.salience).toBeDefined()
		expect(saved.importance).toBeDefined()
	})

	test('an entry deleted before its retry fires is not revived', async () => {
		const t = makePipeline({ failTimes: 1 })
		t.pipeline.enqueue(t.entry)
		await settle()
		t.stored.delete('e1')
		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		expect(t.writes()).toBe(0)
		expect(t.pipeline.stats.dropped).toBe(1)
	})

	test('dispose() cancels a pending retry', async () => {
		const t = makePipeline({ failTimes: 1 })
		t.pipeline.enqueue(t.entry)
		await settle()
		t.pipeline.dispose()
		await vi.advanceTimersByTimeAsync(60_000)
		await settle()
		expect(t.attempts()).toBe(1)
	})

	test('a job that never throws is not retried and emits no failure', async () => {
		const t = makePipeline({ failTimes: 0 })
		t.pipeline.enqueue(t.entry)
		await settle()
		await vi.advanceTimersByTimeAsync(60_000)
		await settle()
		expect(t.events.some((e) => e.type === 'job.failed')).toBe(false)
		expect(t.events.filter((e) => e.type === 'job.completed')).toHaveLength(1)
		expect(t.attempts()).toBe(1)
	})
})
