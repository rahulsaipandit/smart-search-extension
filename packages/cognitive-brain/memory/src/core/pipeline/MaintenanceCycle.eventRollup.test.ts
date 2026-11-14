import { describe, expect, test, vi } from 'vitest'

import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { IVaultProvider } from '../../interfaces/IVaultProvider'
import type { MemoryEntry } from '../../types'
import { InProcessGraph } from '../graph/InProcessGraph'
import type { SynthesisEngine } from '../synthesis/SynthesisEngine'
import { MaintenanceCycle } from './MaintenanceCycle'
import type { Pipeline } from './Pipeline'

function iso(daysAgo: number): string {
	return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

function makeStore(): { store: IMemoryStore; puts: MemoryEntry[] } {
	const puts: MemoryEntry[] = []
	const store: Partial<IMemoryStore> = {
		put: vi.fn(async (entry: MemoryEntry) => {
			puts.push(entry)
		}),
		query: vi.fn(async () => ({ entries: [], cursor: null })),
	}
	return { store: store as IMemoryStore, puts }
}

function makeCycle(graph: InProcessGraph, opts: { vault?: IVaultProvider } = {}) {
	const { store, puts } = makeStore()
	const index: Partial<IMemoryIndex> = {}
	const pipeline: Partial<Pipeline> = {}
	const synthesisEngine: Partial<SynthesisEngine> = {}

	const cycle = new MaintenanceCycle({
		store,
		index: index as IMemoryIndex,
		graph,
		pipeline: pipeline as Pipeline,
		synthesisEngine: synthesisEngine as SynthesisEngine,
		vault: opts.vault,
		// Small window so the test doesn't need to fabricate hundreds of events
		// to exceed the production default (500 hot / 90 days).
		maxEventAgeMs: 90 * 86_400_000,
		maxHotEvents: 500,
	})
	return { cycle, puts }
}

describe('MaintenanceCycle - event_rollup phase (designCognitiveBrain.md §16.8.2 point 5)', () => {
	test('no-ops when nothing is stale', async () => {
		const graph = new InProcessGraph()
		graph.createEventNode({
			predicate: 'organized',
			actorId: 'emily',
			occurredAt: iso(1),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})
		const { cycle, puts } = makeCycle(graph)

		const result = await cycle.runPhases(['event_rollup'])

		expect(result.phases[0]).toMatchObject({ name: 'event_rollup', processed: 0, skipped: false })
		expect(puts).toHaveLength(0)
		expect(graph.stats.eventCount).toBe(1)
	})

	test('rolls up stale events, writes a local archive entry, and prunes the hot graph', async () => {
		const graph = new InProcessGraph()
		for (let i = 0; i < 3; i++) {
			graph.createEventNode({
				predicate: 'chatted',
				actorId: 'emily',
				occurredAt: iso(120 + i),
				confidence: 0.8,
				sourceEntryId: `entry-${i}`,
			})
		}
		const { cycle, puts } = makeCycle(graph)

		const result = await cycle.runPhases(['event_rollup'])

		expect(result.phases[0]).toMatchObject({ name: 'event_rollup', processed: 3, skipped: false })

		// Hot graph now holds only the rollup summary node, not the 3 raw events.
		expect(graph.stats.eventCount).toBe(1)
		expect(graph.getEventsForEntity('emily', 'actor')[0]!.isSummary).toBe(true)

		// A local artifact archive was written unconditionally (§5.1 principle).
		expect(puts).toHaveLength(1)
		expect(puts[0]).toMatchObject({ type: 'artifact', tags: ['event-archive'] })
		expect(puts[0]!.metadata).toMatchObject({ eventCount: 3, summaryCount: 1 })
		expect(puts[0]!.content).toContain('entry-0')
	})

	test('also pushes the archive to the vault when one is configured', async () => {
		const graph = new InProcessGraph()
		graph.createEventNode({
			predicate: 'chatted',
			actorId: 'bob',
			occurredAt: iso(200),
			confidence: 0.7,
			sourceEntryId: 'entry-x',
		})
		const updatePage = vi.fn(async (_slug: string, _content: string, _frontmatter: unknown) => {})
		const vault: Partial<IVaultProvider> = { updatePage }
		const { cycle, puts } = makeCycle(graph, { vault: vault as IVaultProvider })

		await cycle.runPhases(['event_rollup'])

		expect(puts).toHaveLength(1)
		expect(updatePage).toHaveBeenCalledTimes(1)
		const [slug, content, frontmatter] = updatePage.mock.calls[0]!
		expect(slug).toBe(puts[0]!.id)
		expect(content).toContain('entry-x')
		expect(frontmatter).toMatchObject({ type: 'event-archive' })
	})

	test('a vault push failure is non-fatal - local archive still lands', async () => {
		const graph = new InProcessGraph()
		graph.createEventNode({
			predicate: 'chatted',
			actorId: 'carol',
			occurredAt: iso(200),
			confidence: 0.7,
			sourceEntryId: 'entry-y',
		})
		const vault: Partial<IVaultProvider> = {
			updatePage: vi.fn(async () => {
				throw new Error('vault unreachable')
			}),
		}
		const { cycle, puts } = makeCycle(graph, { vault: vault as IVaultProvider })

		const result = await cycle.runPhases(['event_rollup'])

		expect(result.phases[0]!.error).toBeUndefined()
		expect(puts).toHaveLength(1)
	})
})
