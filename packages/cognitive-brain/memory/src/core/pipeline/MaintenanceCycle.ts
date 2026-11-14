import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { IVaultProvider } from '../../interfaces/IVaultProvider'
import type { EventNode, MemoryEntry, SynthesisQuality } from '../../types'
import { InProcessGraph } from '../graph/InProcessGraph'
import { isProfileFact } from '../profile/ProfileClassifier'
import { SynthesisEngine } from '../synthesis/SynthesisEngine'
import { Pipeline } from './Pipeline'
import { enrichEntryWithEntities } from './processors/T0EntityExtractor'
import {
	PROTECTED_IMPORTANCE,
	applyDemotePolicy,
	evaluateRetentionPolicy,
	recomputeSalience,
} from './processors/T0SalienceProcessor'
import { T1SummarizationProcessor } from './processors/T1SummarizationProcessor'

/**
 * MaintenanceCycle - orchestrates the full 10-phase maintenance cycle.
 *
 * Phases:
 *   1. entity_extraction   - T0: enrich entries missing entity metadata
 *   2. salience_recompute  - T0: recompute salience scores for all active entries
 *   3. graph_rewire        - T0: record co-occurrences + infer typed edges for recent entries
 *   4. event_rollup        - T0: bound the event graph's hot window (designCognitiveBrain.md §16.8.2 point 5)
 *   5. semantic_promotion  - T1: score importance, promote L0→L1 for high-importance entries
 *   6. insight_synthesis   - T1: detect L1 clusters → promote to L2 insights
 *   7. synthesis_compile   - T1/T2: compile changed entries into vault artifacts
 *   8. upgrade_detection   - T2 (desktop): detect T1 artifacts ready for T2 upgrade
 *   9. retention_policies  - T0: run all 7 retention policies on active entries
 *   10. vault_sync         - MCP: push/pull vault artifacts
 */

export type MaintenancePhaseName =
	| 'entity_extraction'
	| 'salience_recompute'
	| 'graph_rewire'
	| 'event_rollup'
	| 'semantic_promotion'
	| 'insight_synthesis'
	| 'synthesis_compile'
	| 'upgrade_detection'
	| 'retention_policies'
	| 'vault_sync'

export interface MaintenanceCyclePhaseResult {
	name: MaintenancePhaseName
	durationMs: number
	processed: number
	skipped: boolean
	error?: string
}

export interface MaintenanceCycleResult {
	phases: MaintenanceCyclePhaseResult[]
	totalMs: number
	entriesProcessed: number
}

export interface MaintenanceCycleConfig {
	store: IMemoryStore
	index: IMemoryIndex
	graph: InProcessGraph
	pipeline: Pipeline
	synthesisEngine: SynthesisEngine
	vault?: IVaultProvider
	quality?: SynthesisQuality
	/** Event-graph hot window (§16.8.2 point 5). Default 90 days. */
	maxEventAgeMs?: number
	/** Event-graph recency-rank cap. Default 500, matching Tier 2's existing episodic cap (§3.3). */
	maxHotEvents?: number
}

const ALL_PHASES: MaintenancePhaseName[] = [
	'entity_extraction',
	'salience_recompute',
	'graph_rewire',
	'event_rollup',
	'semantic_promotion',
	'insight_synthesis',
	'synthesis_compile',
	'upgrade_detection',
	'retention_policies',
	'vault_sync',
]

const DEFAULT_MAX_EVENT_AGE_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_HOT_EVENTS = 500

export class MaintenanceCycle {
	private readonly store: IMemoryStore
	private readonly index: IMemoryIndex
	private readonly graph: InProcessGraph
	private readonly pipeline: Pipeline
	private readonly synthesisEngine: SynthesisEngine
	private readonly vault: IVaultProvider | undefined
	private readonly quality: SynthesisQuality
	private readonly maxEventAgeMs: number
	private readonly maxHotEvents: number

	constructor(config: MaintenanceCycleConfig) {
		this.store = config.store
		this.index = config.index
		this.graph = config.graph
		this.pipeline = config.pipeline
		this.synthesisEngine = config.synthesisEngine
		this.vault = config.vault
		this.quality = config.quality ?? 'T1'
		this.maxEventAgeMs = config.maxEventAgeMs ?? DEFAULT_MAX_EVENT_AGE_MS
		this.maxHotEvents = config.maxHotEvents ?? DEFAULT_MAX_HOT_EVENTS
	}

