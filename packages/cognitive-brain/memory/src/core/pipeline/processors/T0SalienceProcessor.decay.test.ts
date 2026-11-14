import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../../types'
import { computeSalience } from './T0SalienceProcessor'

// designMemory.md §10.1 "Silent invalidation from outside the conversation entirely"
// and §10.4 Technique 4: world-event invalidation (e.g. an employer is acquired) and
// long-silence relevance decay have no in-conversation signal to seed, so they can't
// be tested as chat-response fixtures (see app/test-memory-drift.jsx). Instead this
// asserts the underlying decay mechanism the design doc's §10.3 open question depends
// on: an old, never-reinforced fact's computed salience actually drops, so a fresher
// contradicting entry can out-rank it in retrieval.

const DAY_MS = 24 * 60 * 60 * 1000

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: 'e1',
		type: 'episodic',
		content: 'test content',
		createdAt: new Date().toISOString(),
		...overrides,
	}
}

describe('computeSalience - staleness decay (designMemory.md §10.4 Technique 4)', () => {
	test('recency term saturates to 0 once an entry is more than 24h old', () => {
		const fresh = computeSalience(makeEntry({ createdAt: new Date().toISOString() }))
		const oneWeekOld = computeSalience(
			makeEntry({ createdAt: new Date(Date.now() - 7 * DAY_MS).toISOString() })
		)
		const oneYearOld = computeSalience(
			makeEntry({ createdAt: new Date(Date.now() - 365 * DAY_MS).toISOString() })
		)
		// Recency decays linearly to 0 over the first 24h and stays at 0 after that
		// (T0SalienceProcessor.ts recency = max(0, 1 - ageHours/24) * 0.3), so a
		// week-old and a year-old entry with no other differences score identically -
		// staleness beyond 24h is currently all-or-nothing, not a continuing decay.
		expect(oneWeekOld).toBe(oneYearOld)
		expect(oneWeekOld).toBeLessThan(fresh)
	})

	test('an old fact with no reinforcement/retrieval scores low enough to be out-ranked by a fresh contradicting entry', () => {
		const oldFact = computeSalience(
			makeEntry({
				content: 'Works at Acme Corp',
				createdAt: new Date(Date.now() - 200 * DAY_MS).toISOString(),
				outcome: 'success',
				retrievalCount: 0,
			})
		)
		const freshContradiction = computeSalience(
			makeEntry({
				content: 'Acme Corp was acquired; now at Globex',
				createdAt: new Date().toISOString(),
				outcome: 'success',
			})
		)
		expect(freshContradiction).toBeGreaterThan(oldFact)
	})

	test("repeated retrieval keeps an old fact's salience from collapsing to the same floor as an unretrieved one", () => {
		// This is the gap designMemory.md §10.3 flags as unresolved: salience decay
		// alone has no signal for "this is probably superseded" versus "this is old
		// but still true and gets referenced often" - retrieval_boost (§9.2) is the
		// only thing that currently distinguishes them, and it is capped at +0.1,
		// which is smaller than the 0.3 recency term it's compensating for.
		const oldUnreferenced = computeSalience(
			makeEntry({
				createdAt: new Date(Date.now() - 200 * DAY_MS).toISOString(),
				retrievalCount: 0,
			})
		)
		const oldButFrequentlyRetrieved = computeSalience(
			makeEntry({
				createdAt: new Date(Date.now() - 200 * DAY_MS).toISOString(),
				retrievalCount: 50,
			})
		)
		expect(oldButFrequentlyRetrieved).toBeGreaterThan(oldUnreferenced)
		// Documents the current cap rather than asserting a target design value -
		// if this fails after a future change to retrieval_boost's weight, update
		// designMemory.md §9.2/§10.3 alongside it, don't just bump the expectation.
		expect(oldButFrequentlyRetrieved - oldUnreferenced).toBeLessThanOrEqual(0.1)
	})
})
