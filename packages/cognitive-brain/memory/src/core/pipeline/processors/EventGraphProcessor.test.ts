import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../../interfaces/IMemoryService'
import type { MemoryEntry } from '../../../types'
import { InProcessGraph } from '../../graph/InProcessGraph'
import type { ProcessorContext } from '../IMemoryProcessor'
import { EventGraphProcessor } from './EventGraphProcessor'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: 'entry-1',
		type: 'episodic',
		content: 'Emily organized the AI Ethics Meetup in London.',
		createdAt: new Date().toISOString(),
		entities: ['Emily', 'AI Ethics Meetup', 'London'],
		...overrides,
	}
}

function makeContext(opts: { llmResponse?: string; graph?: InProcessGraph }): {
	context: ProcessorContext
	updates: { id: string; patch: Partial<MemoryEntry> }[]
} {
	const updates: { id: string; patch: Partial<MemoryEntry> }[] = []
	const memory: Partial<IMemoryService> = {
		update: vi.fn(async (id: string, patch: Partial<MemoryEntry>) => {
			updates.push({ id, patch })
		}),
	}
	const context: ProcessorContext = {
		memory: memory as IMemoryService,
		llmService:
			opts.llmResponse === undefined
				? undefined
				: { complete: vi.fn(async () => opts.llmResponse!) },
		graph: opts.graph,
	}
	return { context, updates }
}

describe('EventGraphProcessor.shouldProcess', () => {
	const processor = new EventGraphProcessor()

	test('true for an episodic entry with entities, not yet extracted', async () => {
		expect(await processor.shouldProcess(makeEntry())).toBe(true)
	})

	test('false for a non-episodic entry', async () => {
		expect(await processor.shouldProcess(makeEntry({ type: 'semantic' }))).toBe(false)
	})

	test('false with no extracted entities', async () => {
		expect(await processor.shouldProcess(makeEntry({ entities: [] }))).toBe(false)
	})

	test('false once already marked eventExtracted', async () => {
		expect(await processor.shouldProcess(makeEntry({ metadata: { eventExtracted: true } }))).toBe(
			false
		)
	})
})

describe('EventGraphProcessor.process', () => {
	const processor = new EventGraphProcessor()

	test('no-ops without a graph on the context (does not mark checked)', async () => {
		const { context, updates } = makeContext({ llmResponse: '{}' })
		const result = await processor.process(makeEntry(), context)
		expect(result).toBeNull()
		expect(updates).toHaveLength(0)
	})

	test('no-ops without an LLM but still marks the entry checked (no fabricated predicate)', async () => {
		const graph = new InProcessGraph()
		const { context, updates } = makeContext({ graph })
		await processor.process(makeEntry(), context)

		expect(graph.stats.eventCount).toBe(0)
		expect(updates).toEqual([{ id: 'entry-1', patch: { metadata: { eventExtracted: true } } }])
	})

	test('creates an event node from a high-confidence LLM extraction', async () => {
		const graph = new InProcessGraph()
		const llmResponse = JSON.stringify({
			predicate: 'organized',
			actor: 'Emily',
			target: 'AI Ethics Meetup',
			context: 'London',
			confidence: 0.9,
		})
		const { context, updates } = makeContext({ llmResponse, graph })

		await processor.process(makeEntry(), context)

		expect(graph.stats.eventCount).toBe(1)
		const events = graph.getEventsForEntity('emily', 'actor')
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			predicate: 'organized',
			actorId: 'emily',
			targetId: 'ai-ethics-meetup',
			contextId: 'london',
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})
		expect(updates).toEqual([{ id: 'entry-1', patch: { metadata: { eventExtracted: true } } }])
	})

	test('skips creating a node below the confidence threshold, still marks checked', async () => {
		const graph = new InProcessGraph()
		const llmResponse = JSON.stringify({
			predicate: 'organized',
			actor: 'Emily',
			target: 'AI Ethics Meetup',
			confidence: 0.4,
		})
		const { context, updates } = makeContext({ llmResponse, graph })

		await processor.process(makeEntry(), context)

		expect(graph.stats.eventCount).toBe(0)
		expect(updates).toHaveLength(1)
	})

	test("ignores an actor/target the LLM invents outside the entry's known entities", async () => {
		const graph = new InProcessGraph()
		const llmResponse = JSON.stringify({
			predicate: 'organized',
			actor: 'Someone Else',
			target: 'AI Ethics Meetup',
			confidence: 0.95,
		})
		const { context } = makeContext({ llmResponse, graph })

		await processor.process(makeEntry(), context)

		const event =
			graph.stats.eventCount === 1
				? graph.getEventsForEntity('ai-ethics-meetup', 'target')[0]
				: undefined
		expect(event?.actorId).toBeUndefined()
	})

	test('skips creating a node with neither actor nor target resolved', async () => {
		const graph = new InProcessGraph()
		const llmResponse = JSON.stringify({ predicate: 'organized', confidence: 0.95 })
		const { context } = makeContext({ llmResponse, graph })

		await processor.process(makeEntry(), context)

		expect(graph.stats.eventCount).toBe(0)
	})

	test('malformed LLM response is treated as no extraction, still marks checked', async () => {
		const graph = new InProcessGraph()
		const { context, updates } = makeContext({ llmResponse: 'not json', graph })

		await processor.process(makeEntry(), context)

		expect(graph.stats.eventCount).toBe(0)
		expect(updates).toHaveLength(1)
	})
})
