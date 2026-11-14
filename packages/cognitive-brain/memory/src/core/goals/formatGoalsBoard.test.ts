import { describe, expect, test } from 'vitest'

import type { Goal } from './Goal'
import { formatGoalsBoard } from './formatGoalsBoard'

function makeGoal(overrides: Partial<Goal> & { title: string }): Goal {
	return {
		id: 'g1',
		status: 'pending',
		priority: 3,
		createdAt: new Date(0).toISOString(),
		...overrides,
	}
}

describe('formatGoalsBoard', () => {
	test('returns empty string for no goals', () => {
		expect(formatGoalsBoard([])).toBe('')
	})

	test('renders a goal with title, category, and status', () => {
		const goal = makeGoal({
			title: 'Learn Spanish',
			category: 'personal-growth',
			status: 'in_progress',
		})
		expect(formatGoalsBoard([goal])).toBe(
			'Current goals:\n- Learn Spanish — category: personal-growth — status: in_progress'
		)
	})

	test('omits category when not set', () => {
		const goal = makeGoal({ title: 'Ship the release', status: 'pending' })
		expect(formatGoalsBoard([goal])).toBe('Current goals:\n- Ship the release — status: pending')
	})

	test('lists multiple goals, one per line', () => {
		const goals = [
			makeGoal({ id: 'g1', title: 'Learn Spanish', status: 'in_progress' }),
			makeGoal({ id: 'g2', title: 'Run a marathon', status: 'paused' }),
		]
		expect(formatGoalsBoard(goals)).toBe(
			'Current goals:\n' +
				'- Learn Spanish — status: in_progress\n' +
				'- Run a marathon — status: paused'
		)
	})
})
