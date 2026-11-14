import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

/**
 * §17.3.6 integration coverage: early invalidation and TTL cadence. Unlike
 * OnePagerSynthesizer.test.ts (which fakes IMemoryService directly), this
 * exercises a real MemoryService end-to-end - orderBy/order handling, graph
 * wiring via create(), assertProfileCorrection()'s invalidation call, and
 * getOnePager()'s TTL cache - against minimal in-memory IMemoryStore/IMemoryIndex
 * implementations (none exist yet in this codebase for real MemoryService tests).
 */

function matchesFilter(entry: MemoryEntry, filter: MemoryFilter): boolean {
	if (filter.ids && !filter.ids.includes(entry.id)) return false
	if (filter.type) {
		const types = Array.isArray(filter.type) ? filter.type : [filter.type]
		if (!types.includes(entry.type)) return false
	}
	if (filter.lifecycleState) {
		const states = Array.isArray(filter.lifecycleState)
			? filter.lifecycleState
			: [filter.lifecycleState]
		if (!states.includes(entry.lifecycleState ?? 'active')) return false
	}
	if (filter.timeRange) {
		if (filter.timeRange.start && entry.createdAt < filter.timeRange.start) return false
		if (filter.timeRange.end && entry.createdAt > filter.timeRange.end) return false
	}
	return true
}

class InMemoryStore implements IMemoryStore {
	private entries = new Map<string, MemoryEntry>()
	private relations = new Map<string, MemoryRelation[]>()

	async get(id: string): Promise<MemoryEntry | null> {
		return this.entries.get(id) ?? null
	}

	async put(entry: MemoryEntry): Promise<void> {
		this.entries.set(entry.id, entry)
	}

	async delete(id: string, purge?: boolean): Promise<void> {
		if (purge) {
			this.entries.delete(id)
			return
		}
		const existing = this.entries.get(id)
		if (existing) this.entries.set(id, { ...existing, lifecycleState: 'deleted' })
	}

	/**
	 * `defaultQueryLimit` mimics SQLiteStore.query()'s `limit = 100` default
	 * (native path) when set - IndexedDBStore (web) instead leaves `limit`
	 * unbounded when omitted. Defaults to undefined (unbounded), matching the
	 * web store, since most tests don't care about this distinction.
	 */
	private defaultQueryLimit?: number

	constructor(defaultQueryLimit?: number) {
		this.defaultQueryLimit = defaultQueryLimit
	}

