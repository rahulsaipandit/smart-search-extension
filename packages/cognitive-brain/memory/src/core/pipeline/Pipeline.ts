import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { BackgroundJob, JobType, MemoryEntry, TieredLLMConfig } from '../../types'
import type { IMemoryProcessor, ProcessorContext } from './IMemoryProcessor'
import { applyDurabilityClassification } from './processors/T0DurabilityClassifier'
import { enrichEntryWithEntities } from './processors/T0EntityExtractor'
import { recomputeSalience } from './processors/T0SalienceProcessor'
import { T1SummarizationProcessor } from './processors/T1SummarizationProcessor'

/**
 * Optional typed-decision refinement of episodic importance (docs/Misc/designJEVMisc.md fit #4). `refine` returns
 * 1-5, or null to keep the T1 score; `getBaseline` returns that T1 score (computed lazily, at most once), so a
 * refiner that answers confidently never pays for the T1 LLM call. Failures keep the T1 score.
 */
export interface ImportanceOptions {
	refine?: (entry: MemoryEntry, getBaseline: () => Promise<number>) => Promise<number | null>
}

/**
 * Async enrichment pipeline.
 *
 * All memory writes succeed immediately. The pipeline enriches them in the background:
 *   1. T0 entity extraction
 *   1b. T0 durability classification (isDurable/expiresAt - §16.1)
 *   2. T0 salience computation
 *   3. T1 summarization (if importance ≥ 3 → promote to L1 semantic)
 *   4. Index update (embedding + BM25)
 *   5. Pluggable processor chain (ContradictionResolutionProcessor - §16.2/§16.3 - and any registered via registerProcessor())
 *
 * Design principle (from GA): writes never block on pipeline completion.
 */

export type PipelineEventType =
	| 'job.started'
	| 'job.completed'
	| 'job.failed'
	| 'entry.enriched'
	| 'entry.promoted'
	| 'processor.completed'

export interface PipelineEvent {
	type: PipelineEventType
	entryId: string
	job?: BackgroundJob
	error?: Error
	processorName?: string
	/** On 'job.failed': a retry is scheduled, so this is not the final answer for the entry. */
	willRetry?: boolean
}

type PipelineListener = (event: PipelineEvent) => void

export class Pipeline {
	private readonly store: IMemoryStore
	private readonly index: IMemoryIndex
	private readonly t1: T1SummarizationProcessor
	private readonly listeners = new Set<PipelineListener>()

	// Pluggable processor chain (Phase 4.1 GA→CB migration)
	private processors: IMemoryProcessor[] = []
	private pipelineContext?: ProcessorContext

	// In-memory queue: mobile time-boxed, max 2 parallel
	private readonly queue: { entry: MemoryEntry; jobs: JobType[] }[] = []
	private running = 0
	private readonly maxParallel: number
	private readonly budgetMs: number
	private readonly importance: ImportanceOptions
	private readonly maxErrorRetries: number
	private readonly retryBaseMs: number

	constructor(
		store: IMemoryStore,
		index: IMemoryIndex,
		config: {
			llm?: TieredLLMConfig
			maxParallel?: number
			budgetMs?: number
			importance?: ImportanceOptions
			/** How many times a job that THREW is tried again (default 2). 0 turns retries off. */
			maxErrorRetries?: number
			/** Wait before the first retry, in ms; each later retry waits 4 times longer (default 2000). */
			retryBaseMs?: number
		} = {}
	) {
		this.store = store
		this.index = index
		this.t1 = new T1SummarizationProcessor(config.llm ?? {})
		this.maxParallel = config.maxParallel ?? 2
		this.budgetMs = config.budgetMs ?? 5_000
		this.importance = config.importance ?? {}
		this.maxErrorRetries = config.maxErrorRetries ?? 2
		this.retryBaseMs = config.retryBaseMs ?? 2_000
	}

