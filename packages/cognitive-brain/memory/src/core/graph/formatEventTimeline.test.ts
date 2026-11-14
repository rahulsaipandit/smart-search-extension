import { describe, expect, test } from 'vitest'

import type { EventSummary } from '../../types'
import { formatEventTimeline } from './formatEventTimeline'

function makeEvent(overrides: Partial<EventSummary> = {}): EventSummary {
	return {
		id: 'event_1',
		predicate: 'organized',
		actorName: 'Emily',
		targetName: 'AI Ethics Meetup',
		contextName: 'London',
		occurredAt: new Date('2026-09-20').toISOString(),
		confidence: 0.9,
		...overrides,
	}
}

describe('formatEventTimeline', () => {
	test('empty list renders nothing', () => {
		expect(formatEventTimeline([])).toBe('')
	})

	test('renders actor, predicate, target, and context', () => {
		const result = formatEventTimeline([makeEvent()])
		expect(result).toContain('Recent activity:')
		expect(result).toContain('Emily organized AI Ethics Meetup')
		expect(result).toContain('(London)')
	})

	test('omits target when absent', () => {
		const result = formatEventTimeline([makeEvent({ targetName: undefined })])
		expect(result).toContain('Emily organized')
		expect(result).not.toContain('undefined')
	})

	test('omits context parenthetical when absent', () => {
		const result = formatEventTimeline([makeEvent({ contextName: undefined })])
		expect(result).not.toContain('(')
	})

	test('falls back to "Someone" when actor is unresolved', () => {
		const result = formatEventTimeline([makeEvent({ actorName: undefined })])
		expect(result).toContain('Someone organized')
	})

	test('renders one line per event, in the order given', () => {
		const result = formatEventTimeline([
			makeEvent({ id: 'e1', actorName: 'Emily' }),
			makeEvent({ id: 'e2', actorName: 'Bob' }),
		])
		const lines = result.split('\n').filter((l) => l.startsWith('-'))
		expect(lines).toHaveLength(2)
		expect(lines[0]).toContain('Emily')
		expect(lines[1]).toContain('Bob')
	})
})