	async query(
		filter: MemoryFilter,
		limit?: number
	): Promise<{ entries: MemoryEntry[]; cursor: string | null }> {
		let matched = Array.from(this.entries.values()).filter((e) => matchesFilter(e, filter))
		matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		const effectiveLimit = limit ?? this.defaultQueryLimit
		if (effectiveLimit !== undefined) matched = matched.slice(0, effectiveLimit)
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

	async getRelations(entryId: string): Promise<MemoryRelation[]> {
		return this.relations.get(entryId) ?? []
	}

	async putRelation(relation: MemoryRelation & { sourceId: string }): Promise<void> {
		const existing = this.relations.get(relation.sourceId) ?? []
		this.relations.set(relation.sourceId, [...existing, relation])
	}

	async deleteRelation(sourceId: string, targetId: string): Promise<void> {
		const existing = this.relations.get(sourceId) ?? []
		this.relations.set(
			sourceId,
			existing.filter((r) => r.targetId !== targetId)
		)
	}

	async initialize(): Promise<void> {}
	async close(): Promise<void> {}
	async clear(): Promise<void> {
		this.entries.clear()
		this.relations.clear()
	}
}

class InMemoryIndex implements IMemoryIndex {
	async index(_entry: MemoryEntry): Promise<void> {}
	async remove(_id: string): Promise<void> {}
	async search(_query: string, _options?: IndexSearchOptions): Promise<IndexResult[]> {
		return []
	}
	async indexMany(_entries: MemoryEntry[]): Promise<void> {}
	async initialize(): Promise<void> {}
	async close(): Promise<void> {}
}

function makeService(storeDefaultQueryLimit?: number): MemoryService {
	return new MemoryService({
		store: new InMemoryStore(storeDefaultQueryLimit),
		index: new InMemoryIndex(),
		maintenance: { disabled: true },
	})
}

/**
 * create() + pin salience via a follow-up update(). Needed because the async
 * T0 pipeline (Pipeline.processEntry -> recomputeSalience()) overwrites
 * whatever `salience` was passed to create() shortly after, on a background
 * job queue that isn't awaited by create() itself - a caller-supplied
 * salience is a transient hint, not a persisted value, against a *real*
 * MemoryService with its pipeline live (unlike the hand-rolled IMemoryService
 * fakes elsewhere in this package, which have no such pipeline to race
 * against). update() doesn't re-enqueue into the pipeline, so this pins it.
 */
async function createWithSalience(
	service: MemoryService,
	entry: Parameters<MemoryService['create']>[0]
): Promise<string> {
	const id = await service.create(entry)
	if (entry.salience !== undefined) {
		await service.update(id, { salience: entry.salience })
	}
	return id
}

describe('MemoryService.list() orderBy/order (regression coverage for the sort bug found while integration-testing the one-pager)', () => {
	test('orderBy: salience, order: desc actually sorts by salience', async () => {
		const service = makeService()
		await service.initialize()

		await createWithSalience(service, { type: 'semantic', content: 'low', salience: 0.1 })
		await createWithSalience(service, { type: 'semantic', content: 'high', salience: 0.9 })
		await createWithSalience(service, { type: 'semantic', content: 'mid', salience: 0.5 })

		const page = await service.list({ orderBy: 'salience', order: 'desc' })

		expect(page.items.map((e) => e.content)).toEqual(['high', 'mid', 'low'])
	})

	test('orderBy: salience, order: asc reverses it', async () => {
		const service = makeService()
		await service.initialize()

		await createWithSalience(service, { type: 'semantic', content: 'low', salience: 0.1 })
		await createWithSalience(service, { type: 'semantic', content: 'high', salience: 0.9 })

		const page = await service.list({ orderBy: 'salience', order: 'asc' })

		expect(page.items.map((e) => e.content)).toEqual(['low', 'high'])
	})

	test('regression: orderBy sorts correctly even when the store applies its own default query limit (native/SQLiteStore behavior)', async () => {
		// SQLiteStore.query() defaults to limit=100 when list() doesn't pass one
		// explicitly; IndexedDBStore (web) leaves it unbounded. Before the fix,
		// list() never forwarded a limit at all, so on a store with a default
		// like this, only the 100 most-recently-created matches would ever reach
		// the client-side sort - silently wrong for the 101st+ entry, however
		// high its salience. 5 entries against a default limit of 3 reproduces
		// the same shape of bug at a testable scale.
		const service = makeService(3)
		await service.initialize()

		// Created first (oldest), but highest salience - a store that defaults
		// to "most-recently-created 3" would never see it at all, regardless of
		// what list() does with orderBy/order afterward.
		await createWithSalience(service, {
			type: 'semantic',
			content: 'e0-highest-but-oldest',
			salience: 0.9,
		})
		await createWithSalience(service, { type: 'semantic', content: 'e1-lowest', salience: 0.1 })
		await createWithSalience(service, { type: 'semantic', content: 'e2', salience: 0.2 })
		await createWithSalience(service, { type: 'semantic', content: 'e3', salience: 0.3 })
		await createWithSalience(service, { type: 'semantic', content: 'e4', salience: 0.4 })

		const page = await service.list({ orderBy: 'salience', order: 'desc', limit: 100 })

		expect(page.items.map((e) => e.content)).toEqual([
			'e0-highest-but-oldest',
			'e4',
			'e3',
			'e2',
			'e1-lowest',
		])
	})
})

describe('MemoryService one-pager (§17.3.6 early invalidation + cadence)', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test('early invalidation: assertProfileCorrection() on a fact in scope marks the cached one-pager stale immediately', async () => {
		const service = makeService()
		await service.initialize()

		const scopedFactId = await createWithSalience(service, {
			type: 'semantic',
			content: 'Working on Project X launch',
			salience: 0.9,
			entities: ['project-x'],
			isDurable: true,
		})

		// First read populates the TTL cache and the scope-entity cache (onePagerScopeEntityIds).
		const first = await service.getOnePager()
		expect(first).toContain('Working on Project X launch')

		// A correction to the in-scope fact, well within the TTL window.
		await service.assertProfileCorrection(
			'life_context',
			scopedFactId,
			'Working on Project X launch (revised)'
		)

		const second = await service.getOnePager()

		expect(second).toContain('revised')
	})

	test('early invalidation does not fire for a correction outside the cached scope', async () => {
		const service = makeService()
		await service.initialize()

		await createWithSalience(service, {
			type: 'semantic',
			content: 'Working on Project X launch',
			salience: 0.9,
			entities: ['project-x'],
			isDurable: true,
		})
		// Decoys: fill out the rest of the top-5 salience window with entries
		// unrelated to either 'project-x' or 'hiking', so the low-salience
		// 'hiking' fact below genuinely falls outside topSalienceEntitiesInWindow's
		// top-5 cut instead of sneaking in only because there were <5 entries total.
		for (const [i, salience] of [0.8, 0.7, 0.6, 0.55].entries()) {
			await createWithSalience(service, {
				type: 'semantic',
				content: `Decoy topic ${i}`,
				salience,
				entities: [`decoy-${i}`],
				isDurable: true,
			})
		}
		const unrelatedFactId = await createWithSalience(service, {
			type: 'semantic',
			content: 'Enjoys hiking on weekends',
			salience: 0.1,
			entities: ['hiking'],
			isDurable: true,
		})

		const first = await service.getOnePager()
		expect(first).toContain('Working on Project X launch')

		await service.assertProfileCorrection(
			'life_context',
			unrelatedFactId,
			'Enjoys hiking and trail running'
		)

		// Still within the TTL window and the correction was out of scope, so
		// the cache should not have been forced to regenerate - same content.
		const second = await service.getOnePager()
		expect(second).toBe(first)
	})

	test('cadence: getOnePager() regenerates after the TTL elapses even with no scope-relevant changes', async () => {
		const service = makeService()
		await service.initialize()

		await createWithSalience(service, {
			type: 'semantic',
			content: 'Working on Project X launch',
			salience: 0.9,
			entities: ['project-x'],
			isDurable: true,
		})

		const first = await service.getOnePager()

		// Add a new, higher-salience in-scope entry directly to the store so the
		// next regeneration would pick it up - but don't invalidate early.
		await createWithSalience(service, {
			type: 'episodic',
			content: 'Project X shipped to production',
			salience: 0.95,
			entities: ['project-x'],
		})

		const stillCached = await service.getOnePager()
		expect(stillCached).toBe(first)

		// Advance past the 30-minute TTL.
		vi.setSystemTime(Date.now() + 31 * 60 * 1000)

		const afterTTL = await service.getOnePager()

		expect(afterTTL).not.toBe(first)
		expect(afterTTL).toContain('shipped to production')
	})

	test('within the TTL window, getOnePager() serves the cached content without regenerating', async () => {
		const service = makeService()
		await service.initialize()

		await createWithSalience(service, {
			type: 'semantic',
			content: 'Working on Project X launch',
			salience: 0.9,
			entities: ['project-x'],
			isDurable: true,
		})

		const first = await service.getOnePager()

		// A second in-scope write that a fresh regeneration would surface.
		await createWithSalience(service, {
			type: 'episodic',
			content: 'This should not appear yet',
			salience: 0.99,
			entities: ['project-x'],
		})

		vi.setSystemTime(Date.now() + 5 * 60 * 1000) // well within the 30-minute TTL

		const second = await service.getOnePager()

		expect(second).toBe(first)
		expect(second).not.toContain('This should not appear yet')
	})
})
