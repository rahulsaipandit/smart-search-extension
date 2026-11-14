import { describe, expect, it } from 'vitest'

import type { Goal } from '../Goal'
import {
	MAX_NOTE_CHARS,
	MAX_STATUS_EVENTS,
	appendEvents,
	deriveCriterionStatus,
	deriveGoalStatus,
	diffEvents,
	doneBy,
	eventsFor,
	importedEvent,
	proposalReason,
} from '../statusLog'

const NOW = Date.parse('2026-10-09T18:00:00Z')
const goal = (over: Partial<Goal> = {}): Goal => ({
	id: 'g',
	title: 'T',
	status: 'pending',
	priority: 3,
	createdAt: '2026-10-09T10:00:00Z',
	...over,
})
const crit = (id: string, status: 'open' | 'done' = 'open') => ({ id, text: `step ${id}`, status })

describe('reasons and imported entries', () => {
	it('proposalReason keeps kind, source and a short excerpt, capped', () => {
		expect(proposalReason('blocked', 'chat', 'I am stuck on  the   budget')).toBe(
			'blocked via chat: "I am stuck on the budget"'
		)
		const long = proposalReason('completed', 'chat', 'x'.repeat(500))!
		expect(long.length).toBeLessThanOrEqual(MAX_NOTE_CHARS)
		expect(proposalReason('stalled')).toBe('stalled')
	})

	it('a note passed to diffEvents is capped', () => {
		const [e] = diffEvents(goal(), goal({ status: 'paused' }), 'proposal', NOW, 'y'.repeat(300))
		expect(e.note!.length).toBeLessThanOrEqual(MAX_NOTE_CHARS)
	})

	it('importedEvent is system-made, has a fixed id per goal and device, and is never added twice', () => {
		const first = importedEvent('g', 'dev', [], NOW)!
		expect(first).toMatchObject({ type: 'imported', by: 'system', id: 'imp:dev:g' })
		expect(importedEvent('g', 'dev', [first], NOW)).toBeNull()
		expect(importedEvent('g', 'other', [first], NOW)).not.toBeNull()
		// the cap still holds
		expect(
			appendEvents(
				Array.from({ length: MAX_STATUS_EVENTS }, (_, i) => ({ ...first, id: `x${i}` })),
				[first]
			)
		).toHaveLength(MAX_STATUS_EVENTS)
	})
})

describe('diffEvents', () => {
	it('a new goal gets one created event', () => {
		const events = diffEvents(null, goal(), 'user', NOW)
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			type: 'created',
			to: 'pending',
			by: 'user',
			subject: { kind: 'goal' },
			at: '2026-10-09T18:00:00.000Z',
		})
	})

	it('a status change says from, to and who', () => {
		const events = diffEvents(goal(), goal({ status: 'completed' }), 'proposal', NOW, 'undo')
		expect(events).toEqual([
			expect.objectContaining({
				type: 'status',
				from: 'pending',
				to: 'completed',
				by: 'proposal',
				note: 'undo',
			}),
		])
	})

	it('no change, no event', () => {
		expect(
			diffEvents(
				goal({ successCriteria: [crit('a')] }),
				goal({ successCriteria: [crit('a')] }),
				'user',
				NOW
			)
		).toEqual([])
	})

	it('ticking, adding and removing a criterion are separate events with its text', () => {
		const before = goal({ successCriteria: [crit('a'), crit('b')] })
		const after = goal({ successCriteria: [crit('a', 'done'), crit('c')] })
		const events = diffEvents(before, after, 'user', NOW)
		expect(events.map((e) => [e.type, (e.subject as any).id, e.from, e.to, e.text])).toEqual([
			['status', 'a', 'open', 'done', 'step a'],
			['criterion_added', 'c', undefined, 'open', 'step c'],
			['criterion_removed', 'b', 'open', undefined, 'step b'],
		])
	})

	it('locking the plan is an event', () => {
		const events = diffEvents(
			goal({ plan: { status: 'suggested' } }),
			goal({ plan: { status: 'locked' } }),
			'user',
			NOW
		)
		expect(events.map((e) => e.type)).toEqual(['plan_locked'])
	})
})

describe('the status derived from the log', () => {
	const build = () => {
		let g = goal()
		let log = appendEvents(undefined, diffEvents(null, g, 'user', NOW))
		const step = (next: Goal, by: 'user' | 'proposal' | 'system', at: number) => {
			log = appendEvents(log, diffEvents(g, next, by, at))
			g = next
		}
		step(goal({ successCriteria: [crit('a')] }), 'system', NOW + 1)
		step(goal({ status: 'in_progress', successCriteria: [crit('a')] }), 'user', NOW + 2)
		step(goal({ status: 'in_progress', successCriteria: [crit('a', 'done')] }), 'proposal', NOW + 3)
		return { g, log }
	}

	it('goal and criterion status match the log, and the log says who ticked the step', () => {
		const { g, log } = build()
		expect(deriveGoalStatus(log)).toBe(g.status)
		expect(deriveCriterionStatus(log, 'a')).toBe('done')
		expect(doneBy(log, 'a')).toBe('proposal')
		expect(eventsFor({ statusLog: log }, 'a').map((e) => e.by)).toEqual(['system', 'proposal'])
	})

	it('reopening a step clears doneBy; a removed step has no status', () => {
		const { g, log: initialLog } = build()
		let log = initialLog
		const reopened = goal({ status: 'in_progress', successCriteria: [crit('a')] })
		log = appendEvents(log, diffEvents(g, reopened, 'user', NOW + 4))
		expect(deriveCriterionStatus(log, 'a')).toBe('open')
		expect(doneBy(log, 'a')).toBeUndefined()
		log = appendEvents(log, diffEvents(reopened, goal({ status: 'in_progress' }), 'user', NOW + 5))
		expect(deriveCriterionStatus(log, 'a')).toBeUndefined()
	})

	it('the log is capped, dropping the oldest', () => {
		const many = Array.from(
			{ length: MAX_STATUS_EVENTS + 10 },
			(_, i) =>
				diffEvents(goal(), goal({ status: i % 2 ? 'paused' : 'in_progress' }), 'user', NOW + i)[0]
		)
		const log = appendEvents(undefined, many)
		expect(log).toHaveLength(MAX_STATUS_EVENTS)
		expect(log[log.length - 1]).toBe(many[many.length - 1])
	})
})
