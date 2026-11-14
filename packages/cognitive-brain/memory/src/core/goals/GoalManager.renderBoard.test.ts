import { describe, expect, test, vi } from 'vitest'

import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry, MemoryListPage } from '../../types'
import { GoalManager } from './GoalManager'

/**
 * Minimal in-memory IMemoryService fake - enough of create/get/update/list
 * for GoalManager's own CRUD to round-trip through, without a real store.
 */
function makeFakeMemory(): IMemoryService {
	const entries = new Map<string, MemoryEntry>()
	let nextId = 1

	return {
		initialize: vi.fn(async () => undefined),
		create: vi.fn(async (entry: Omit<MemoryEntry, 'id' | 'createdAt'>) => {
			const id = `entry-${nextId++}`
			entries.set(id, { ...entry, id, createdAt: new Date().toISOString() } as MemoryEntry)
			return id
		}),
		get: vi.fn(async (id: string) => entries.get(id) ?? null),
		update: vi.fn(async (id: string, patch: Partial<MemoryEntry>) => {
			const existing = entries.get(id)
			if (!existing) return
			entries.set(id, { ...existing, ...patch })
		}),
		list: vi.fn(async (): Promise<MemoryListPage> => {
			const items = [...entries.values()]
			return { items, total: items.length, hasMore: false }
		}),
	} as unknown as IMemoryService
}

describe('GoalManager.renderBoard', () => {
	test('returns empty string when there are no goals', async () => {
		const manager = new GoalManager(makeFakeMemory())
		await manager.initialize()

		expect(await manager.renderBoard()).toBe('')
	})

	test('open two goals, close one - renderBoard omits the closed goal (§17.7 checklist)', async () => {
		const manager = new GoalManager(makeFakeMemory())
		await manager.initialize()

		const goalA = await manager.storeGoal({ title: 'Learn Spanish', category: 'personal-growth' })
		await manager.storeGoal({ title: 'Ship the release' })

		await manager.closeGoal(goalA.id, 'success')

		const board = await manager.renderBoard()

		expect(board).not.toContain('Learn Spanish')
		expect(board).toContain('Ship the release')
		expect(board).toBe(`Current goals:\n- Ship the release — status: pending`)
	})

	test('includes paused goals as open, alongside pending/in_progress', async () => {
		const manager = new GoalManager(makeFakeMemory())
		await manager.initialize()

		await manager.storeGoal({ title: 'On hold for now', status: 'paused' })
		await manager.storeGoal({ title: 'Actively working', status: 'in_progress' })

		const board = await manager.renderBoard()

		expect(board).toContain('On hold for now')
		expect(board).toContain('Actively working')
	})
})
