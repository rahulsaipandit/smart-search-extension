/**
 * Goal domain types for the Cognitive Brain memory platform.
 * Ported from GA's lib/memory/GoalManager.ts - priority is now numeric (1–5)
 * to align with MemoryEntry.importance, and category is optional.
 */

// ── Status / Outcome enums ────────────────────────────────────────────────────

export type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'paused'

export type GoalKind = 'goal' | 'task'

export type GoalOutcome = 'success' | 'failure'

export type CriterionStatus = 'open' | 'done'

/** One success criterion (a step of the plan). */
export interface Criterion {
	/** Stable within the goal; lets two devices tell an edit from a new item. */
	id: string
	text: string
	status: CriterionStatus
	/** ISO-8601, set when status becomes 'done'. */
	doneAt?: string
}

/** Who or what caused a status change (OpenClaw keeps the same fact for every history entry). */
export type StatusBy = 'user' | 'proposal' | 'system'

/**
 * One entry of a goal's history (statusLog.ts). The goal's own `status` and each criterion's `status` are a cached
 * projection of these; the log says who did it and when.
 */
export interface StatusEvent {
	id: string
	/** ISO-8601. */
	at: string
	subject: { kind: 'goal' } | { kind: 'criterion'; id: string }
	type: 'created' | 'status' | 'criterion_added' | 'criterion_removed' | 'plan_locked' | 'imported'
	from?: string
	to?: string
	by: StatusBy
	/** The criterion's text at the time (the criterion may be renamed or removed later). */
	text?: string
	note?: string
}

/** 'suggested' = computed for the user, editable, nothing committed. 'locked' = the user confirmed it. */
export interface GoalPlan {
	status: 'suggested' | 'locked'
	/** Length of the timeline in weeks; targetDate is start + weeks. */
	weeks?: number
	/** ISO-8601 day the timeline counts from. */
	startDate?: string
	/** ISO-8601, set by Lock plan. */
	lockedAt?: string
}

// ── Goal interface ────────────────────────────────────────────────────────────

export interface Goal {
	/** Stable identifier - matches the MemoryEntry.id that backs this goal. */
	id: string

	/** Short human-readable title. */
	title: string

	/** Optional longer description. */
	description?: string

	/** Workflow/lifecycle state. */
	status: GoalStatus

	/**
	 * Static importance score, 1 (lowest) – 5 (highest).
	 * Stored as MemoryEntry.importance so the pipeline can use it for salience.
	 */
	priority: number // 1–5

	/** Optional user-defined grouping tag (e.g. 'health', 'career'). */
	category?: string

	/**
	 * GuideAxon change (2026-10-09): criteria are objects with a status, not plain strings, so a step can be ticked.
	 * GoalManager normalizes on every write, so what is stored is always Criterion[]; goals/plan/criteria.ts has the helpers.
	 */
	successCriteria?: Criterion[]

	/** GuideAxon change: the plan around the criteria (suggested -> locked). Absent for a goal with no plan. */
	plan?: GoalPlan

	/** GuideAxon change: append-only history of status changes (statusLog.ts); GoalManager writes it on every save. */
	statusLog?: StatusEvent[]

	/** ISO-8601 target completion date. */
	targetDate?: string

	/** ISO-8601 creation timestamp. */
	createdAt: string

	/** ISO-8601 last-update timestamp. */
	updatedAt?: string

	/** Set when the goal is closed via closeGoal(). */
	outcome?: GoalOutcome

	/** ISO-8601 timestamp when the goal was closed. */
	closedAt?: string

	/** MemoryEntry ID of the episodic entry that triggered goal closure. */
	linkedEpisodeId?: string

	/** MemoryEntry ID of the procedure learned from this goal. */
	procedureId?: string

	/**
	 * GuideAxon change (2026-10-09, D26): 'goal' (default, an aspirational epic) or 'task' (small, transactional,
	 * belongs to one goal or to none). Tasks are goal-type entries with kind 'task' so they reuse the engine, the
	 * account scope and the sync; getGoals() leaves them out unless asked (GoalQuery.kind).
	 */
	kind?: GoalKind

	/** Tasks only: the goal this task belongs to. Absent for a standalone task. */
	parentGoalId?: string

	/** Tasks only: ISO-8601 due date, validated in code before it is stored. */
	dueDate?: string

	/**
	 * GuideAxon change (2026-10-13, Goals/designGoals.md section 8.1): ISO-8601 date-time after which the app may check in on
	 * this goal. Set by the app (locking the plan, a step done, a snooze), cleared when the goal closes or pauses or has no
	 * open step. Never changes the status.
	 */
	checkInAt?: string

	/** Arbitrary extra fields - preserved for forward-compat with GA consumers. */
	[key: string]: unknown
}

// ── Query helper ─────────────────────────────────────────────────────────────

export interface GoalQuery {
	limit?: number
	category?: string
	status?: GoalStatus | GoalStatus[]
	/** GuideAxon change: 'goal' (default) leaves tasks out, 'task' returns only tasks, 'all' both. */
	kind?: GoalKind | 'all'
}
