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
 * docs/Memory/designMemory.md §10.3 "Proposed Fix": ContradictionResolutionProcessor
 * marks a superseded entry `lifecycleState: 'deprecated'`, but until this fix nothing
 * at retrieval time consulted that flag - a deprecated fact could rank above its own
 * replacement in search() purely on keyword/vector score. This file locks in the fix:
 * search() must default-exclude 'deprecated'/'deleted' entries, while still allowing
 * an explicit opt-in via `includeArchived` or an explicit `filter.lifecycleState`.
 *
 * Same "real service, minimal in-memory store/index" pattern as
 * MemoryService.recentEvents.test.ts - no shared fixture file exists yet for these.
 */

function matchesFilter(entry: MemoryEntry, filter: MemoryFilter): boolean {
	if (filter.type) {
		const types = Array.isArray(filter.type) ? filter.type : [filter.type]
		if (!types.includes(entry.type)) return false
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

/** Returns every indexed entry as a same-score hit, regardless of `query` - these
 *  tests are about search()'s post-fetch lifecycleState filtering, not about ranking
 *  or relevance, so a real BM25/vector index would only add noise. */
class ReturnAllIndex implements IMemoryIndex {
	private ids: string[] = []
	async index(entry: MemoryEntry): Promise<void> {
		if (!this.ids.includes(entry.id)) this.ids.push(entry.id)
	}
	async remove(id: string): Promise<void> {
		this.ids = this.ids.filter((i) => i !== id)
	}
	async search(_query: string, options?: IndexSearchOptions): Promise<IndexResult[]> {
		const topK = options?.topK ?? 10
		return this.ids.slice(0, topK).map((id) => ({ id, score: 1 }))
	}
	async indexMany(entries: MemoryEntry[]): Promise<void> {
		for (const e of entries) await this.index(e)
	}
	async initialize(): Promise<void> {}
	async close(): Promise<void> {}
}

function makeService(): MemoryService {
	return new MemoryService({
		store: new InMemoryStore(),
		index: new ReturnAllIndex(),
		graph: new InProcessGraph(),
		maintenance: { disabled: true },
	})
}

describe('MemoryService.search() - lifecycleState filtering (designMemory.md §10.3)', () => {
	test('excludes a deprecated entry by default, even when it would otherwise rank', async () => {
		const service = makeService()
		await service.initialize()

		// create() alone does not index an entry - real indexing happens via
		// async pipeline enrichment, which persists through update() (see
		// MemoryService.ts:493). The no-op update() below simulates that
		// enrichment having completed, same as the real pipeline would.
		const oldId = await service.create({ type: 'episodic', content: 'Works at Acme Corp' })
		await service.update(oldId, { lifecycleState: 'deprecated' })
		const newId = await service.create({
			type: 'episodic',
			content: 'Acme Corp was acquired; now at Globex',
		})
		await service.update(newId, {})

		const page = await service.search('Acme Corp')
		const contents = page.items.map((i) => i.entry.content)

		expect(contents).not.toContain('Works at Acme Corp')
		expect(contents).toContain('Acme Corp was acquired; now at Globex')
	})

	test('excludes a soft-deleted entry by default', async () => {
		const service = makeService()
		await service.initialize()

		const id = await service.create({ type: 'episodic', content: 'transient note' })
		await service.update(id, { lifecycleState: 'deleted' })

		const page = await service.search('transient note')
		expect(page.items).toHaveLength(0)
	})

	test('does not exclude a merely "archived" entry (only deprecated/deleted are supersession states)', async () => {
		const service = makeService()
		await service.initialize()

		const id = await service.create({
			type: 'episodic',
			content: 'low-salience but still true fact',
		})
		await service.update(id, { lifecycleState: 'archived' })

		const page = await service.search('low-salience but still true fact')
		expect(page.items.map((i) => i.entry.id)).toContain(id)
	})

	test('includeArchived: true opts back into deprecated/deleted entries', async () => {
		const service = makeService()
		await service.initialize()

		const id = await service.create({ type: 'episodic', content: 'Works at Acme Corp' })
		await service.update(id, { lifecycleState: 'deprecated' })

		const page = await service.search('Acme Corp', { includeArchived: true })
		expect(page.items.map((i) => i.entry.id)).toContain(id)
	})

	test('an explicit filter.lifecycleState overrides the default exclusion', async () => {
		const service = makeService()
		await service.initialize()

		const activeId = await service.create({ type: 'episodic', content: 'Acme Corp fact' })
		await service.update(activeId, {})
		const deprecatedId = await service.create({ type: 'episodic', content: 'Acme Corp fact' })
		await service.update(deprecatedId, { lifecycleState: 'deprecated' })

		// Caller explicitly asks only for deprecated entries (e.g. an audit view) -
		// the default exclusion must not silently override that intent.
		const page = await service.search('Acme Corp fact', {
			filter: { lifecycleState: ['deprecated'] },
		})
		const ids = page.items.map((i) => i.entry.id)
		expect(ids).toContain(deprecatedId)
		expect(ids).not.toContain(activeId) // sanity check the fixture, not the exclusion logic
	})
})

describe('MemoryService.removeRelation() - undo of an accepted supersession', () => {
	test('removes the relation from the entry and the graph, and is a no-op when absent', async () => {
		const graph = new InProcessGraph()
		const service = new MemoryService({
			store: new InMemoryStore(),
			index: new ReturnAllIndex(),
			graph,
			maintenance: { disabled: true },
		})
		await service.initialize()
		const oldId = await service.create({ type: 'semantic', content: 'Runs three times a week' })
		const newId = await service.create({ type: 'semantic', content: 'Stopped running' })

		await service.addRelation(oldId, { type: 'child', targetId: newId })
		await service.addRelation(oldId, { type: 'extends', targetId: newId })
		await service.removeRelation(oldId, { type: 'child', targetId: newId })

		expect((await service.get(oldId))?.relations).toEqual([{ type: 'extends', targetId: newId }])
		expect(graph.getEdges(oldId, 'child')).toHaveLength(0)
		expect(graph.getEdges(oldId, 'extends')).toHaveLength(1)

		await expect(
			service.removeRelation(oldId, { type: 'child', targetId: newId })
		).resolves.toBeUndefined()
		await expect(
			service.removeRelation('missing', { type: 'child', targetId: newId })
		).rejects.toThrow('not found')
	})
})
