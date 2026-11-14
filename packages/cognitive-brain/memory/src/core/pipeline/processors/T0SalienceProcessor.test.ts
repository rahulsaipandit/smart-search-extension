import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../../types'
import { computeSalience, evaluateRetentionPolicy } from './T0SalienceProcessor'

// Fixed createdAt so every entry in a test has the same age. This is NOT enough to make two
// computeSalience() calls exactly equal: the recency term decays continuously from `Date.now()`, which
// computeSalience() reads on every call (T0SalienceProcessor.ts), so two calls a millisecond apart can
// differ by a floating-point epsilon.
//
// KNOWN TIMING FLAKE (seen 2026-10-04): the equality checks below used exact `toBe`, and
// 'reinforcement boost is capped at 0.15 regardless of restatement count' failed intermittently (once in
// roughly ten local runs) whenever the clock ticked between the two calls. They now compare with
// `toBeCloseTo(_, 6)`. Use the same for any new comparison of two computeSalience() results, or inject a
// clock if exact equality is ever needed.
const FIXED_CREATED_AT = new Date().toISOString()

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: 'e1',
		type: 'episodic',
		content: 'test content',
		createdAt: FIXED_CREATED_AT,
		...overrides,
	}
}

describe('computeSalience - reinforcement_boost (§16.3)', () => {
	test('restatementCount of 0 adds no boost', () => {
		const withNone = computeSalience(makeEntry())
		const withZero = computeSalience(makeEntry({ metadata: { restatementCount: 0 } }))
		expect(withZero).toBeCloseTo(withNone, 6) // not toBe: see the timing-flake note at the top of the file
	})

	test('each restatement adds 0.02, capped at 0.15', () => {
		const base = computeSalience(makeEntry())
		const withFive = computeSalience(makeEntry({ metadata: { restatementCount: 5 } }))
		expect(withFive).toBeCloseTo(Math.min(1, base + 0.1), 5)
	})

	test('reinforcement boost is capped at 0.15 regardless of restatement count', () => {
		const withCap = computeSalience(makeEntry({ metadata: { restatementCount: 20 } }))
		const withOverCap = computeSalience(makeEntry({ metadata: { restatementCount: 200 } }))
		// Not toBe: this is the assertion that failed intermittently (timing-flake note at the top of the file).
		expect(withCap).toBeCloseTo(withOverCap, 6)
	})

	test('salience never exceeds 1 even with reinforcement boost stacked on other factors', () => {
		const entry = makeEntry({
			outcome: 'failure',
			entities: ['a', 'b', 'c', 'd'],
			linkedProcedureIds: ['p1'],
			retrievalCount: 10,
			metadata: { restatementCount: 20 },
		})
		expect(computeSalience(entry)).toBeLessThanOrEqual(1)
	})
})

describe('evaluateRetentionPolicy - reverify_fact', () => {
	const fact = (metadata?: Record<string, unknown>): MemoryEntry => ({
		id: 'f',
		type: 'semantic',
		content: 'Works at Acme',
		createdAt: new Date().toISOString(),
		confidence: 0.3,
		sourceIds: [],
		salience: 0.9,
		metadata,
	})

	test('flags a low-confidence fact with few sources', () => {
		expect(evaluateRetentionPolicy(fact())).toBe('reverify_fact')
	})

	test('does not flag it again once the user confirmed it is still true', () => {
		expect(evaluateRetentionPolicy(fact({ verifiedAt: '2026-10-04T00:00:00.000Z' }))).not.toBe(
			'reverify_fact'
		)
	})
})
