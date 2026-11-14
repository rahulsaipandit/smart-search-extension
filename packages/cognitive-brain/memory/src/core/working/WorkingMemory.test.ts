import { describe, expect, test, vi } from 'vitest'

import type { MemoryEntry } from '../../types'
import { WorkingMemoryManager } from './WorkingMemory'

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
	return {
		type: 'episodic',
		content: 'x'.repeat(50),
		createdAt: new Date(0).toISOString(),
		...overrides,
	}
}

describe('WorkingMemoryManager.onEvict', () => {
	test('fires with the evicted entry and session id when the count cap is exceeded', async () => {
		const manager = new WorkingMemoryManager({ maxSize: 1, tokenBudget: 100_000 })
		const evicted: { entry: MemoryEntry; sessionId: string }[] = []
		manager.onEvict((entry, sessionId) => evicted.push({ entry, sessionId }))

		await manager.add(makeEntry({ id: 'low', salience: 0.1 }), 'session-1')
		await manager.add(makeEntry({ id: 'high', salience: 0.9 }), 'session-1')

		expect(evicted).toHaveLength(1)
		expect(evicted[0]!.entry.id).toBe('low')
		expect(evicted[0]!.sessionId).toBe('session-1')
	})

	test('does not fire while entries stay within all constraints', async () => {
		const manager = new WorkingMemoryManager({ maxSize: 5, tokenBudget: 100_000 })
		const callback = vi.fn()
		manager.onEvict(callback)

		await manager.add(makeEntry({ id: 'a' }), 'session-1')

		expect(callback).not.toHaveBeenCalled()
	})

	test('offEvict() / the onEvict() return value deregisters the listener', async () => {
		const manager = new WorkingMemoryManager({ maxSize: 1, tokenBudget: 100_000 })
		const callback = vi.fn()
		const unsubscribe = manager.onEvict(callback)
		unsubscribe()

		await manager.add(makeEntry({ id: 'low', salience: 0.1 }), 'session-1')
		await manager.add(makeEntry({ id: 'high', salience: 0.9 }), 'session-1')

		expect(callback).not.toHaveBeenCalled()
	})

	test('a callback error does not prevent eviction or other callbacks from running', async () => {
		const manager = new WorkingMemoryManager({ maxSize: 1, tokenBudget: 100_000 })
		manager.onEvict(() => {
			throw new Error('boom')
		})
		const second = vi.fn()
		manager.onEvict(second)

		await manager.add(makeEntry({ id: 'low', salience: 0.1 }), 'session-1')
		await manager.add(makeEntry({ id: 'high', salience: 0.9 }), 'session-1')

		expect(second).toHaveBeenCalledTimes(1)
		expect(manager.getForSession('session-1').map((e) => e.id)).toEqual(['high'])
	})
})
