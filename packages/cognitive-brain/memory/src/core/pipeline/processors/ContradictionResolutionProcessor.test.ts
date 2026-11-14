import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../../interfaces/IMemoryService'
import type { MemoryEntry, MemorySearchPage } from '../../../types'
import type { ProcessorContext } from '../IMemoryProcessor'
import { ContradictionResolutionProcessor } from './ContradictionResolutionProcessor'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: overrides.id ?? 'entry',
		type: 'semantic',
		content: 'placeholder',
		createdAt: new Date().toISOString(),
		isDurable: true,
		entities: ['Sarah'],
		...overrides,
	}
}

/** Minimal fake IMemoryService - only the methods this processor calls are exercised. */
function makeFakeMemory(searchResults: MemoryEntry[]) {
	const updates: { id: string; patch: Partial<MemoryEntry> }[] = []
	const relations: { fromId: string; relation: { type: string; targetId: string } }[] = []

	const memory: Partial<IMemoryService> = {
		search: vi.fn(async (): Promise<MemorySearchPage> => ({
			items: searchResults.map((entry) => ({ entry, score: 1 })),
			total: searchResults.length,
			hasMore: false,
		})),
		get: vi.fn(async (id: string) => searchResults.find((e) => e.id === id) ?? null),
		update: vi.fn(async (id: string, patch: Partial<MemoryEntry>) => {
			updates.push({ id, patch })
		}),
		addRelation: vi.fn(async (fromId: string, relation: { type: string; targetId: string }) => {
			relations.push({ fromId, relation })
		}),
	}

	return { memory: memory as IMemoryService, updates, relations }
}

function makeContext(
	searchResults: MemoryEntry[],
	llmResponse?: string
): {
	context: ProcessorContext
	updates: { id: string; patch: Partial<MemoryEntry> }[]
	relations: { fromId: string; relation: { type: string; targetId: string } }[]
} {
	const { memory, updates, relations } = makeFakeMemory(searchResults)
	const context: ProcessorContext = {
		memory,
		llmService:
			llmResponse === undefined ? undefined : { complete: vi.fn(async () => llmResponse) },
	}
	return { context, updates, relations }
}

describe('ContradictionResolutionProcessor.shouldProcess', () => {
	const processor = new ContradictionResolutionProcessor()

	test('false when not durable', async () => {
		expect(await processor.shouldProcess(makeEntry({ isDurable: false }))).toBe(false)
	})

	test('false when no linked entities', async () => {
		expect(await processor.shouldProcess(makeEntry({ entities: [] }))).toBe(false)
	})

	test('false when already checked', async () => {
		expect(
			await processor.shouldProcess(makeEntry({ metadata: { contradictionChecked: true } }))
		).toBe(false)
	})

	test('true when durable, has entities, and not yet checked', async () => {
		expect(await processor.shouldProcess(makeEntry())).toBe(true)
	})
})

describe('ContradictionResolutionProcessor.process - candidate filtering', () => {
	const processor = new ContradictionResolutionProcessor()

	test('ignores candidates that are not durable', async () => {
		const candidate = makeEntry({ id: 'old', isDurable: false })
		const { context, relations } = makeContext([candidate], '{"kind":"updates","confidence":0.95}')
		await processor.process(makeEntry({ id: 'new' }), context)
		expect(relations).toHaveLength(0)
	})

	test('ignores candidates already superseded (have a child relation)', async () => {
		const candidate = makeEntry({ id: 'old', relations: [{ type: 'child', targetId: 'newer' }] })
		const { context, relations } = makeContext([candidate], '{"kind":"updates","confidence":0.95}')
		await processor.process(makeEntry({ id: 'new' }), context)
		expect(relations).toHaveLength(0)
	})

	test('ignores candidates with no overlapping entity', async () => {
		const candidate = makeEntry({ id: 'old', entities: ['Google'] })
		const { context, relations } = makeContext([candidate], '{"kind":"updates","confidence":0.95}')
		await processor.process(makeEntry({ id: 'new', entities: ['Sarah'] }), context)
		expect(relations).toHaveLength(0)
	})

	test('accepts a legacy candidate with isDurable undefined (pre-existing entry)', async () => {
		const candidate = makeEntry({ id: 'old', isDurable: undefined })
		const { context, relations } = makeContext([candidate], '{"kind":"updates","confidence":0.95}')
		await processor.process(makeEntry({ id: 'new' }), context)
		expect(relations).toContainEqual({
			fromId: 'old',
			relation: { type: 'child', targetId: 'new' },
		})
	})

	test('matches a candidate of a different MemoryType (cross-tier)', async () => {
		const candidate = makeEntry({ id: 'old', type: 'episodic' })
		const newEntry = makeEntry({ id: 'new', type: 'semantic' })
		const { context, relations } = makeContext([candidate], '{"kind":"updates","confidence":0.95}')
		await processor.process(newEntry, context)
		expect(relations).toContainEqual({
			fromId: 'old',
			relation: { type: 'child', targetId: 'new' },
		})
	})
})

