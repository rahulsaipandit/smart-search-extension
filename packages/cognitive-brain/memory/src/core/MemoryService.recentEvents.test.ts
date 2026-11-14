import { describe, expect, test } from 'vitest'

import type { IMemoryIndex } from '../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../interfaces/IMemoryStore'
import type {
	IndexResult,
	IndexSearchOptions,
	MemoryEntry,
	MemoryFilter,
	MemoryRelation,
} from '../types'
import { MemoryService } from './MemoryService'
import { InProcessGraph } from './graph/InProcessGraph'

/**
 * §16.8.3 read-back integration coverage: getRecentEvents() against a real
 * MemoryService + InProcessGraph, same "real service, minimal in-memory
 * store/index" pattern as MemoryService.onePager.test.ts (no shared fixture
 * file exists yet for these - each integration test file defines its own,
 * matching this package's convention).
 */

function matchesFilter(entry: MemoryEntry, filter: MemoryFilter): boolean {
	if (filter.type) {
		const types = Array.isArray(filter.type) ? filter.type : [filter.type]
		if (!types.includes(entry.type)) return false
	}
	if (filter.timeRange) {
		if (filter.timeRange.start && entry.createdAt < filter.timeRange.start) return false
		if (filter.timeRange.end && entry.createdAt > filter.timeRange.end) return false
	}
	return true
}

class InMemoryStore implements IMemoryStore {
	private entries = new Map<string, MemoryEntry>()

	async get(id: string): Promise<MemoryEntry | null> {
		return this.entries.get(id) ?? null
	}
	async put(entry: MemoryEntry): Promise<void> {
		this.entries.set(entry.id, entry)
	}
	async delete(id: string): Promise<void> {
		this.entries.delete(id)
	}
	async query(
		filter: MemoryFilter,
		limit?: number
	): Promise<{ entries: MemoryEntry[]; cursor: string | null }> {
		let matched = Array.from(this.entries.values()).filter((e) => matchesFilter(e, filter))
		matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		if (limit !== undefined) matched = matched.slice(0, limit)
		return { entries: matched, cursor: null }
	}
	async putMany(entries: MemoryEntry[]): Promise<void> {
		for (const e of entries) this.entries.set(e.id, e)
	}
	async deleteMany(ids: string[]): Promise<void> {
		for (const id of ids) this.entries.delete(id)
	}
	async count(filter?: MemoryFilter): Promise<number> {
		return Array.from(this.entries.values()).filter((e) => matchesFilter(e, filter ?? {})).length
	}
	async getRelations(): Promise<MemoryRelation[]> {
		return []
	}
	async putRelation(): Promise<void> {}
	async deleteRelation(): Promise<void> {}
	async initialize(): Promise<void> {}
	async close(): Promise<void> {}
	async clear(): Promise<void> {
		this.entries.clear()
	}
}

class InMemoryIndex implements IMemoryIndex {
	async index(): Promise<void> {}
	async remove(): Promise<void> {}
	async search(_query: string, _options?: IndexSearchOptions): Promise<IndexResult[]> {
		return []
	}
	async indexMany(): Promise<void> {}
	async initialize(): Promise<void> {}
	async close(): Promise<void> {}
}

function makeService(graph: InProcessGraph): MemoryService {
	return new MemoryService({
		store: new InMemoryStore(),
		index: new InMemoryIndex(),
		graph,
		maintenance: { disabled: true },
	})
}

function iso(daysAgo: number): string {
	return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

describe('MemoryService.getRecentEvents() (designCognitiveBrain.md §16.8.3 read-back)', () => {
	test('empty when the event graph has nothing', async () => {
		const service = makeService(new InProcessGraph())
		await service.initialize()
		expect(await service.getRecentEvents()).toEqual([])
	})

	test('with explicit seeds, resolves entity ids to display names', async () => {
		const graph = new InProcessGraph()
		graph.upsertEntity({ id: 'emily', name: 'Emily', type: 'person' })
		graph.upsertEntity({ id: 'ai-ethics-meetup', name: 'AI Ethics Meetup', type: 'concept' })
		graph.createEventNode({
			predicate: 'organized',
			actorId: 'emily',
			targetId: 'ai-ethics-meetup',
			occurredAt: iso(1),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})
		const service = makeService(graph)
		await service.initialize()

		const events = await service.getRecentEvents(['emily'])

		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			predicate: 'organized',
			actorName: 'Emily',
			targetName: 'AI Ethics Meetup',
		})
	})

	test('falls back to id when the entity has no display name registered', async () => {
		const graph = new InProcessGraph()
		graph.createEventNode({
			predicate: 'organized',
			actorId: 'unregistered-entity',
			occurredAt: iso(1),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})
		const service = makeService(graph)
		await service.initialize()

		const events = await service.getRecentEvents(['unregistered-entity'])
		expect(events[0]!.actorName).toBe('unregistered-entity')
	})

	test('excludes summary (rolled-up) nodes - those are audit history, not "recent"', async () => {
		const graph = new InProcessGraph()
		graph.upsertEntity({ id: 'emily', name: 'Emily', type: 'person' })
		graph.createEventNode({
			predicate: 'organized',
			actorId: 'emily',
			occurredAt: iso(1),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})
		graph.createEventNode({
			predicate: 'summary',
			actorId: 'emily',
			occurredAt: iso(200),
			confidence: 0.8,
			sourceEntryId: 'entry-2,entry-3',
			isSummary: true,
			summarizedEventIds: ['old-1', 'old-2'],
		})

		const service = makeService(graph)
		await service.initialize()

		const events = await service.getRecentEvents(['emily'])
		expect(events).toHaveLength(1)
		expect(events[0]!.predicate).toBe('organized')
	})

	test('sorts by occurredAt descending and respects the limit', async () => {
		const graph = new InProcessGraph()
		graph.upsertEntity({ id: 'emily', name: 'Emily', type: 'person' })
		for (let i = 0; i < 5; i++) {
			graph.createEventNode({
				predicate: `event-${i}`,
				actorId: 'emily',
				occurredAt: iso(i),
				confidence: 0.9,
				sourceEntryId: `entry-${i}`,
			})
		}
		const service = makeService(graph)
		await service.initialize()

		const events = await service.getRecentEvents(['emily'], 3)
		expect(events).toHaveLength(3)
		expect(events.map((e) => e.predicate)).toEqual(['event-0', 'event-1', 'event-2'])
	})

	test('without explicit seeds, falls back to the same "currently hot" entities as getOnePager()', async () => {
		const graph = new InProcessGraph()
		graph.upsertEntity({ id: 'project-x', name: 'Project X', type: 'project' })
		graph.createEventNode({
			predicate: 'launched',
			actorId: 'project-x',
			occurredAt: iso(1),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})
		const service = makeService(graph)
		await service.initialize()

		await service.create({
			type: 'semantic',
			content: 'Working on Project X launch',
			salience: 0.9,
			entities: ['project-x'],
		})

		const events = await service.getRecentEvents()
		expect(events).toHaveLength(1)
		expect(events[0]!.actorName).toBe('Project X')
	})
})
