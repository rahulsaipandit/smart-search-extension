import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../../interfaces/IMemoryService'
import type { MemoryEntry, MemoryListPage, ProfileSection } from '../../../types'
import { PROFILE_PENDING_TAG } from '../../profile/ProfileClassifier'
import type { ProcessorContext } from '../IMemoryProcessor'
import { ProfileClassificationProcessor } from './ProfileClassificationProcessor'

const entry = (content: string, tags: string[] = ['conversation']): MemoryEntry => ({
	id: 'e1',
	type: 'episodic',
	content,
	tags,
	createdAt: new Date().toISOString(),
	isDurable: true,
})

function setup() {
	const updates: Partial<MemoryEntry>[] = []
	const sections: ProfileSection[] = []
	const complete = vi.fn(async () => 'life_context')
	const memory: Partial<IMemoryService> = {
		list: vi.fn(async (): Promise<MemoryListPage> => ({ items: [], total: 0, hasMore: false })),
		update: vi.fn(async (_id: string, patch: Partial<MemoryEntry>) => void updates.push(patch)),
		persistProfileSection: vi.fn(async (s: ProfileSection) => void sections.push(s)),
	}
	const context = { memory: memory as IMemoryService, llmService: { complete } } as ProcessorContext
	return { context, updates, sections, complete }
}

const processor = new ProfileClassificationProcessor()

describe('ProfileClassificationProcessor: patterns inline, the model later', () => {
	test('a durable entry the patterns miss is tagged pending, and a model is NOT called in the pipeline', async () => {
		const { context, updates, sections, complete } = setup()
		await processor.process(
			entry('User: ops is mine now, all of it\nAssistant: Understood.'),
			context
		)
		expect(complete).not.toHaveBeenCalled()
		expect(updates[0]?.tags).toEqual(['conversation', PROFILE_PENDING_TAG])
		expect(updates[0]?.metadata).toMatchObject({ profileClassified: true })
		expect(sections).toHaveLength(0)
	})

	test('a pending entry does not count as a profile fact (no "profile:" prefix)', () => {
		expect(PROFILE_PENDING_TAG.startsWith('profile:')).toBe(false)
	})

	test('an entry the patterns place is not marked pending', async () => {
		const { context, updates } = setup()
		await processor.process(entry("User: I'm a VP of Sales\nAssistant: Hello."), context)
		expect(updates[0]?.tags).toEqual(['conversation', 'profile:life_context'])
	})

	test('the pending tag is not added twice', async () => {
		const { context, updates } = setup()
		await processor.process(
			entry('User: ops is mine now\nAssistant: ok', ['conversation', PROFILE_PENDING_TAG]),
			context
		)
		expect(updates[0]?.tags).toEqual(['conversation', PROFILE_PENDING_TAG])
	})

	test('the section text (offline fallback, no model) is the user words, not the reply', async () => {
		const { context, sections } = setup()
		context.llmService = undefined
		const e = entry(
			'User: I work at Stripe\nAssistant: Your profile: a long reply that must not be in the profile.'
		)
		const memory = context.memory as unknown as { list: ReturnType<typeof vi.fn> }
		memory.list.mockResolvedValue({
			items: [{ ...e, tags: ['profile:life_context'] }],
			total: 1,
			hasMore: false,
		})
		await processor.process(e, context)
		expect(sections[0]?.dynamic).toContain('I work at Stripe')
		expect(sections[0]?.dynamic).not.toContain('must not be in the profile')
	})
})