describe('ContradictionResolutionProcessor.process - classification outcomes (with LLM)', () => {
	const processor = new ContradictionResolutionProcessor()

	test("'updates' creates a parent/child version chain and deprecates the old entry", async () => {
		const candidate = makeEntry({ id: 'old', content: 'Sarah works at Google' })
		const newEntry = makeEntry({ id: 'new', content: 'Sarah works at Stripe now' })
		const { context, updates, relations } = makeContext(
			[candidate],
			'{"kind":"updates","confidence":0.9}'
		)

		await processor.process(newEntry, context)

		expect(relations).toContainEqual({
			fromId: 'new',
			relation: { type: 'parent', targetId: 'old', metadata: { confidence: 0.9 } },
		})
		expect(relations).toContainEqual({
			fromId: 'old',
			relation: { type: 'child', targetId: 'new' },
		})
		expect(updates.find((u) => u.id === 'old')?.patch).toMatchObject({
			lifecycleState: 'deprecated',
		})
		expect(updates.find((u) => u.id === 'new')?.patch.metadata).toMatchObject({
			contradictionChecked: true,
		})
	})

	test("'extends' links both entries without deprecating either", async () => {
		const candidate = makeEntry({ id: 'old', content: 'Sarah works at Stripe' })
		const newEntry = makeEntry({ id: 'new', content: 'Sarah works at Stripe on the payments team' })
		const { context, updates, relations } = makeContext(
			[candidate],
			'{"kind":"extends","confidence":0.85}'
		)

		await processor.process(newEntry, context)

		expect(relations).toContainEqual({
			fromId: 'new',
			relation: { type: 'extends', targetId: 'old' },
		})
		expect(relations).toContainEqual({
			fromId: 'old',
			relation: { type: 'extends', targetId: 'new' },
		})
		expect(updates.find((u) => u.id === 'old' && u.patch.lifecycleState)).toBeUndefined()
	})

	test("'same' increments the existing entry's restatementCount instead of creating a relation", async () => {
		const candidate = makeEntry({
			id: 'old',
			content: 'Sarah lives in Austin',
			metadata: { restatementCount: 2 },
		})
		const newEntry = makeEntry({ id: 'new', content: 'Sarah lives in Austin' })
		const { context, updates, relations } = makeContext(
			[candidate],
			'{"kind":"same","confidence":0.9}'
		)

		await processor.process(newEntry, context)

		expect(relations).toHaveLength(0)
		expect(updates.find((u) => u.id === 'old')?.patch.metadata).toMatchObject({
			restatementCount: 3,
		})
		expect(updates.find((u) => u.id === 'new')?.patch.metadata).toMatchObject({ mergedInto: 'old' })
	})

	test("concurrent 'same' classifications against the same candidate do not lose an increment (race regression)", async () => {
		// Stateful fake: get()/update() share mutable state and get() has an
		// artificial delay, so two concurrent process() calls racing without the
		// processor's internal per-id serialization would both read
		// restatementCount = 0 and both write back 1 instead of reaching 2.
		let candidateState: MemoryEntry = makeEntry({ id: 'old', metadata: {} })
		const newEntryA = makeEntry({ id: 'new-a' })
		const newEntryB = makeEntry({ id: 'new-b' })

		const memory: Partial<IMemoryService> = {
			search: vi.fn(async () => ({
				items: [{ entry: candidateState, score: 1 }],
				total: 1,
				hasMore: false,
			})),
			get: vi.fn(async (id: string) => {
				await new Promise((resolve) => setTimeout(resolve, 5))
				return id === candidateState.id ? candidateState : null
			}),
			update: vi.fn(async (id: string, patch: Partial<MemoryEntry>) => {
				if (id === candidateState.id) candidateState = { ...candidateState, ...patch }
			}),
			addRelation: vi.fn(async () => {}),
		}
		const context: ProcessorContext = {
			memory: memory as IMemoryService,
			llmService: { complete: vi.fn(async () => '{"kind":"same","confidence":0.9}') },
		}

		const processor = new ContradictionResolutionProcessor()
		await Promise.all([
			processor.process(newEntryA, context),
			processor.process(newEntryB, context),
		])

		expect(candidateState.metadata?.restatementCount).toBe(2)
	})

	test('below-threshold confidence is treated as a no-op', async () => {
		const candidate = makeEntry({ id: 'old' })
		const newEntry = makeEntry({ id: 'new' })
		const { context, updates, relations } = makeContext(
			[candidate],
			'{"kind":"updates","confidence":0.4}'
		)

		await processor.process(newEntry, context)

		expect(relations).toHaveLength(0)
		expect(updates.find((u) => u.id === 'new')?.patch.metadata).toMatchObject({
			contradictionChecked: true,
		})
	})
})

