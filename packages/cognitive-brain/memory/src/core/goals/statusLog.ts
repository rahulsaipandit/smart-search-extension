/**
 * statusLog - an append-only history of what happened to a goal and its steps, and the status derived from it.
 *
 * GuideAxon change (2026-10-09), modelled on OpenClaw: OpenClaw keeps no mutable "done" flag as the only truth; it
 * keeps a run history in which each entry says what happened, when, and who or what caused it (status, completion and
 * delivery are separate facts, docs/designOpenClawArchitecture.md, "Storage"). Here every status change of a goal or
 * a criterion is an event: `{ id, at, subject, type, from, to, by }`. The goal's `status` and each criterion's `status`
 * stay as a cached projection of the log (everything reads them), and `deriveGoalStatus` / `deriveCriterionStatus`
 * recompute them from the log, so the two can be checked against each other and a disagreement is a bug.
 *
 * GoalManager writes the events (diffEvents on every save), so no caller can change a status without leaving an entry.
 * The log is capped (oldest dropped) so a goal record stays small enough to sync.
 */
import type { Criterion, Goal, GoalStatus, StatusBy, StatusEvent } from './Goal'

export const MAX_STATUS_EVENTS = 200

let counter = 0
export function newEventId(): string {
	counter += 1
	return `e${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const ev = (
	now: number,
	subject: StatusEvent['subject'],
	type: StatusEvent['type'],
	by: StatusBy,
	fields: Partial<StatusEvent> = {}
): StatusEvent => ({
	id: newEventId(),
	at: new Date(now).toISOString(),
	subject,
	type,
	by,
	...fields,
})

/** What changed between two versions of a goal, as events. `before` null = the goal was just created. */
export function diffEvents(
	before: Goal | null,
	after: Goal,
	by: StatusBy,
	now: number,
	note?: string
): StatusEvent[] {
	const events: StatusEvent[] = []
	const clean = cleanNote(note)
	const withNote = clean ? { note: clean } : {}

	if (!before) {
		events.push(ev(now, { kind: 'goal' }, 'created', by, { to: after.status, ...withNote }))
	} else if (before.status !== after.status) {
		events.push(
			ev(now, { kind: 'goal' }, 'status', by, {
				from: before.status,
				to: after.status,
				...withNote,
			})
		)
	}

	const beforeCriteria = new Map<string, Criterion>(
		(before?.successCriteria ?? []).filter((c) => c && typeof c === 'object').map((c) => [c.id, c])
	)
	const afterCriteria = (after.successCriteria ?? []).filter((c) => c && typeof c === 'object')
	const afterIds = new Set(afterCriteria.map((c) => c.id))

	for (const c of afterCriteria) {
		const old = beforeCriteria.get(c.id)
		if (!old) {
			if (before)
				events.push(
					ev(now, { kind: 'criterion', id: c.id }, 'criterion_added', by, {
						to: c.status,
						text: c.text,
					})
				)
		} else if (old.status !== c.status) {
			events.push(
				ev(now, { kind: 'criterion', id: c.id }, 'status', by, {
					from: old.status,
					to: c.status,
					text: c.text,
					...withNote,
				})
			)
		}
	}
	for (const [id, old] of beforeCriteria) {
		if (!afterIds.has(id))
			events.push(
				ev(now, { kind: 'criterion', id }, 'criterion_removed', by, {
					from: old.status,
					text: old.text,
				})
			)
	}

	if (before && before.plan?.status !== 'locked' && after.plan?.status === 'locked') {
		events.push(ev(now, { kind: 'goal' }, 'plan_locked', by, withNote))
	}
	return events
}

/** A note is at most this long: it is stored in the goal record, which syncs, so it stays short. */
export const MAX_NOTE_CHARS = 80

/** Whitespace collapsed, cut to MAX_NOTE_CHARS. Undefined when nothing is left. */
export function cleanNote(note?: string): string | undefined {
	const t = (note ?? '').replace(/\s+/g, ' ').trim()
	if (!t) return undefined
	return t.length > MAX_NOTE_CHARS ? `${t.slice(0, MAX_NOTE_CHARS - 1)}…` : t
}

/**
 * The reason recorded for an accepted proposal: what stored is the proposal kind, where it came from, and at most 60
 * characters of the user's own message that triggered it (not the model's reply, not the goal text). Capped by cleanNote.
 */
export function proposalReason(
	kind?: string,
	source?: string,
	excerpt?: string
): string | undefined {
	const parts = [kind, source ? `via ${source}` : ''].filter(Boolean).join(' ')
	const quote = (excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
	return cleanNote(quote ? `${parts}: "${quote}"` : parts)
}

/** Id of the entry a device adds when a goal first arrives from sync: fixed per goal and device, so it can never be added twice. */
export const importedEventId = (goalId: string, deviceId: string) => `imp:${deviceId}:${goalId}`

/** The 'imported' entry for a goal that arrived from another device; null when this device already has one. */
export function importedEvent(
	goalId: string,
	deviceId: string,
	log: StatusEvent[] | undefined,
	now: number
): StatusEvent | null {
	const id = importedEventId(goalId, deviceId)
	if ((log ?? []).some((e) => e.id === id)) return null
	return {
		id,
		at: new Date(now).toISOString(),
		subject: { kind: 'goal' },
		type: 'imported',
		by: 'system',
		note: cleanNote(`from another device`),
	}
}

export function appendEvents(log: StatusEvent[] | undefined, events: StatusEvent[]): StatusEvent[] {
	const next = [...(log ?? []), ...events]
	return next.length > MAX_STATUS_EVENTS ? next.slice(next.length - MAX_STATUS_EVENTS) : next
}

/** The goal's status as the log says it: the `to` of its last status or created event. Undefined when the log has none. */
export function deriveGoalStatus(log: StatusEvent[] | undefined): GoalStatus | undefined {
	for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
		const e = log![i]
		if (e.subject.kind === 'goal' && (e.type === 'status' || e.type === 'created') && e.to)
			return e.to as GoalStatus
	}
	return undefined
}

/** A criterion's status as the log says it ('open' when it was added and never ticked); undefined when it never appears. */
export function deriveCriterionStatus(
	log: StatusEvent[] | undefined,
	criterionId: string
): Criterion['status'] | undefined {
	for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
		const e = log![i]
		if (e.subject.kind !== 'criterion' || e.subject.id !== criterionId) continue
		if (e.type === 'criterion_removed') return undefined
		if (e.type === 'status' || e.type === 'criterion_added') return e.to as Criterion['status']
	}
	return undefined
}

/** Who marked this criterion done, from the log: the `by` of its last move to 'done' (undefined if it is not done). */
export function doneBy(log: StatusEvent[] | undefined, criterionId: string): StatusBy | undefined {
	for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
		const e = log![i]
		if (e.subject.kind === 'criterion' && e.subject.id === criterionId && e.type === 'status')
			return e.to === 'done' ? e.by : undefined
	}
	return undefined
}

/** A goal's events, newest last, optionally for one criterion. */
export function eventsFor(goal: Pick<Goal, 'statusLog'>, criterionId?: string): StatusEvent[] {
	return (goal.statusLog ?? []).filter((e) =>
		criterionId ? e.subject.kind === 'criterion' && e.subject.id === criterionId : true
	)
}
