/**
 * GoalManager - CB port of GA's lib/memory/GoalManager.ts
 *
 * Goals are stored as MemoryEntry records with type='goal'.
 * All goal-specific fields live in entry.metadata.goal so the standard
 * cognitive pipeline (salience, entity extraction, etc.) can process them.
 *
 * Key differences from the GA version:
 *  - Persistence is delegated to IMemoryService instead of storage-suite.
 *  - priority is numeric 1–5 (MemoryEntry.importance) not 'high'|'medium'|'low'.
 *  - initialize() calls memory.initialize() rather than loading a flat JSON blob.
 */
import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry } from '../../types'
import type { Goal, GoalOutcome, GoalQuery, GoalStatus, StatusBy } from './Goal'
import { normalizeCriteria } from './criteria'
import { formatGoalsBoard } from './formatGoalsBoard'
import { appendEvents, diffEvents } from './statusLog'

/** Who caused a save, for the goal's history. Default 'user': a tap, the dashboard or a tool call. */
export interface SaveOptions {
	by?: StatusBy
	note?: string
}

const OPEN_GOAL_STATUSES: GoalStatus[] = ['pending', 'in_progress', 'paused']

// ── Internal helpers ─────────────────────────────────────────────────────────

function generateId(): string {
	return `goal-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/** Extract a Goal from a raw MemoryEntry. Returns null if the entry is not a goal. */
function entryToGoal(entry: MemoryEntry): Goal | null {
	const g = entry.metadata?.goal as Partial<Goal> | undefined
	if (!g) return null
	return {
		...g,
		id: entry.id,
		title: (g.title ?? entry.title)!,
		description: g.description ?? entry.content ?? undefined,
		status: (g.status ?? 'pending') as GoalStatus,
		priority: g.priority ?? entry.importance ?? 3,
		createdAt: g.createdAt ?? entry.createdAt,
		updatedAt: g.updatedAt ?? entry.updatedAt,
	} as Goal
}

type GoalClosedCallback = (goal: Goal) => void

// ── GoalManager class ────────────────────────────────────────────────────────

export class GoalManager {
	private _initialized = false
	private _lastPersistError: Error | null = null
	private goalClosedCallbacks: GoalClosedCallback[] = []

	private memory: IMemoryService
	constructor(memory: IMemoryService) {
		this.memory = memory
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this._initialized) return
		await this.memory.initialize()
		this._initialized = true
	}

	get initialized(): boolean {
		return this._initialized
	}

	get lastPersistError(): Error | null {
		return this._lastPersistError
	}

	get isPersistHealthy(): boolean {
		return this._lastPersistError === null
	}

	private requireInitialized(): void {
		if (!this._initialized) {
			throw new Error('[GoalManager] Not initialized - call initialize() first')
		}
	}

	// ── CRUD ───────────────────────────────────────────────────────────────────

	/**
	 * Create a new goal or upsert an existing one (when goal.id is provided).
	 * Mirrors GA's storeGoal() contract.
	 */
	async storeGoal(
		goal: Partial<Goal> & { title: string },
		options: SaveOptions = {}
	): Promise<Goal> {
		this.requireInitialized()

		const now = new Date().toISOString()
		const id = goal.id ?? generateId()

		// Check whether an entry with this ID already exists so we can merge.
		let existing: Goal | null = null
		try {
			const entry = await this.memory.get(id)
			if (entry) existing = entryToGoal(entry)
		} catch {
			// not found - treat as new
		}

		const merged: Goal = {
			category: undefined,
			priority: 3,
			status: 'pending' as GoalStatus,
			...existing,
			...goal,
			id,
			// GuideAxon change: criteria are always stored as objects with a status (plain strings are accepted on input).
			successCriteria: normalizeCriteria(goal.successCriteria ?? existing?.successCriteria),
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		}
		// GuideAxon change: the history is written here, never taken from the caller, so a status cannot change without an entry.
		merged.statusLog = appendEvents(
			existing?.statusLog,
			diffEvents(existing, merged, options.by ?? 'user', Date.parse(now), options.note)
		)

		try {
			if (existing) {
				// Update the backing MemoryEntry in-place.
				await this.memory.update(id, {
					title: merged.title,
					content: merged.description ?? '',
					importance: merged.priority,
					tags: ['goal', ...(merged.category ? [merged.category] : [])],
					metadata: { goal: merged },
					updatedAt: now,
				})
			} else {
				// create() always assigns its own ID (ignores any hint), so the
				// pre-generated `id` above is only a placeholder - overwrite merged.id
				// with the real backing entry ID once it's known, or later lookups
				// (getGoal, updateGoal, closeGoal) called with the returned Goal.id
				// would silently miss the entry.
				const createdId = await this.memory.create({
					type: 'goal',
					title: merged.title,
					content: merged.description ?? '',
					importance: merged.priority,
					tags: ['goal', ...(merged.category ? [merged.category] : [])],
					metadata: { goal: merged },
				})
				merged.id = createdId
			}
			this._lastPersistError = null
		} catch (err) {
			this._lastPersistError = err instanceof Error ? err : new Error(String(err))
			console.warn('[GoalManager] Persist failed:', this._lastPersistError.message)
			throw this._lastPersistError
		}

		return merged
	}

	/** createGoal is an alias for storeGoal to match the CB naming convention. */
	async createGoal(goal: Partial<Goal> & { title: string }): Promise<Goal> {
		return this.storeGoal(goal)
	}

	/** List goals, with optional filtering by category, status, and limit. */
	async getGoals(query: GoalQuery = {}): Promise<Goal[]> {
		this.requireInitialized()

		// GuideAxon change (2026-10-08): read EVERY goal entry, then filter, sort and limit here.
		// Before, this asked list() for a createdAt-ordered page: list() defaults to 50 items, applies that
		// BEFORE the status filter below, and on SQLite the store itself caps an unlimited query at the newest
		// 100. Closed goals stay in the store, so a user with more than 50 goal entries got the 50 OLDEST
		// entries (all closed) and the newest open goals were cut off: the prompt said "no open goals" and the
		// router saw none. A non-createdAt orderBy makes list() count the matching set and fetch all of it, so
		// ask for updatedAt order and restore createdAt order below.
		const page = await this.memory.list({
			filter: { type: ['goal'] },
			limit: Number.MAX_SAFE_INTEGER,
			orderBy: 'updatedAt',
			order: 'desc',
		})

		let goals: Goal[] = page.items
			// GuideAxon change: a deleted goal is soft-deleted (lifecycleState 'deleted') by the web and SQLite stores and
			// must not come back in a listing (found by the sync browser test: a goal deleted on the phone reappeared).
			.filter((entry) => entry.lifecycleState !== 'deleted')
			.map(entryToGoal)
			.filter((g): g is Goal => g !== null)
			// createdAt ascending (oldest first), as callers have always received it
			.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))

		// GuideAxon change (D26): tasks share the goal entry type; a goal query leaves them out unless asked.
		const wantKind = query.kind ?? 'goal'
		if (wantKind !== 'all') {
			goals = goals.filter((g) => (g.kind === 'task' ? 'task' : 'goal') === wantKind)
		}

		if (query.category) {
			goals = goals.filter((g) => g.category === query.category)
		}

		if (query.status) {
			const statusArr = Array.isArray(query.status) ? query.status : [query.status]
			goals = goals.filter((g) => statusArr.includes(g.status))
		}

		// Re-apply limit after in-memory filtering (the store limit is a hint only).
		if (query.limit && query.limit > 0) {
			goals = goals.slice(0, query.limit)
		}

		return goals
	}

	/**
	 * GuideAxon change (D26): create a task, alone or under a goal. A task under a goal that does not exist
	 * is refused. Tasks never reach getGoals() by default.
	 */
	async storeTask(task: Partial<Goal> & { title: string }): Promise<Goal> {
		this.requireInitialized()
		if (task.parentGoalId) {
			const parent = await this.getGoal(task.parentGoalId)
			if (!parent || parent.kind === 'task')
				throw new Error('[GoalManager] A task needs an existing goal as its parent')
		}
		return this.storeGoal({ ...task, kind: 'task' })
	}

	/** Tasks, optionally those of one goal (`parentGoalId: null` = standalone tasks only), oldest first. */
	async getTasks(
		options: { parentGoalId?: string | null; status?: GoalStatus | GoalStatus[] } = {}
	): Promise<Goal[]> {
		const tasks = await this.getGoals({ kind: 'task', status: options.status })
		if (options.parentGoalId === undefined) return tasks
		return tasks.filter((t) =>
			options.parentGoalId === null ? !t.parentGoalId : t.parentGoalId === options.parentGoalId
		)
	}

	/**
	 * GuideAxon change (D26): true when the goal has at least one task and every one is completed. The caller
	 * turns this into a goal-complete PROPOSAL; a goal is never closed by inference alone.
	 */
	async allTasksDone(goalId: string): Promise<boolean> {
		const tasks = await this.getTasks({ parentGoalId: goalId })
		return tasks.length > 0 && tasks.every((t) => t.status === 'completed')
	}

	/** Retrieve a single goal by its MemoryEntry ID. */
	async getGoal(id: string): Promise<Goal | null> {
		this.requireInitialized()
		const entry = await this.memory.get(id)
		if (!entry) return null
		return entryToGoal(entry)
	}

	/** Apply a partial update to an existing goal. */
	async updateGoal(
		id: string,
		updates: Partial<Goal>,
		options: SaveOptions = {}
	): Promise<Goal | null> {
		this.requireInitialized()

		const existing = await this.getGoal(id)
		if (!existing) return null

		const now = new Date().toISOString()
		const updated: Goal = { ...existing, ...updates, id, updatedAt: now }
		updated.successCriteria = normalizeCriteria(updated.successCriteria)
		updated.statusLog = appendEvents(
			existing.statusLog,
			diffEvents(existing, updated, options.by ?? 'user', Date.parse(now), options.note)
		)

		try {
			await this.memory.update(id, {
				title: updated.title,
				content: updated.description ?? '',
				importance: updated.priority,
				tags: ['goal', ...(updated.category ? [updated.category] : [])],
				metadata: { goal: updated },
				updatedAt: now,
			})
			this._lastPersistError = null
		} catch (err) {
			this._lastPersistError = err instanceof Error ? err : new Error(String(err))
			console.warn('[GoalManager] updateGoal persist failed:', this._lastPersistError.message)
			throw this._lastPersistError
		}

		return updated
	}

	/** Soft-delete a goal by its ID. */
	async deleteGoal(id: string): Promise<void> {
		this.requireInitialized()
		try {
			await this.memory.delete(id)
			this._lastPersistError = null
		} catch (err) {
			this._lastPersistError = err instanceof Error ? err : new Error(String(err))
			console.warn('[GoalManager] deleteGoal persist failed:', this._lastPersistError.message)
			throw this._lastPersistError
		}
	}

	/**
	 * Close a goal with an explicit outcome.
	 * Sets status='completed', records outcome and closedAt, then fires
	 * all registered onGoalClosed callbacks (errors in callbacks are swallowed).
	 */
	async closeGoal(
		id: string,
		outcome: GoalOutcome,
		linkedEpisodeId?: string,
		options: SaveOptions = {}
	): Promise<Goal | null> {
		this.requireInitialized()

		const now = new Date().toISOString()
		const closed = await this.updateGoal(
			id,
			{
				status: 'completed' as GoalStatus,
				outcome,
				closedAt: now,
				...(linkedEpisodeId ? { linkedEpisodeId } : {}),
			},
			options
		)

		if (!closed) return null

		// Fire callbacks - errors must not fail the close operation.
		for (const cb of this.goalClosedCallbacks) {
			try {
				cb(closed)
			} catch (e) {
				console.warn('[GoalManager] onGoalClosed callback error:', e)
			}
		}

		return closed
	}

	// ── Callback bus ───────────────────────────────────────────────────────────

	/**
	 * Register a listener that fires whenever a goal is closed via closeGoal().
	 * Returns a deregistration function (unsubscribe).
	 */
	onGoalClosed(callback: GoalClosedCallback): () => void {
		this.goalClosedCallbacks.push(callback)
		return () => {
			this.goalClosedCallbacks = this.goalClosedCallbacks.filter((cb) => cb !== callback)
		}
	}

	/** Remove a previously registered onGoalClosed callback. */
	offGoalClosed(callback: GoalClosedCallback): void {
		this.goalClosedCallbacks = this.goalClosedCallbacks.filter((cb) => cb !== callback)
	}

	/**
	 * Format open goals (pending/in_progress/paused - not completed) as a
	 * compact markdown list for direct system-prompt injection.
	 * designCognitiveBrain.md §17.5/§17.6 (assembly section 3).
	 */
	async renderBoard(): Promise<string> {
		const goals = await this.getGoals({ status: OPEN_GOAL_STATUSES })
		return formatGoalsBoard(goals)
	}

	// ── Convenience ────────────────────────────────────────────────────────────

	/**
	 * Synchronously return all goals from the last list() call.
	 * Not available in CB (no in-memory cache) - included for API parity with GA.
	 * Use getGoals() for a fresh read from the backing store.
	 *
	 * @deprecated Prefer await getGoals() - this method always returns [] in CB.
	 */
	getAllGoals(): Goal[] {
		console.warn(
			'[GoalManager] getAllGoals() is not supported in CB - use await getGoals() instead'
		)
		return []
	}
}

export default GoalManager
