import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { ListOptions, MemoryEntry, MemoryListPage } from '../../types'
import { InProcessGraph } from '../graph/InProcessGraph'
import { OnePagerSynthesizer } from './OnePagerSynthesizer'

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
	return {
		type: 'episodic',
		content: 'placeholder content',
		createdAt: new Date().toISOString(),
		...overrides,
	}
}

function daysAgo(days: number): string {
	return new Date(Date.now() - days * 86_400_000).toISOString()
}

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
			if (start) items = items.filter((e) => e.createdAt >= start)

			if (options.orderBy === 'salience') {
				items.sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
				if (options.order === 'asc') items.reverse()
			}

			if (options.limit) items = items.slice(0, options.limit)

			return { items, total: items.length, hasMore: false }
		}),
	} as unknown as IMemoryService
}

function makeConnectedGraph(entityId: string): InProcessGraph {
	const graph = new InProcessGraph()
	graph.upsertEntity({ id: entityId, name: entityId, type: 'concept' })
	return graph
}

describe('OnePagerSynthesizer.regenerate', () => {
	test('returns "" when there is no recent salient activity to seed scope from', async () => {
		const memory = makeFakeMemory([])
		const graph = new InProcessGraph()

		expect(await new OnePagerSynthesizer().regenerate(memory, graph)).toBe('')
	})

	test('T3 fallback - no llmService available still renders a concatenated, salience-sorted one-pager', async () => {
		const entityId = 'project-x'
		const seed = makeEntry({
			id: 'seed',
			type: 'semantic',
			content: 'Working on Project X launch',
			createdAt: daysAgo(1),
			salience: 0.9,
			entities: [entityId],
		})
		const related = makeEntry({
			id: 'related',
			type: 'episodic',
			content: 'Discussed Project X timeline',
			createdAt: daysAgo(1),
			salience: 0.5,
			entities: [entityId],
		})
		const memory = makeFakeMemory([seed, related])
		const graph = makeConnectedGraph(entityId)

		const result = await new OnePagerSynthesizer().regenerate(memory, graph)

		expect(result).toContain('Working on Project X launch')
		expect(result).toContain('Discussed Project X timeline')
		// Salience-sorted: the higher-salience seed entry appears first.
		expect(result.indexOf('Working on Project X launch')).toBeLessThan(
			result.indexOf('Discussed Project X timeline')
		)
	})

	test('uses the LLM condensation result when an llmService is available', async () => {
		const entityId = 'project-x'
		const seed = makeEntry({
			id: 'seed',
			type: 'semantic',
			content: 'Working on Project X launch',
			createdAt: daysAgo(1),
			salience: 0.9,
			entities: [entityId],
		})
		const memory = makeFakeMemory([seed])
		const graph = makeConnectedGraph(entityId)
		const llmService = { complete: vi.fn(async () => 'Condensed narrative about Project X.') }

		const result = await new OnePagerSynthesizer().regenerate(memory, graph, llmService)

		expect(result).toBe('Condensed narrative about Project X.')
		expect(llmService.complete).toHaveBeenCalledTimes(1)
	})

	test('falls back to T3 when the LLM call fails', async () => {
		const entityId = 'project-x'
		const seed = makeEntry({
			id: 'seed',
			type: 'semantic',
			content: 'Working on Project X launch',
			createdAt: daysAgo(1),
			salience: 0.9,
			entities: [entityId],
		})
		const memory = makeFakeMemory([seed])
		const graph = makeConnectedGraph(entityId)
		const llmService = {
			complete: vi.fn(async () => {
				throw new Error('LLM unavailable')
			}),
		}

		const result = await new OnePagerSynthesizer().regenerate(memory, graph, llmService)

		expect(result).toContain('Working on Project X launch')
	})
})

describe('OnePagerSynthesizer.markStaleIfScoped', () => {
	const synthesizer = new OnePagerSynthesizer()

	test('true when the entry references an entity already in scope', () => {
		const entry = makeEntry({ id: 'e', entities: ['project-x'] })
		expect(synthesizer.markStaleIfScoped(entry, ['project-x', 'other'])).toBe(true)
	})

	test('false when the entry has no overlap with scope', () => {
		const entry = makeEntry({ id: 'e', entities: ['unrelated'] })
		expect(synthesizer.markStaleIfScoped(entry, ['project-x'])).toBe(false)
	})

	test('false when scope is empty', () => {
		const entry = makeEntry({ id: 'e', entities: ['project-x'] })
		expect(synthesizer.markStaleIfScoped(entry, [])).toBe(false)
	})
})
