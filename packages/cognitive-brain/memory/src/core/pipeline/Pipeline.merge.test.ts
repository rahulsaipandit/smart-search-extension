import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../types'
import { mergeEnrichment } from './Pipeline'

const base: MemoryEntry = {
	id: 'e',
	type: 'episodic',
	content: 'User: I ran the marathon',
	createdAt: '2026-10-04T00:00:00.000Z',
	updatedAt: '2026-10-04T00:00:00.000Z',
	metadata: { turnId: 't1' },
}

describe('mergeEnrichment - pipeline write-back must not lose concurrent updates', () => {
	test('keeps fields the app changed while enrichment ran, and applies what enrichment changed', () => {
		const before = structuredClone(base)
		const after = {
			...structuredClone(base),
			salience: 0.7,
			importance: 4,
			entities: ['marathon'],
			isDurable: true,
		}
		const latest = {
			...structuredClone(base),
			lifecycleState: 'deprecated' as const,
			tags: ['goal-completed'],
		}
		const merged = mergeEnrichment(before, after, latest)
		expect(merged).toMatchObject({
			lifecycleState: 'deprecated',
			tags: ['goal-completed'],
			salience: 0.7,
			importance: 4,
			entities: ['marathon'],
			isDurable: true,
		})
	})

	test('merges metadata per key', () => {
		const before = structuredClone(base)
		const after = { ...structuredClone(base), metadata: { turnId: 't1', durabilityReason: 'fact' } }
		const latest = { ...structuredClone(base), metadata: { turnId: 't1', goalId: 'g1' } }
		expect(mergeEnrichment(before, after, latest).metadata).toEqual({
			turnId: 't1',
			goalId: 'g1',
			durabilityReason: 'fact',
		})
	})

	test('a field both changed: enrichment wins only for fields it actually changed', () => {
		const before = structuredClone(base)
		const after = { ...structuredClone(base), salience: 0.5 }
		const latest = { ...structuredClone(base), salience: 0.9, content: 'edited by the user' }
		const merged = mergeEnrichment(before, after, latest)
		expect(merged.content).toBe('edited by the user')
		expect(merged.salience).toBe(0.5)
	})

	test('no enrichment change leaves the stored entry exactly as it is', () => {
		const latest = { ...structuredClone(base), lifecycleState: 'deprecated' as const }
		expect(mergeEnrichment(structuredClone(base), structuredClone(base), latest)).toEqual(latest)
	})
})
