import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry, MemoryListPage } from '../../types'
import { ProfileSynthesizer } from './ProfileSynthesizer'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: overrides.id ?? 'e',
		type: 'semantic',
		content: 'placeholder',
		createdAt: new Date().toISOString(),
		isDurable: true,
		...overrides,
	}
}

function daysAgo(days: number): string {
	return new Date(Date.now() - days * 86_400_000).toISOString()
}

function makeFakeMemory(items: MemoryEntry[]): IMemoryService {
	return {
		list: vi.fn(async (): Promise<MemoryListPage> => ({
			items,
			total: items.length,
			hasMore: false,
		})),
	} as unknown as IMemoryService
}

describe('ProfileSynthesizer.computeSection - static/dynamic split', () => {
	const synthesizer = new ProfileSynthesizer()

	test('a recently-created durable fact with no restatements lands in dynamic, not static', async () => {
		const fact = makeEntry({ content: 'Started a new project this week', createdAt: daysAgo(2) })
		const memory = makeFakeMemory([fact])

		const section = await synthesizer.computeSection('life_context', memory)

		expect(section.dynamic).toContain('Started a new project this week')
		expect(section.static).toBe('')
	})

	test('an old, unchallenged durable fact lands in static', async () => {
		const fact = makeEntry({ content: 'Works at Stripe', createdAt: daysAgo(30) })
		const memory = makeFakeMemory([fact])

		const section = await synthesizer.computeSection('life_context', memory)

		expect(section.static).toContain('Works at Stripe')
		expect(section.dynamic).toBe('')
	})

	test('a restated fact lands in static regardless of age', async () => {
		const fact = makeEntry({
			content: 'Prefers concise answers',
			createdAt: daysAgo(1),
			metadata: { restatementCount: 2 },
		})
		const memory = makeFakeMemory([fact])

		const section = await synthesizer.computeSection('communication_style', memory)

		expect(section.static).toContain('Prefers concise answers')
	})

	test('a restated fact does NOT also appear in dynamic (regression: static/dynamic must be mutually exclusive)', async () => {
		const fact = makeEntry({
			content: 'Prefers concise answers',
			createdAt: daysAgo(1), // young enough it would otherwise also qualify as dynamic
			metadata: { restatementCount: 2 },
		})
		const memory = makeFakeMemory([fact])

		const section = await synthesizer.computeSection('communication_style', memory)

		expect(section.static).toContain('Prefers concise answers')
		expect(section.dynamic).toBe('')
	})

	test('a superseded fact (has a child relation) is excluded from both', async () => {
		const fact = makeEntry({
			content: 'Old employer: Google',
			createdAt: daysAgo(30),
			relations: [{ type: 'child', targetId: 'newer' }],
		})
		const memory = makeFakeMemory([fact])

		const section = await synthesizer.computeSection('life_context', memory)

		expect(section.static).toBe('')
		expect(section.dynamic).toBe('')
	})

	test('a non-durable entry is excluded even if it matches the tag query', async () => {
		const fact = makeEntry({ content: 'Just chatting', isDurable: false })
		const memory = makeFakeMemory([fact])

		const section = await synthesizer.computeSection('life_context', memory)

		expect(section.static).toBe('')
		expect(section.dynamic).toBe('')
	})

	test('an unexpired future expiresAt entry lands in dynamic', async () => {
		const fact = makeEntry({
			content: 'Traveling next week',
			createdAt: daysAgo(20), // old enough it would otherwise land in static
			expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
		})
		const memory = makeFakeMemory([fact])

		const section = await synthesizer.computeSection('life_context', memory)

		expect(section.dynamic).toContain('Traveling next week')
		expect(section.static).toBe('')
	})

	test('empty fact set produces empty prose without calling the LLM', async () => {
		const memory = makeFakeMemory([])
		const llmService = { complete: vi.fn(async () => 'should not be called') }

		const section = await synthesizer.computeSection('autonomy', memory, llmService)

		expect(section.static).toBe('')
		expect(section.dynamic).toBe('')
		expect(llmService.complete).not.toHaveBeenCalled()
	})
})

describe('ProfileSynthesizer.computeSection - LLM composition', () => {
	const synthesizer = new ProfileSynthesizer()

	test('uses the LLM result when available', async () => {
		const fact = makeEntry({ content: 'Works at Stripe', createdAt: daysAgo(30) })
		const memory = makeFakeMemory([fact])
		const llmService = { complete: vi.fn(async () => 'Composed summary.') }

		const section = await synthesizer.computeSection('life_context', memory, llmService)

		expect(section.static).toBe('Composed summary.')
	})

	test('falls back to concatenation when the LLM call throws', async () => {
		const fact = makeEntry({ content: 'Works at Stripe', createdAt: daysAgo(30) })
		const memory = makeFakeMemory([fact])
		const llmService = {
			complete: vi.fn(async () => {
				throw new Error('down')
			}),
		}

		const section = await synthesizer.computeSection('life_context', memory, llmService)

		expect(section.static).toContain('Works at Stripe')
	})
})
