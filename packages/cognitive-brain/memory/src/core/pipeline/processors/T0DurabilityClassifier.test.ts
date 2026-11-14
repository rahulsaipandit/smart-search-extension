import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../../types'
import { applyDurabilityClassification, computeDurability } from './T0DurabilityClassifier'

describe('computeDurability', () => {
	test('declarative identity statement is durable', () => {
		expect(computeDurability({ content: "I'm a data scientist at Acme" }).isDurable).toBe(true)
	})

	test('standing preference is durable', () => {
		expect(computeDurability({ content: 'I prefer window seats when flying' }).isDurable).toBe(true)
	})

	test('relative-time phrase sets an expiry and is not durable', () => {
		const result = computeDurability({ content: 'Meeting with Sarah tomorrow at 3pm' })
		expect(result.isDurable).toBe(false)
		expect(result.expiresAt).toBeDefined()
		expect(new Date(result.expiresAt!).getTime()).toBeGreaterThan(Date.now())
	})

	test('explicit future date sets expiresAt to that date', () => {
		const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
		const result = computeDurability({ content: `Exam scheduled for ${futureDate}` })
		expect(result.isDurable).toBe(false)
		expect(result.expiresAt?.slice(0, 10)).toBe(futureDate)
	})

	test('explicit past date is not treated as an active expiry', () => {
		const result = computeDurability({ content: 'Started the job on 2020-01-01' })
		expect(result.expiresAt).toBeUndefined()
	})

	test('routine content with no signal is neither durable nor expiring', () => {
		const result = computeDurability({ content: 'That sounds interesting, tell me more' })
		expect(result.isDurable).toBe(false)
		expect(result.expiresAt).toBeUndefined()
	})

	test('title is considered alongside content', () => {
		expect(computeDurability({ title: 'I work at Stripe', content: 'as a PM' }).isDurable).toBe(
			true
		)
	})
})

describe('applyDurabilityClassification', () => {
	function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
		return {
			id: 'e1',
			type: 'episodic',
			content: 'I work at Stripe',
			createdAt: new Date().toISOString(),
			...overrides,
		}
	}

	test('mutates isDurable/expiresAt in place when unset', () => {
		const entry = makeEntry()
		applyDurabilityClassification(entry)
		expect(entry.isDurable).toBe(true)
	})

	test('is idempotent - does not override an already-classified entry', () => {
		const entry = makeEntry({ content: 'Meeting tomorrow', isDurable: true })
		applyDurabilityClassification(entry)
		// A T1/explicit caller already decided isDurable=true; the T0 fallback
		// must not overwrite that even though the content looks time-bound.
		expect(entry.isDurable).toBe(true)
		expect(entry.expiresAt).toBeUndefined()
	})
})
