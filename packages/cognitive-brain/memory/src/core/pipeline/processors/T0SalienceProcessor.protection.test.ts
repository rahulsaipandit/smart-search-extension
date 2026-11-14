import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../../types'
import {
	PROTECTED_IMPORTANCE,
	evaluateRetentionPolicy,
	isProtectedFromForgetting,
} from './T0SalienceProcessor'

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
const entry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
	id: 'e1',
	type: 'episodic',
	content: 'User: hello\nAssistant: hi',
	createdAt: daysAgo(100),
	lifecycleState: 'active',
	...overrides,
})

describe('what retention leaves alone', () => {
	test('an old, unremarkable episode is still deleted after 90 days and shortened after 30 (nothing changed for it)', () => {
		expect(evaluateRetentionPolicy(entry({ createdAt: daysAgo(100) }))).toBe('tombstone_episode')
		expect(evaluateRetentionPolicy(entry({ createdAt: daysAgo(40) }))).toBe('compact_raw')
	})

	test('an entry in the user profile is neither deleted nor shortened, however old', () => {
		const fact = entry({ tags: ['conversation', 'profile:life_context'] })
		expect(evaluateRetentionPolicy(fact)).toBeNull()
		expect(evaluateRetentionPolicy({ ...fact, createdAt: daysAgo(40) })).toBeNull()
		expect(evaluateRetentionPolicy({ ...fact, createdAt: daysAgo(400) })).toBeNull()
	})

	test('an entry scored important is kept whole', () => {
		expect(evaluateRetentionPolicy(entry({ importance: PROTECTED_IMPORTANCE }))).toBeNull()
		expect(evaluateRetentionPolicy(entry({ importance: 5, createdAt: daysAgo(40) }))).toBeNull()
	})

	test('an importance just below the line is not protected', () => {
		expect(isProtectedFromForgetting({ importance: PROTECTED_IMPORTANCE - 1 })).toBe(false)
		expect(evaluateRetentionPolicy(entry({ importance: PROTECTED_IMPORTANCE - 1 }))).toBe(
			'tombstone_episode'
		)
	})

	test('"durable" alone is not protection: the pattern is broad ("I\'m hungry") and storage must stay bounded', () => {
		expect(isProtectedFromForgetting({ ...entry({ isDurable: true }) })).toBe(false)
		expect(evaluateRetentionPolicy(entry({ isDurable: true }))).toBe('tombstone_episode')
	})

	test('the other policies still apply to a protected entry (it is only kept whole)', () => {
		const procedure = entry({
			type: 'procedure',
			importance: 5,
			metadata: { supersededBy: 'p2' },
			createdAt: daysAgo(1),
		})
		expect(evaluateRetentionPolicy(procedure)).toBe('deprecate_procedure')
	})
})
