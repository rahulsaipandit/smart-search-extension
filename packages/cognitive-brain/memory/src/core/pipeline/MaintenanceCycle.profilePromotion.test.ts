import { describe, expect, test, vi } from 'vitest'

import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { MemoryEntry } from '../../types'
import { InProcessGraph } from '../graph/InProcessGraph'
import type { SynthesisEngine } from '../synthesis/SynthesisEngine'
import { MaintenanceCycle } from './MaintenanceCycle'
import type { Pipeline } from './Pipeline'

const episode = (id: string, content: string, tags: string[] = []): MemoryEntry => ({
	id,
	type: 'episodic',
	content,
	tags,
	createdAt: new Date().toISOString(),
	lifecycleState: 'active',
	importance: 3,
})

function run(episodes: MemoryEntry[]) {
	const puts: MemoryEntry[] = []
	const indexed: MemoryEntry[] = []
	const store = {
		put: vi.fn(async (e: MemoryEntry) => void puts.push(e)),
		query: vi.fn(async (q: { type?: string }) => ({
			entries: q.type === 'episodic' ? episodes : [],
			cursor: null,
		})),
	} as unknown as IMemoryStore
	const index = {
		index: vi.fn(async (e: MemoryEntry) => void indexed.push(e)),
	} as unknown as IMemoryIndex
	const cycle = new MaintenanceCycle({
		store,
		index,
		graph: new InProcessGraph(),
		pipeline: {} as Pipeline,
		synthesisEngine: {} as SynthesisEngine,
	})
	return { cycle, puts, indexed }
}

describe('MaintenanceCycle semantic_promotion and the user profile', () => {
	test('a profile fact is kept at importance 4 and promoted to a semantic summary, although the offline scorer says 2', async () => {
		const fact = episode(
			'p1',
			"User: I'm a VP of Sales at a logistics company\nAssistant: Your profile: VP of Sales.",
			['conversation', 'profile:life_context']
		)
		const { cycle, puts, indexed } = run([fact])

		await cycle.runPhases(['semantic_promotion'])

		expect(fact.importance).toBeGreaterThanOrEqual(4)
		const semantic = puts.find((e) => e.id === 'p1-sem')
		expect(semantic).toBeDefined()
		expect(semantic).toMatchObject({ type: 'semantic', sourceIds: ['p1'] })
		expect(indexed.map((e) => e.id)).toContain('p1-sem')
	})

	test('an ordinary short episode is scored low and not promoted (nothing changed for it)', async () => {
		const chat = episode('c1', 'User: hello\nAssistant: hi there', ['conversation'])
		const { cycle, puts } = run([chat])

		await cycle.runPhases(['semantic_promotion'])

		expect(chat.importance).toBe(2)
		expect(puts.find((e) => e.id === 'c1-sem')).toBeUndefined()
	})

	test('a profile fact that is already promoted is not promoted twice', async () => {
		const fact = episode('p2', 'User: I work at Stripe\nAssistant: ok', ['profile:life_context'])
		const store = {
			put: vi.fn(async () => {}),
			query: vi.fn(async (q: { type?: string }) => ({
				entries:
					q.type === 'episodic'
						? [fact]
						: q.type === 'semantic'
							? [
									{
										id: 'p2-sem',
										type: 'semantic',
										content: 's',
										createdAt: fact.createdAt,
										sourceIds: ['p2'],
									},
								]
							: [],
				cursor: null,
			})),
		} as unknown as IMemoryStore
		const cycle = new MaintenanceCycle({
			store,
			index: { index: vi.fn() } as unknown as IMemoryIndex,
			graph: new InProcessGraph(),
			pipeline: {} as Pipeline,
			synthesisEngine: {} as SynthesisEngine,
		})

		await cycle.runPhases(['semantic_promotion'])

		// eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion, not a detached call
		expect(store.put).not.toHaveBeenCalled()
	})
})
