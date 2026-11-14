import { describe, expect, it } from 'vitest'

import {
	GoalManager,
	criteriaProgress,
	criterionTexts,
	formatGoalsBoard,
	makeCriterion,
	newCriterionId,
	normalizeCriteria,
} from './index'
import type { Goal } from './index'

// Consumers (the mobile app's goal screens) import these from the package root, not from core/goals/*, so a
// rename or a dropped re-export has to fail here instead of in an app that is built elsewhere.
describe('goal exports on the package root', () => {
	it('exposes the helpers a consumer needs', () => {
		for (const fn of [
			GoalManager,
			criteriaProgress,
			criterionTexts,
			formatGoalsBoard,
			makeCriterion,
			newCriterionId,
			normalizeCriteria,
		]) {
			expect(fn).toBeTypeOf('function')
		}
	})

	it('normalizes criteria and reports progress through the root exports', () => {
		const goal = {
			successCriteria: [
				'Write the outline',
				'write the OUTLINE',
				'  ',
				{ text: 'Send it', status: 'done' },
			],
		} as unknown as Goal

		expect(criterionTexts(goal)).toEqual(['Write the outline', 'Send it'])
		expect(criteriaProgress(goal)).toEqual({ done: 1, total: 2 })
		expect(makeCriterion('  Plan   it ')).toMatchObject({ text: 'Plan it', status: 'open' })
	})

	it('renders the goals board without a GoalManager', () => {
		expect(formatGoalsBoard([])).toBe('')
		const board = formatGoalsBoard([
			{ title: 'Ship v1', status: 'in_progress' },
		] as unknown as Goal[])
		expect(board).toBe('Current goals:\n- Ship v1 — status: in_progress')
	})
})
