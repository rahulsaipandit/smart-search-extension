/**
 * criteria - helpers for a goal's success criteria (GuideAxon change, 2026-10-09).
 *
 * A criterion is `{ id, text, status }`. Stored goals always hold that shape (GoalManager calls normalizeCriteria on
 * every write); readers that may meet raw input (a tool call, a synced file written by an older build) use
 * criterionTexts / normalizeCriteria, which accept plain strings too. Pure: no storage, no clock unless passed.
 */
import { toText } from '../../utils/toText'
import type { Criterion, Goal } from './Goal'

const MAX_TEXT = 200
const MAX_CRITERIA = 20

let counter = 0
/** An id that is unique within a goal and across devices (time + counter + random). */
export function newCriterionId(): string {
	counter += 1
	return `c${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const cleanText = (text: unknown): string =>
	toText(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)

export function makeCriterion(text: string): Criterion {
	return { id: newCriterionId(), text: cleanText(text), status: 'open' }
}

/**
 * Anything that looks like a list of criteria -> Criterion[]. A string becomes an open criterion; an object keeps its
 * id and status (an unknown status becomes 'open'); empty text, non-items and duplicates (same id, or same text) are
 * dropped; the list is capped.
 */
export function normalizeCriteria(value: unknown): Criterion[] {
	if (!Array.isArray(value)) return []
	const out: Criterion[] = []
	const ids = new Set<string>()
	const texts = new Set<string>()
	for (const item of value) {
		let criterion: Criterion | null = null
		if (typeof item === 'string') {
			const text = cleanText(item)
			if (text) criterion = { id: newCriterionId(), text, status: 'open' }
		} else if (item && typeof item === 'object') {
			const o = item as Partial<Criterion>
			const text = cleanText(o.text)
			if (text) {
				const done = o.status === 'done'
				criterion = {
					id: typeof o.id === 'string' && o.id ? o.id : newCriterionId(),
					text,
					status: done ? 'done' : 'open',
					...(done && typeof o.doneAt === 'string' ? { doneAt: o.doneAt } : {}),
				}
			}
		}
		if (!criterion) continue
		const key = criterion.text.toLowerCase()
		if (ids.has(criterion.id) || texts.has(key)) continue
		ids.add(criterion.id)
		texts.add(key)
		out.push(criterion)
		if (out.length >= MAX_CRITERIA) break
	}
	return out
}

/** The criteria's text, in order (what the router and the reconcile step compare a message with). */
export function criterionTexts(goal: Pick<Goal, 'successCriteria'> | null | undefined): string[] {
	return normalizeCriteria(goal?.successCriteria).map((c) => c.text)
}

export interface CriteriaProgress {
	done: number
	total: number
}

export function criteriaProgress(
	goal: Pick<Goal, 'successCriteria'> | null | undefined
): CriteriaProgress {
	const list = normalizeCriteria(goal?.successCriteria)
	return { done: list.filter((c) => c.status === 'done').length, total: list.length }
}