	/**
	 * Importance 1-5 for an episodic entry: the refiner's answer when it has one, else the T1 score (an LLM call
	 * when one is configured, else the length heuristic). The T1 score is computed lazily and at most once.
	 */
	private async scoreImportance(entry: MemoryEntry): Promise<number> {
		let baseline: Promise<number> | null = null
		const getBaseline = () => (baseline ??= this.t1.scoreImportance(entry))
		if (this.importance.refine) {
			try {
				const refined = await this.importance.refine(entry, getBaseline)
				if (typeof refined === 'number' && refined >= 1 && refined <= 5) return Math.round(refined)
			} catch {
				// Fall through to the baseline.
			}
		}
		return getBaseline()
	}

	async initialize(): Promise<void> {
		await this.t1.initialize()
	}

	/** Set the runtime context passed to every registered processor. */
	setPipelineContext(ctx: ProcessorContext): void {
		this.pipelineContext = ctx
	}

	/** Register a pluggable processor that runs after the built-in enrichment steps. */
	registerProcessor(p: IMemoryProcessor): void {
		this.processors.push(p)
	}

	/** Enqueue an entry for background enrichment. Non-blocking. */
	enqueue(entry: MemoryEntry): void {
		this.queue.push({
			entry,
			jobs: ['extract_entities', 'compute_salience', 'extract_semantic'],
		})
		this.drain()
	}

	on(listener: PipelineListener): void {
		this.listeners.add(listener)
	}

	off(listener: PipelineListener): void {
		this.listeners.delete(listener)
	}

	// ── Internal ────────────────────────────────────────────────────────────────

	private drain(): void {
		while (this.running < this.maxParallel && this.queue.length > 0) {
			const item = this.queue.shift()!
			this.running++
			this.processEntry(item.entry).finally(() => {
				this.running--
				this.drain()
				this.notifyIfIdle()
			})
		}
	}

	private idleWaiters: (() => void)[] = []

	private notifyIfIdle(): void {
		if (this.running > 0 || this.queue.length > 0) return
		const waiters = this.idleWaiters
		this.idleWaiters = []
		for (const resolve of waiters) resolve()
	}

	/**
	 * Resolves when every entry queued so far has been processed (nothing queued, nothing running). For tests and for a
	 * caller that must read what enrichment writes. It does not wait for a retry that is scheduled for later (see the
	 * bounded retry in processEntry): that entry is not "queued" until its timer fires.
	 */
	whenIdle(): Promise<void> {
		if (this.running === 0 && this.queue.length === 0) return Promise.resolve()
		return new Promise((resolve) => this.idleWaiters.push(resolve))
	}

	/** Counts since this process started, for the gap 11 measurement (MemoryService logs them after each maintenance run). */
	readonly stats = {
		started: 0,
		completed: 0,
		failed: 0,
		failedFinal: 0,
		budgetSkipped: 0,
		dropped: 0,
	}

	/**
	 * Retry bookkeeping, keyed by entry id. Kept here and NOT on `entry.metadata`: metadata is persisted, so a counter
	 * stored there could leak into the stored entry whenever a processor saves it, and it would make the counters part of
	 * the entry's data instead of the pipeline's own state. Removed once the entry finishes without a pending retry.
	 */
	private readonly retryCounts = new Map<string, { error: number; budget: number }>()
	private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()
	private disposed = false

	/** Stop the pipeline for good: pending retry timers are cleared and the retry bookkeeping is dropped. */
	dispose(): void {
		this.disposed = true
		for (const timer of this.retryTimers) clearTimeout(timer)
		this.retryTimers.clear()
		this.retryCounts.clear()
		this.queue.length = 0
	}

	/**
	 * Try an entry again after `waitMs`, by id.
	 *
	 * Why by id and from the store (not by re-enqueueing the in-memory object): the failed attempt had already
	 * mutated that object (entities, durability, salience, importance). processEntry() snapshots `before` from the
	 * object it is given, so on a retry of the mutated object `before` already contained the failed attempt's results,
	 * the re-run changed nothing, mergeEnrichment() saw no diff and wrote nothing - the job reported `completed` while
	 * the enrichment was silently lost. Reloading gives the retry the persisted state as its baseline, so the
	 * enrichment is recomputed and diffed again. An entry deleted in the meantime is not revived.
	 */
	private scheduleRetry(id: string, waitMs: number): void {
		if (this.disposed) return
		const timer = setTimeout(() => {
			this.retryTimers.delete(timer)
			void this.reloadAndEnqueue(id)
		}, waitMs)
		;(timer as { unref?: () => void }).unref?.() // never keep a process alive for a retry
		this.retryTimers.add(timer)
	}