describe('ContradictionResolutionProcessor.process - no-LLM fallback', () => {
	const processor = new ContradictionResolutionProcessor()

	test('near-identical content is treated as a restatement without an LLM', async () => {
		const candidate = makeEntry({
			id: 'old',
			content: 'I prefer window seats when flying long distance',
		})
		const newEntry = makeEntry({
			id: 'new',
			content: 'I prefer window seats when flying long distance',
		})
		const { context, updates } = makeContext([candidate]) // no llmResponse -> llmService undefined

		await processor.process(newEntry, context)

		expect(updates.find((u) => u.id === 'old')?.patch.metadata).toMatchObject({
			restatementCount: 1,
		})
	})

	test('dissimilar content makes no changes without an LLM (safe default)', async () => {
		const candidate = makeEntry({ id: 'old', content: 'Sarah works at Google as an engineer' })
		const newEntry = makeEntry({
			id: 'new',
			content: 'Sarah moved to Austin last month for a new role',
		})
		const { context, updates, relations } = makeContext([candidate])

		await processor.process(newEntry, context)

		expect(relations).toHaveLength(0)
		expect(updates.find((u) => u.id === 'old')).toBeUndefined()
		expect(updates.find((u) => u.id === 'new')?.patch.metadata).toMatchObject({
			contradictionChecked: true,
		})
	})
})

describe('ContradictionResolutionProcessor refine hook', () => {
	const setup = async (
		options: ConstructorParameters<typeof ContradictionResolutionProcessor>[0]
	) => {
		const candidate = makeEntry({ id: 'old' })
		const { context, updates, relations } = makeContext(
			[candidate],
			'{"kind":"same","confidence":0.1}'
		)
		await new ContradictionResolutionProcessor(options).process(makeEntry({ id: 'new' }), context)
		return { updates, relations }
	}

	test('never applies a proposal-only "updates"; it hands it to onProposal', async () => {
		const onProposal = vi.fn()
		const { updates, relations } = await setup({
			refine: async () => ({ kind: 'updates', confidence: 0.95, needsProposal: true }),
			onProposal,
		})
		expect(onProposal).toHaveBeenCalledTimes(1)
		expect(relations).toHaveLength(0)
		expect(updates.some((u) => u.patch.lifecycleState === 'deprecated')).toBe(false)
	})

	test('treats a refined "updates" as a proposal even without needsProposal', async () => {
		const onProposal = vi.fn()
		const { updates, relations } = await setup({
			refine: async () => ({ kind: 'updates', confidence: 0.55 }),
			onProposal,
		})
		expect(onProposal).toHaveBeenCalledTimes(1)
		expect(relations).toHaveLength(0)
		expect(updates.some((u) => u.patch.lifecycleState === 'deprecated')).toBe(false)
	})

	test('keeps the baseline when refine throws or returns null', async () => {
		for (const refine of [
			async () => {
				throw new Error('x')
			},
			async () => null,
		]) {
			const onProposal = vi.fn()
			const { relations } = await setup({ refine, onProposal })
			expect(onProposal).not.toHaveBeenCalled()
			expect(relations).toHaveLength(0)
		}
	})

	test('applies a refined result below the baseline 0.7 threshold (the refiner applied its own floors)', async () => {
		const { relations } = await setup({
			refine: async () => ({ kind: 'extends', confidence: 0.55 }),
		})
		expect(relations).toContainEqual({
			fromId: 'new',
			relation: { type: 'extends', targetId: 'old' },
		})
	})
})

describe('ContradictionResolutionProcessor refine hook - cost', () => {
	test('a confident refiner never triggers the LLM baseline call', async () => {
		const { context } = makeContext([makeEntry({ id: 'old' })], '{"kind":"same","confidence":0.9}')
		const processor = new ContradictionResolutionProcessor({
			refine: async () => ({ kind: 'extends', confidence: 0.6 }),
		})
		await processor.process(makeEntry({ id: 'new' }), context)
		// eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion, not a detached call
		expect(context.llmService!.complete).not.toHaveBeenCalled()
	})

	test('the baseline is computed once when the refiner asks for it and then has no answer', async () => {
		const { context, relations } = makeContext(
			[makeEntry({ id: 'old' })],
			'{"kind":"extends","confidence":0.9}'
		)
		const processor = new ContradictionResolutionProcessor({
			refine: async (_e, _c, getBaseline) => {
				await getBaseline() // e.g. shadow mode records it
				return null
			},
		})
		await processor.process(makeEntry({ id: 'new' }), context)
		// eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion, not a detached call
		expect(context.llmService!.complete).toHaveBeenCalledTimes(1)
		expect(relations).toContainEqual({
			fromId: 'new',
			relation: { type: 'extends', targetId: 'old' },
		})
	})

	test('only the first maxRefinedCandidates candidates are refined', async () => {
		const candidates = ['a', 'b', 'c', 'd', 'e'].map((id) => makeEntry({ id }))
		const { context } = makeContext(candidates, '{"kind":"unrelated","confidence":0.9}')
		const refine = vi.fn(async () => null)
		await new ContradictionResolutionProcessor({ refine }).process(
			makeEntry({ id: 'new' }),
			context
		)
		expect(refine).toHaveBeenCalledTimes(3)
		const refine2 = vi.fn(async () => null)
		await new ContradictionResolutionProcessor({
			refine: refine2,
			maxRefinedCandidates: 1,
		}).process(
			makeEntry({ id: 'new2' }),
			makeContext(candidates, '{"kind":"unrelated","confidence":0.9}').context
		)
		expect(refine2).toHaveBeenCalledTimes(1)
	})
})
