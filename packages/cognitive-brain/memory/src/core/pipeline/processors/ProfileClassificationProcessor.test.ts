import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../../interfaces/IMemoryService'
import type { MemoryEntry, MemoryListPage, ProfileSection } from '../../../types'
import type { ProcessorContext } from '../IMemoryProcessor'
import { ProfileClassificationProcessor } from './ProfileClassificationProcessor'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: overrides.id ?? 'entry',
		type: 'semantic',
		content: 'placeholder',
		createdAt: new Date().toISOString(),
		isDurable: true,
		...overrides,
	}
}

function makeContext(): {
	context: ProcessorContext
	updates: { id: string; patch: Partial<MemoryEntry> }[]
	persistedSections: ProfileSection[]
} {
	const updates: { id: string; patch: Partial<MemoryEntry> }[] = []
	const persistedSections: ProfileSection[] = []

	const memory: Partial<IMemoryService> = {
		list: vi.fn(async (): Promise<MemoryListPage> => ({ items: [], total: 0, hasMore: false })),
		update: vi.fn(async (id: string, patch: Partial<MemoryEntry>) => {
			updates.push({ id, patch })
		}),
		persistProfileSection: vi.fn(async (section: ProfileSection) => {
			persistedSections.push(section)
		}),
	}

	return { context: { memory: memory as IMemoryService }, updates, persistedSections }
}

describe('ProfileClassificationProcessor.shouldProcess', () => {
	const processor = new ProfileClassificationProcessor()

	test('false when not durable', async () => {
		expect(await processor.shouldProcess(makeEntry({ isDurable: false }))).toBe(false)
	})

	test('false when already classified', async () => {
		expect(
			await processor.shouldProcess(makeEntry({ metadata: { profileClassified: true } }))
		).toBe(false)
	})

	test('true when durable and not yet classified', async () => {
		expect(await processor.shouldProcess(makeEntry())).toBe(true)
	})
})

describe('ProfileClassificationProcessor.process', () => {
	const processor = new ProfileClassificationProcessor()

	test('tags a matching entry, persists the section, and marks it classified', async () => {
		const entry = makeEntry({ content: 'I work at Stripe' })
		const { context, updates, persistedSections } = makeContext()

		await processor.process(entry, context)

		expect(updates[0]?.patch.tags).toEqual(['profile:life_context'])
		expect(updates[0]?.patch.metadata).toMatchObject({ profileClassified: true })
		expect(persistedSections).toHaveLength(1)
		expect(persistedSections[0]?.header).toBe('life_context')
	})

	test('marks classified but does not persist a section when nothing matches (it is tagged pending for the maintenance pass)', async () => {
		const entry = makeEntry({ content: 'ok sounds good' })
		const { context, updates, persistedSections } = makeContext()

		await processor.process(entry, context)

		expect(updates[0]?.patch.metadata).toMatchObject({ profileClassified: true })
		expect(updates[0]?.patch.tags).toEqual(['profile-pending'])
		expect(persistedSections).toHaveLength(0)
	})
})