	private async reloadAndEnqueue(id: string): Promise<void> {
		if (this.disposed) return
		try {
			const fresh = await this.store.get(id)
			if (!fresh) {
				this.stats.dropped++
				this.retryCounts.delete(id)
				return
			}
			this.enqueue(fresh)
		} catch (error) {
			// The store itself is still failing: that is one more failed attempt, bounded by the same limit.
			this.handleFailure(id, error)
		}
	}

	private handleFailure(id: string, error: unknown): void {
		const counts = this.retryCounts.get(id) ?? { error: 0, budget: 0 }
		const willRetry = counts.error < this.maxErrorRetries && !this.disposed
		this.emit({ type: 'job.failed', entryId: id, error: error as Error, willRetry })
		this.stats.failed++
		if (willRetry) {
			this.retryCounts.set(id, { ...counts, error: counts.error + 1 })
			this.scheduleRetry(id, this.retryBaseMs * 4 ** counts.error)
		} else {
			this.stats.failedFinal++
			this.retryCounts.delete(id)
		}
	}

	private async processEntry(entry: MemoryEntry): Promise<void> {
		this.stats.started++
		const startedAt = Date.now()
		// What the entry looked like when this job started, so step 4 can write back only what enrichment changed.
		const before = JSON.parse(JSON.stringify(entry)) as MemoryEntry

		try {
			this.emit({ type: 'job.started', entryId: entry.id })

			// Step 1 - T0 entity extraction (sync, free)
			if (Date.now() - startedAt < this.budgetMs) {
				enrichEntryWithEntities(entry)
			}

			// Step 1b - T0 durability classification (sync, free; §16.1)
			if (Date.now() - startedAt < this.budgetMs) {
				applyDurabilityClassification(entry)
			}

			// Step 2 - T0 salience computation (sync, free)
			if (Date.now() - startedAt < this.budgetMs) {
				recomputeSalience(entry)
			}

			// Step 3 - T1 summarization (async, LLM)
			if (Date.now() - startedAt < this.budgetMs && entry.type === 'episodic') {
				const importance = await this.scoreImportance(entry)
				entry.importance = importance
				entry.updatedAt = new Date().toISOString()

				// Promote high-importance episodes to L1 semantic memory
				if (importance >= 3) {
					await this.promoteToSemantic(entry)
				}
			}

			// Step 4 - Update store + index. Merge onto the stored entry instead of overwriting it: the user or the app
			// may have updated it while enrichment ran (e.g. update() right after create(), or tagging the episode when a
			// goal closes), and a blind put of this job's copy silently lost those writes. A deleted entry is not revived.
			if (Date.now() - startedAt < this.budgetMs) {
				const latest = await this.store.get(entry.id)
				if (!latest) {
					// Deleted while enrichment ran: nothing to write, and nothing to retry.
					this.stats.dropped++
					this.retryCounts.delete(entry.id)
					return
				}
				const merged = mergeEnrichment(before, entry, latest)
				await this.store.put(merged)
				await this.index.index(merged)
				Object.assign(entry, merged) // processors below see the latest state too
			}

			// Step 5 - Pluggable processor chain (Phase 4.1). Unlike steps 1-4, this is a
			// loop over multiple registered processors (e.g. ContradictionResolutionProcessor,
			// which can itself make several sequential LLM calls) - budget is checked both
			// before entering the loop and between each processor, so a slow processor can't
			// silently consume the rest of the batch's time budget uncontested.
			//
			// A processor skipped this way is NOT just delayed - shouldProcess()/process()
			// never ran for it on this entry, and nothing else ever re-enqueues this entry
			// into the pipeline (update() doesn't; only create() does). Without the retry
			// below, a processor late in the chain (e.g. ProfileClassificationProcessor,
			// registered after ContradictionResolutionProcessor) could be permanently
			// skipped for an entry whenever an earlier processor ran long, silently and
			// with no error - e.g. a durable autonomy-calibration fact that should have
			// populated the Profile simply never would.
			let skippedByBudget = false
			if (this.processors.length > 0 && this.pipelineContext) {
				for (const p of this.processors) {
					if (Date.now() - startedAt >= this.budgetMs) {
						skippedByBudget = true
						break
					}
					if (await p.shouldProcess(entry)) {
						const result = await p.process(entry, this.pipelineContext!)
						if (result !== null) {
							// Single-entry result: merge fields back onto current entry
							if (!Array.isArray(result)) {
								Object.assign(entry, result)
							}
						}
						this.emit({ type: 'processor.completed', entryId: entry.id, processorName: p.name })
					}
				}
			}

			this.emit({ type: 'entry.enriched', entryId: entry.id })
			this.emit({ type: 'job.completed', entryId: entry.id })
			this.stats.completed++
			if (skippedByBudget) this.stats.budgetSkipped++

			// Bounded retry (once) rather than silently dropping the skipped processor(s) - steps 1-4 are idempotent, so
			// re-running the whole pass is safe, just slightly wasteful. Capped to avoid an entry that chronically exceeds
			// budget looping forever. Retried by id from the store (see scheduleRetry).
			const counts = this.retryCounts.get(entry.id) ?? { error: 0, budget: 0 }
			if (skippedByBudget && counts.budget < 1) {
				this.retryCounts.set(entry.id, { ...counts, budget: counts.budget + 1 })
				this.scheduleRetry(entry.id, 0)
			} else {
				this.retryCounts.delete(entry.id)
			}
		} catch (error) {
			// A job that threw (an LLM call that failed, a store write that raised) used to be dropped here for good. Steps 1-4 are
			// idempotent, so the whole pass is tried again, a bounded number of times with a growing wait (a model that is busy or
			// not loaded yet usually is not a moment later). The counts live in this.retryCounts (in memory: a kill loses both the
			// timer and the counts; the start-up maintenance recovers the first tiers, see gap 11) and are separate from the budget
			// retry above. designKnownGaps.md, section 10, gap 11.
			this.handleFailure(entry.id, error)
		}
	}