	/**
	 * Run all 9 phases in order. Time-boxed - skips phases if budgetMs is exceeded.
	 * Default budget: 60 seconds.
	 */
	async run(budgetMs = 60_000): Promise<MaintenanceCycleResult> {
		return this.runPhases(ALL_PHASES, budgetMs)
	}

	/**
	 * Run only the specified phases (in the order provided).
	 */
	async runPhases(
		phases: MaintenancePhaseName[],
		budgetMs = 60_000
	): Promise<MaintenanceCycleResult> {
		const cycleStart = Date.now()
		const phaseResults: MaintenanceCyclePhaseResult[] = []
		let totalProcessed = 0

		for (const phaseName of phases) {
			const elapsed = Date.now() - cycleStart
			if (elapsed >= budgetMs) {
				phaseResults.push({
					name: phaseName,
					durationMs: 0,
					processed: 0,
					skipped: true,
					error: `Budget exhausted (${elapsed}ms >= ${budgetMs}ms)`,
				})
				continue
			}

			const remaining = budgetMs - elapsed
			const phaseResult = await this.runPhase(phaseName, remaining)
			phaseResults.push(phaseResult)
			totalProcessed += phaseResult.processed
		}

		return {
			phases: phaseResults,
			totalMs: Date.now() - cycleStart,
			entriesProcessed: totalProcessed,
		}
	}

	// ── Phase dispatch ─────────────────────────────────────────────────────────

	private async runPhase(
		name: MaintenancePhaseName,
		budgetMs: number
	): Promise<MaintenanceCyclePhaseResult> {
		const start = Date.now()
		try {
			const processed = await this.executePhase(name, budgetMs)
			return { name, durationMs: Date.now() - start, processed, skipped: false }
		} catch (err) {
			return {
				name,
				durationMs: Date.now() - start,
				processed: 0,
				skipped: false,
				error: String(err),
			}
		}
	}

	private async executePhase(name: MaintenancePhaseName, budgetMs: number): Promise<number> {
		switch (name) {
			case 'entity_extraction':
				return this.phaseEntityExtraction(budgetMs)
			case 'salience_recompute':
				return this.phaseSalienceRecompute(budgetMs)
			case 'graph_rewire':
				return this.phaseGraphRewire(budgetMs)
			case 'event_rollup':
				return this.phaseEventRollup(budgetMs)
			case 'semantic_promotion':
				return this.phaseSemanticPromotion(budgetMs)
			case 'insight_synthesis':
				return this.phaseInsightSynthesis(budgetMs)
			case 'synthesis_compile':
				return this.phaseSynthesisCompile(budgetMs)
			case 'upgrade_detection':
				return this.phaseUpgradeDetection(budgetMs)
			case 'retention_policies':
				return this.phaseRetentionPolicies(budgetMs)
			case 'vault_sync':
				return this.phaseVaultSync(budgetMs)
			default: {
				const _exhaustive: never = name
				return 0
			}
		}
	}

	// ── Phase 1: Entity Extraction ─────────────────────────────────────────────

	private async phaseEntityExtraction(budgetMs: number): Promise<number> {
		const start = Date.now()
		// Fetch entries that haven't been enriched (no entities array)
		const { entries } = await this.store.query({ lifecycleState: 'active' })
		const toEnrich = entries.filter((e) => !e.entities || e.entities.length === 0)

		let processed = 0
		for (const entry of toEnrich) {
			if (Date.now() - start >= budgetMs) break
			enrichEntryWithEntities(entry)
			entry.updatedAt = new Date().toISOString()
			await this.store.put(entry)
			processed++
		}
		return processed
	}

	// ── Phase 2: Salience Recompute ────────────────────────────────────────────

	private async phaseSalienceRecompute(budgetMs: number): Promise<number> {
		const start = Date.now()
		const { entries } = await this.store.query({ lifecycleState: 'active' })

		let processed = 0
		const updated: MemoryEntry[] = []
		for (const entry of entries) {
			if (Date.now() - start >= budgetMs) break
			recomputeSalience(entry)
			entry.updatedAt = new Date().toISOString()
			updated.push(entry)
			processed++
		}

		if (updated.length > 0) {
			await this.store.putMany(updated)
		}
		return processed
	}

	// ── Phase 3: Graph Rewire ──────────────────────────────────────────────────

