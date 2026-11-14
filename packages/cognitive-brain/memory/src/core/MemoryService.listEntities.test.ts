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
	async search(_q: string, _o?: IndexSearchOptions): Promise<IndexResult[]> {
		return []
	}
	async indexMany(): Promise<void> {}
	async initialize(): Promise<void> {}
	async close(): Promise<void> {}
}

async function setup() {
	const graph = new InProcessGraph()
	const store = new InMemoryStore()
	const service = new MemoryService({
		store,
		index: new InMemoryIndex(),
		graph,
		maintenance: { disabled: true },
	})
	await service.initialize()
	return { graph, store, service }
}

describe('MemoryService.listEntities()', () => {
	test('returns graph entities as entity rows with a description from durable mentions', async () => {
		const { graph, store, service } = await setup()
		graph.upsertEntity({ id: 'alice', name: 'Alice', type: 'person' })
		await store.put({
			id: 'm1',
			type: 'semantic',
			content: 'sister, lives in Leeds',
			createdAt: '2026-01-01T00:00:00Z',
			isDurable: true,
		})
		await store.put({
			id: 'm2',
			type: 'episodic',
			content: 'chatted',
			createdAt: '2026-01-02T00:00:00Z',
		})
		graph.createEdge('m1', 'mentions', 'alice')
		graph.createEdge('m2', 'mentions', 'alice')

		const rows = await service.listEntities()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			id: 'entity:alice',
			type: 'entity',
			content: 'Alice - sister, lives in Leeds',
			isDurable: true,
			lifecycleState: 'active',
		})
	})

	test('list() is unchanged: it does not return graph entities', async () => {
		const { graph, service } = await setup()
		graph.upsertEntity({ id: 'alice', name: 'Alice', type: 'person' })
		expect((await service.list({ filter: { type: ['entity'] } })).items).toEqual([])
		expect((await service.list()).items).toEqual([])
	})

	test('a narrowing filter returns nothing; an entity with no durable mention is just its name', async () => {
		const { graph, service } = await setup()
		graph.upsertEntity({ id: 'bob', name: 'Bob', type: 'person' })
		expect(await service.listEntities({ filter: { tags: ['x'] } })).toEqual([])
		expect((await service.listEntities())[0]!.content).toBe('Bob')
	})
})