	private async promoteToSemantic(sourceEntry: MemoryEntry): Promise<void> {
		try {
			const result = await this.t1.summarize(sourceEntry)

			const semanticEntry: MemoryEntry = {
				id: `${sourceEntry.id}-sem`,
				type: 'semantic',
				content: result.summary,
				title: result.title,
				createdAt: new Date().toISOString(),
				importance: result.importance,
				tags: result.tags,
				sourceIds: [sourceEntry.id],
				entities: sourceEntry.entities,
				sessionId: sourceEntry.sessionId,
				userId: sourceEntry.userId,
				lifecycleState: 'active',
				salience: sourceEntry.salience,
				// Keep the chat turn of the one source entry (app proposals group by it). Insights below
				// merge several sources, so they get none.
				...(sourceEntry.metadata?.turnId
					? { metadata: { turnId: sourceEntry.metadata.turnId } }
					: {}),
			}

			recomputeSalience(semanticEntry)
			await this.store.put(semanticEntry)
			await this.index.index(semanticEntry)

			this.emit({ type: 'entry.promoted', entryId: sourceEntry.id })

			// Phase 4: L2 insight synthesis - check if enough related L1 semantics
			// exist to warrant promoting to a deep L2 insight
			await this.maybePromoteToInsight(semanticEntry)
		} catch {
			// Promotion failure is non-fatal - source entry still enriched
		}
	}

