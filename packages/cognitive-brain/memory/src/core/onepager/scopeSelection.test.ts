import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { ListOptions, MemoryEntry, MemoryListPage } from '../../types'
import { InProcessGraph } from '../graph/InProcessGraph'
import {
	collectEntriesLinkedToEntities,
	expandScope,
	topSalienceEntitiesInWindow,
} from './scopeSelection'

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
	return {
		type: 'episodic',
		content: 'placeholder',
		createdAt: new Date().toISOString(),
		...overrides,
	}
}

function daysAgo(days: number): string {
	return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** Fake IMemoryService.list() that actually applies timeRange/type/orderBy/limit, matching real-store semantics closely enough for these unit tests. */
function makeFakeMemory(entries: MemoryEntry[]): IMemoryService {
	return {
		list: vi.fn(async (options: ListOptions = {}): Promise<MemoryListPage> => {
			let items = [...entries]

			const types = options.filter?.type
			if (types) {
				const typeArr = Array.isArray(types) ? types : [types]
				items = items.filter((e) => typeArr.includes(e.type))
			}

			const start = options.filter?.timeRange?.start
			if (start) {
				items = items.filter((e) => e.createdAt >= start)
			}

			if (options.orderBy === 'salience') {
				items.sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
				if (options.order === 'asc') items.reverse()
			}

			if (options.limit) items = items.slice(0, options.limit)

			return { items, total: items.length, hasMore: false }
		}),
	} as unknown as IMemoryService
}

describe('topSalienceEntitiesInWindow', () => {
	test('collects entities only from the highest-salience entries within the window', async () => {
		const recentHighSalience = makeEntry({
			id: 'r1',
			createdAt: daysAgo(1),
			salience: 0.9,
			entities: ['project-x'],
		})
		const recentLowSalience = makeEntry({
			id: 'r2',
			createdAt: daysAgo(2),
			salience: 0.1,
			entities: ['unrelated-topic'],
		})
		const oldHighSalience = makeEntry({
			id: 'old',
			createdAt: daysAgo(30),
			salience: 0.95,
			entities: ['stale-topic'],
		})
		const memory = makeFakeMemory([recentHighSalience, recentLowSalience, oldHighSalience])

		const seeds = await topSalienceEntitiesInWindow(memory, 7, 1)

		expect(seeds).toEqual(['project-x'])
	})

	test('returns [] when nothing falls in the window', async () => {
		const memory = makeFakeMemory([
			makeEntry({ id: 'old', createdAt: daysAgo(30), entities: ['x'] }),
		])
		expect(await topSalienceEntitiesInWindow(memory, 7, 5)).toEqual([])
	})
})

describe('expandScope (depth bound)', () => {
	test('depth-2 walk includes 2-hop neighbors but excludes 3+ hop entities', () => {
		const graph = new InProcessGraph()
		// seed -> hop1 -> hop2 -> hop3 (a chain)
		graph.upsertEntity({ id: 'seed', name: 'seed', type: 'concept' })
		graph.upsertEntity({ id: 'hop1', name: 'hop1', type: 'concept' })
		graph.upsertEntity({ id: 'hop2', name: 'hop2', type: 'concept' })
		graph.upsertEntity({ id: 'hop3', name: 'hop3', type: 'concept' })
		graph.createEdge('seed', 'references', 'hop1')
		graph.createEdge('hop1', 'references', 'hop2')
		graph.createEdge('hop2', 'references', 'hop3')

		const scope = expandScope(graph, ['seed'], 2)

		expect(scope).toContain('hop1')
		expect(scope).toContain('hop2')
		expect(scope).not.toContain('hop3')
	})
})

describe('collectEntriesLinkedToEntities', () => {
	test('graph-seeded scope dominance - a connected cluster wins over unrelated higher-salience singletons', async () => {
		const scopeEntity = 'shared-entity'
		const clusterEntries = Array.from({ length: 5 }, (_, i) =>
			makeEntry({ id: `cluster-${i}`, type: 'semantic', salience: 0.5, entities: [scopeEntity] })
		)
		const unrelatedSingletons = Array.from({ length: 3 }, (_, i) =>
			makeEntry({
				id: `singleton-${i}`,
				type: 'semantic',
				salience: 0.99,
				entities: ['other-entity'],
			})
		)
		const memory = makeFakeMemory([...clusterEntries, ...unrelatedSingletons])

		const results = await collectEntriesLinkedToEntities(memory, [scopeEntity], 40)

		expect(results.map((e) => e.id).sort()).toEqual(clusterEntries.map((e) => e.id).sort())
	})

	test('includes an entry linked via linkedProcedureIds to a scoped procedure, not just direct entity overlap', async () => {
		const scopeEntity = 'project-x'
		const procedure = makeEntry({ id: 'proc-1', type: 'procedure', entities: [scopeEntity] })
		const linkedEntry = makeEntry({
			id: 'linked',
			type: 'episodic',
			linkedProcedureIds: ['proc-1'],
		})
		const unrelated = makeEntry({ id: 'unrelated', type: 'episodic', entities: ['other'] })
		const memory = makeFakeMemory([procedure, linkedEntry, unrelated])

		const results = await collectEntriesLinkedToEntities(memory, [scopeEntity], 40)

		expect(results.map((e) => e.id)).toContain('linked')
		expect(results.map((e) => e.id)).not.toContain('unrelated')
	})

	test('returns [] for an empty scope set', async () => {
		const memory = makeFakeMemory([makeEntry({ id: 'a', entities: ['x'] })])
		expect(await collectEntriesLinkedToEntities(memory, [], 40)).toEqual([])
	})
})
