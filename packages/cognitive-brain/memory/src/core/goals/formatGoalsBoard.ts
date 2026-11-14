import type { Goal } from './Goal'

/**
 * Render open goals (designCognitiveBrain.md §17.5) as a compact markdown
 * list suitable for direct prompt injection, per §17.6's assembly order
 * (section 3). Closed goals (status='completed') are never passed in here -
 * callers filter before formatting, same split as GoalManager.renderBoard().
 */
export function formatGoalsBoard(goals: Goal[]): string {
	if (goals.length === 0) return ''

	const lines = goals.map((g) => {
		const parts = [g.title]
		if (g.category) parts.push(`category: ${g.category}`)
		parts.push(`status: ${g.status}`)
		return `- ${parts.join(' — ')}`
	})

	return `Current goals:\n${lines.join('\n')}`
}

export default formatGoalsBoard