	/**
	 * Phase 4 - L2 insight synthesis (Smriti 3-pass graph building pattern).
	 *
	 * Trigger: when 3+ L1 semantic entries share at least 2 overlapping entities,
	 * synthesize them into a single L2 `insight` entry representing the deep pattern.
	 *
	 * L2 entries are NOT created for every promotion - only when a cluster forms.
	 * This mirrors how human insight emerges from accumulated related experiences.
	 */
	private async maybePromoteToInsight(semanticEntry: MemoryEntry): Promise<void> {
		if (!semanticEntry.entities || semanticEntry.entities.length < 2) return

		// Find other semantic entries with ≥ 2 overlapping entities
		const entitySet = new Set(semanticEntry.entities)
		const { entries: all } = await this.store.query({ type: 'semantic', lifecycleState: 'active' })

		const related = all.filter((e) => {
			if (e.id === semanticEntry.id) return false
			const overlap = (e.entities ?? []).filter((ent) => entitySet.has(ent)).length
			return overlap >= 2
		})

		// Threshold: 3 related L1 semantics required to form an L2 insight
		if (related.length < 2) return

		// Check if an L2 insight for this entity cluster already exists
		const clusterKey = [...semanticEntry.entities].sort().slice(0, 3).join(':')
		const insightId = `insight-${clusterKey}`
		const existing = await this.store.get(insightId)
		if (existing) {
			// Update existing insight: append this semantic to sourceIds
			if (!existing.sourceIds?.includes(semanticEntry.id)) {
				existing.sourceIds = [...(existing.sourceIds ?? []), semanticEntry.id]
				existing.updatedAt = new Date().toISOString()
				recomputeSalience(existing)
				await this.store.put(existing)
				await this.index.index(existing)
			}
			return
		}

		// Create new L2 insight entry
		const sourceEntries = [semanticEntry, ...related.slice(0, 4)]
		const combinedContent = sourceEntries.map((e) => e.content.slice(0, 200)).join('\n\n---\n\n')

		// T1 LLM insight synthesis - fallback to heuristic concatenation
		let insightContent: string
		let insightTitle: string
		try {
			const result = await this.t1.summarize({
				...semanticEntry,
				content: `Synthesize an insight from these ${sourceEntries.length} related observations:\n\n${combinedContent}`,
				title: `Insight synthesis for: ${[...entitySet].slice(0, 3).join(', ')}`,
			})
			insightContent = result.summary
			insightTitle = result.title ?? `Insight: ${[...entitySet].slice(0, 2).join(' + ')}`
		} catch {
			// T3 fallback: simple concatenation
			insightContent = `Pattern observed across ${sourceEntries.length} related events: ${combinedContent.slice(0, 400)}`
			insightTitle = `Insight: ${[...entitySet].slice(0, 2).join(' + ')}`
		}

		const insightEntry: MemoryEntry = {
			id: insightId,
			type: 'insight',
			content: insightContent,
			title: insightTitle,
			createdAt: new Date().toISOString(),
			importance: 4, // L2 insights are high importance by construction
			sourceIds: sourceEntries.map((e) => e.id),
			entities: [...entitySet],
			tags: semanticEntry.tags,
			lifecycleState: 'active',
		}

		recomputeSalience(insightEntry)
		await this.store.put(insightEntry)
		await this.index.index(insightEntry)

		this.emit({ type: 'entry.promoted', entryId: insightEntry.id })
	}

	private emit(event: PipelineEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch {
				// Event listener failures must not crash the pipeline
			}
		}
	}
}

/**
 * Apply to `latest` (the stored entry now) only the fields enrichment changed between `before` and `after`.
 * `metadata` is merged per key, so a key the app wrote meanwhile survives unless enrichment changed that same key.
 * Exported for tests.
 */
export function mergeEnrichment(
	before: MemoryEntry,
	after: MemoryEntry,
	latest: MemoryEntry
): MemoryEntry {
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
	const merged: MemoryEntry = { ...latest }
	let changed = false
	for (const key of Object.keys(after) as (keyof MemoryEntry)[]) {
		if (key === 'metadata' || key === 'updatedAt' || same(after[key], before[key])) continue
		;(merged as unknown as Record<string, unknown>)[key] = after[key]
		changed = true
	}
	const beforeMeta = before.metadata ?? {}
	const afterMeta = after.metadata ?? {}
	const metaChanges = Object.keys(afterMeta).filter((k) => !same(afterMeta[k], beforeMeta[k]))
	if (metaChanges.length > 0) {
		merged.metadata = { ...(latest.metadata ?? {}) }
		for (const k of metaChanges) merged.metadata[k] = afterMeta[k]
		changed = true
	}
	if (changed) merged.updatedAt = new Date().toISOString()
	return merged
}