	private async phaseGraphRewire(budgetMs: number): Promise<number> {
		const start = Date.now()
		// Find recently modified entries (last 24 hours)
		const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
		const { entries } = await this.store.query({ lifecycleState: 'active' })

		const recent = entries.filter(
			(e) => (e.updatedAt ?? e.createdAt) >= cutoff && e.entities && e.entities.length > 0
		)

		let processed = 0
		for (const entry of recent) {
			if (Date.now() - start >= budgetMs) break
			const entityIds = (entry.entities ?? []).map((name: string) =>
				name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '')
			)
			this.graph.recordCoOccurrences(entry.id, entityIds)
			processed++
		}

		// After recording all co-occurrences, infer typed edges in bulk
		if (processed > 0 && Date.now() - start < budgetMs) {
			this.graph.inferTypedEdges()
		}

		return processed
	}

	// ── Phase 4: Event Rollup ──────────────────────────────────────────────────

	/**
	 * Bounds the hot event graph (designCognitiveBrain.md §16.8.2 point 5).
	 * pruneStaleEvents() itself is a synchronous in-memory op (no LLM, no I/O)
	 * that deletes the rolled-off events from the graph as a side effect -
	 * archiveEvents() is therefore called unconditionally, not gated on
	 * budgetMs: by the time pruneStaleEvents() returns, those events already
	 * exist nowhere else, so skipping the archival write here would silently
	 * lose them, not just defer them to the next cycle. budgetMs still bounds
	 * this phase's caller-visible cost accounting (returned below) but never
	 * suppresses the write that makes the deletion safe.
	 */
	private async phaseEventRollup(_budgetMs: number): Promise<number> {
		const { archived, summaries } = this.graph.pruneStaleEvents(
			Date.now(),
			this.maxEventAgeMs,
			this.maxHotEvents
		)
		if (archived.length === 0) return 0

		await this.archiveEvents(archived, summaries)
		return archived.length
	}

	/**
	 * Persists rolled-off raw events before they're gone from the hot graph -
	 * the append-only/audit property pruneStaleEvents() promises only holds if
	 * something durable actually receives them. Local store write is
	 * unconditional (§5.1's corrected principle: local persistence is not
	 * gated on a vault); the vault push is additive, same pattern as
	 * SynthesisEngine.renderAndPersist().
	 */
	private async archiveEvents(archived: EventNode[], summaries: EventNode[]): Promise<void> {
		const now = new Date().toISOString()
		const id = `event-archive-${Date.now()}`
		const content = renderEventArchive(archived, summaries)

		const entry: MemoryEntry = {
			id,
			type: 'artifact',
			title: `Event archive (${archived.length} events → ${summaries.length} summaries, ${now})`,
			content,
			createdAt: now,
			lifecycleState: 'active',
			tags: ['event-archive'],
			metadata: {
				eventArchive: true,
				eventCount: archived.length,
				summaryCount: summaries.length,
				summaryEventIds: summaries.map((s) => s.id),
			},
		}

		await this.store.put(entry)

		if (this.vault) {
			try {
				await this.vault.updatePage(id, content, {
					title: entry.title!,
					type: 'event-archive',
					timestamp: now,
					tags: ['event-archive'],
				})
			} catch (err) {
				// Vault push failure is non-fatal - the local write above already
				// preserved the audit trail; only cross-device visibility is lost.
				console.warn('[MaintenanceCycle] event archive vault push failed:', err)
			}
		}
	}

	// ── Phase 5: Semantic Promotion ─────────────────────────────────────────────

	private async phaseSemanticPromotion(budgetMs: number): Promise<number> {
		const start = Date.now()
		// Only episodic entries that haven't been promoted yet (no semantic child)
		const { entries } = await this.store.query({ type: 'episodic', lifecycleState: 'active' })

		// Build a set of source IDs that already have semantic children
		const { entries: semanticsForPromotion } = await this.store.query({
			type: 'semantic',
			lifecycleState: 'active',
		})
		const promotedSourceIds = new Set(semanticsForPromotion.flatMap((s) => s.sourceIds ?? []))

		const t1 = new T1SummarizationProcessor(extractLLMConfig(this.quality))

		let processed = 0
		for (const entry of entries) {
			if (Date.now() - start >= budgetMs) break
			if (promotedSourceIds.has(entry.id)) continue

			try {
				// An entry the profile classifier accepted is important whatever the scorer says (the offline scorer gives nearly
				// everything a 2): it keeps its detail (retention leaves it whole) and is promoted to the next layer below.
				const scored = await t1.scoreImportance(entry)
				const importance = isProfileFact(entry) ? Math.max(scored, PROTECTED_IMPORTANCE) : scored
				entry.importance = importance
				entry.updatedAt = new Date().toISOString()

				if (importance >= 3) {
					// Promote to semantic
					const result = await t1.summarize(entry)
					const semanticEntry: MemoryEntry = {
						id: `${entry.id}-sem`,
						type: 'semantic',
						content: result.summary,
						title: result.title,
						createdAt: new Date().toISOString(),
						importance: result.importance,
						tags: result.tags,
						sourceIds: [entry.id],
						entities: entry.entities,
						sessionId: entry.sessionId,
						userId: entry.userId,
						lifecycleState: 'active',
						salience: entry.salience,
					}
					recomputeSalience(semanticEntry)
					await this.store.put(semanticEntry)
					await this.index.index(semanticEntry)
				}

				await this.store.put(entry)
				processed++
			} catch {
				// Non-fatal: continue with next entry
			}
		}
		return processed
	}

	// ── Phase 6: Insight Synthesis ─────────────────────────────────────────────

	private async phaseInsightSynthesis(budgetMs: number): Promise<number> {
		const start = Date.now()
		const { entries: semantics } = await this.store.query({
			type: 'semantic',
			lifecycleState: 'active',
		})

		// Group semantic entries by entity overlap using a greedy clustering approach
		const t1 = new T1SummarizationProcessor(extractLLMConfig(this.quality))
		let processed = 0

		for (let i = 0; i < semantics.length; i++) {
			if (Date.now() - start >= budgetMs) break
			const anchor = semantics[i]!
			if (!anchor.entities || anchor.entities.length < 2) continue

			const entitySet = new Set(anchor.entities)

			// Find entries with ≥ 2 overlapping entities
			const related = semantics.filter((e, idx) => {
				if (idx === i) return false
				if (!e.entities) return false
				const overlap = e.entities.filter((ent) => entitySet.has(ent)).length
				return overlap >= 2
			})

			if (related.length < 2) continue

			// Check if insight already exists
			const clusterKey = [...anchor.entities].sort().slice(0, 3).join(':')
			const insightId = `insight-${clusterKey}`
			const existing = await this.store.get(insightId)
			if (existing) {
				// Update existing insight
				if (!existing.sourceIds?.includes(anchor.id)) {
					existing.sourceIds = [...(existing.sourceIds ?? []), anchor.id]
					existing.updatedAt = new Date().toISOString()
					recomputeSalience(existing)
					await this.store.put(existing)
					await this.index.index(existing)
					processed++
				}
				continue
			}

			// Create new L2 insight
			const sourceEntries = [anchor, ...related.slice(0, 4)]
			const combinedContent = sourceEntries.map((e) => e.content.slice(0, 200)).join('\n\n---\n\n')

			let insightContent: string
			let insightTitle: string
			try {
				const result = await t1.summarize({
					...anchor,
					content: `Synthesize an insight from these ${sourceEntries.length} related observations:\n\n${combinedContent}`,
					title: `Insight synthesis for: ${[...entitySet].slice(0, 3).join(', ')}`,
				})
				insightContent = result.summary
				insightTitle = result.title ?? `Insight: ${[...entitySet].slice(0, 2).join(' + ')}`
			} catch {
				insightContent = `Pattern observed across ${sourceEntries.length} related events: ${combinedContent.slice(0, 400)}`
				insightTitle = `Insight: ${[...entitySet].slice(0, 2).join(' + ')}`
			}

			const insightEntry: MemoryEntry = {
				id: insightId,
				type: 'insight',
				content: insightContent,
				title: insightTitle,
				createdAt: new Date().toISOString(),
				importance: 4,
				sourceIds: sourceEntries.map((e) => e.id),
				entities: [...entitySet],
				tags: anchor.tags,
				lifecycleState: 'active',
			}

			recomputeSalience(insightEntry)
			await this.store.put(insightEntry)
			await this.index.index(insightEntry)
			processed++
		}

		return processed
	}

	// ── Phase 7: Synthesis Compile ─────────────────────────────────────────────

	private async phaseSynthesisCompile(budgetMs: number): Promise<number> {
		const start = Date.now()
		if (!this.vault) return 0

		// Gather all active entries that have meaningful content
		const { entries } = await this.store.query({ lifecycleState: 'active' })
		const candidates = entries.filter(
			(e) => e.type === 'semantic' || e.type === 'insight' || e.type === 'procedure'
		)

		if (candidates.length === 0) return 0
		if (Date.now() - start >= budgetMs) return 0

		const count = await this.synthesisEngine.compile(candidates)
		return count
	}

	// ── Phase 8: Upgrade Detection ─────────────────────────────────────────────

	private async phaseUpgradeDetection(budgetMs: number): Promise<number> {
		const start = Date.now()
		if (this.quality !== 'T2') return 0

		const { entries } = await this.store.query({ lifecycleState: 'active' })
		if (Date.now() - start >= budgetMs) return 0

		const candidates = await this.synthesisEngine.detectT1UpgradeCandidates(entries)
		if (candidates.length === 0 || Date.now() - start >= budgetMs) return 0

		const upgraded = await this.synthesisEngine.upgradeT1Artifacts(candidates, entries)
		return upgraded
	}

	// ── Phase 9: Retention Policies ────────────────────────────────────────────

	private async phaseRetentionPolicies(budgetMs: number): Promise<number> {
		const start = Date.now()
		const { entries } = await this.store.query({ lifecycleState: 'active' })

		let processed = 0
		const toUpdate: MemoryEntry[] = []
		const toDelete: string[] = []

		for (const entry of entries) {
			if (Date.now() - start >= budgetMs) break

			const policy = evaluateRetentionPolicy(entry)
			if (!policy) continue

			switch (policy) {
				case 'tombstone_episode':
					entry.lifecycleState = 'deleted'
					entry.updatedAt = new Date().toISOString()
					toDelete.push(entry.id)
					break

				case 'compact_raw':
					entry.compressionLevel = 1
					entry.content = entry.content.slice(0, Math.floor(entry.content.length * 0.5)) + '…'
					entry.lifecycleState = 'compressed'
					entry.updatedAt = new Date().toISOString()
					toUpdate.push(entry)
					break

				case 'requantize_embeddings':
					// Mark for re-indexing with lower precision
					entry.metadata = { ...(entry.metadata ?? {}), embeddingDtype: 'uint8' }
					entry.updatedAt = new Date().toISOString()
					toUpdate.push(entry)
					break

				case 'deprecate_procedure':
					entry.lifecycleState = 'deprecated'
					entry.updatedAt = new Date().toISOString()
					toUpdate.push(entry)
					break

				case 'reverify_fact':
					// Tag for re-verification - mark confidence as pending
					entry.metadata = { ...(entry.metadata ?? {}), pendingVerification: true }
					entry.updatedAt = new Date().toISOString()
					toUpdate.push(entry)
					break

				case 'prune_edges':
					// Handled at graph level, not per-entry
					this.graph.removeWeakEdges(0.1)
					break

				case 'demote_episode':
					applyDemotePolicy(entry)
					toUpdate.push(entry)
					break
			}
			processed++
		}

		if (toUpdate.length > 0) {
			await this.store.putMany(toUpdate)
		}
		for (const id of toDelete) {
			await this.store.delete(id, false) // soft-delete
		}

		return processed
	}

	// ── Phase 10: Vault Sync ───────────────────────────────────────────────────

	private async phaseVaultSync(_budgetMs: number): Promise<number> {
		if (!this.vault) return 0

		try {
			const result = await this.vault.compileWiki()
			return result.pagesCompiled
		} catch (err) {
			// Vault sync failure is non-fatal - log and continue
			console.warn('[MaintenanceCycle] vault_sync failed:', err)
			return 0
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractLLMConfig(quality: SynthesisQuality): import('../../types').TieredLLMConfig {
	// When quality is T2, prefer t2 config - but T1SummarizationProcessor only uses t1
	return {}
}

/** Markdown audit record for a batch of rolled-off events - readable by a human, not just re-ingestible. */
function renderEventArchive(archived: EventNode[], summaries: EventNode[]): string {
	const lines: string[] = [
		`# Event Archive`,
		``,
		`${archived.length} raw events rolled up into ${summaries.length} summary node(s).`,
		``,
		`## Summaries`,
		``,
	]
	for (const s of summaries) {
		lines.push(
			`- **${s.id}** actor=${s.actorId ?? '—'} events=${s.summarizedEventIds?.length ?? 0} avgConfidence=${s.confidence.toFixed(2)}`
		)
	}
	lines.push('', '## Raw events', '')
	for (const e of archived) {
		lines.push(
			`- **${e.id}** \`${e.actorId ?? '?'} —${e.predicate}→ ${e.targetId ?? '?'}\`${e.contextId ? ` @ ${e.contextId}` : ''} (${e.occurredAt}, confidence=${e.confidence.toFixed(2)}, source=${e.sourceEntryId})`
		)
	}
	return lines.join('\n')
}
