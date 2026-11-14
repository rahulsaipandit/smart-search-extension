import type { IBrainEngine } from '../interfaces/IBrainEngine'
import type { IMemoryIndex } from '../interfaces/IMemoryIndex'
import type { IMemoryService } from '../interfaces/IMemoryService'
import type { IMemoryStore } from '../interfaces/IMemoryStore'
import type { IVaultProvider } from '../interfaces/IVaultProvider'
import type {
	ContextPack,
	EdgeType,
	Entity,
	EventSummary,
	LifecycleState,
	ListOptions,
	MemoryEntry,
	MemoryEvent,
	MemoryFilter,
	MemoryListPage,
	MemoryRelation,
	MemorySearchPage,
	Profile,
	ProfileHeader,
	ProfileSection,
	RetentionResult,
	SearchOptions,
	SynthesisQuality,
	ThinkResult,
	TieredLLMConfig,
} from '../types'
import { ContextBuilder } from './context/ContextBuilder'
import { InProcessGraph, slugify } from './graph/InProcessGraph'
import { gapMetric, gapMetricsEnabled, nowMs } from './metrics/gapMetrics'
import { MaintenanceCycle } from './pipeline/MaintenanceCycle'
import { type ImportanceOptions, Pipeline } from './pipeline/Pipeline'
import {
	type ContradictionOptions,
	ContradictionResolutionProcessor,
} from './pipeline/processors/ContradictionResolutionProcessor'
import { EventGraphProcessor } from './pipeline/processors/EventGraphProcessor'
import { ProfileClassificationProcessor } from './pipeline/processors/ProfileClassificationProcessor'
import {
	evaluateRetentionPolicy,
	recomputeSalience,
	shouldRequantize,
} from './pipeline/processors/T0SalienceProcessor'
import {
	ALL_PROFILE_HEADERS,
	PROFILE_CLASSIFIER_VERSION,
	PROFILE_PENDING_TAG,
	PROFILE_SHADOWED_TAG,
	applyProfileClassification,
	isProfileFact,
	profileTag,
	statementOf,
} from './profile/ProfileClassifier'
import { ProfileSynthesizer } from './profile/ProfileSynthesizer'
import { SynthesisEngine } from './synthesis/SynthesisEngine'
import { CompactionRecap } from './working/CompactionRecap'
import { WorkingMemoryManager } from './working/WorkingMemory'

/** Entries the model is asked about per run, and the most times it is asked about one entry. */
const PROFILE_MODEL_BATCH = 10
const MAX_PROFILE_MODEL_TRIES = 2
/** Entries re-checked by the pattern backfill per maintenance run (patterns only, so this is cheap). */
const PROFILE_BACKFILL_BATCH = 200

/**
 * MemoryService - the cognitive orchestration hub.
 *
 * Composes:
 *  - IMemoryStore (persistence)
 *  - IMemoryIndex (hybrid search)
 *  - Pipeline (async enrichment)
 *  - InProcessGraph (entity relationships)
 *  - SynthesisEngine (vault compilation)
 *  - WorkingMemory (session context)
 *
 * Agents interact ONLY with this service - never with the subsystems directly.
 */

type EventCallback = (payload: unknown) => void

export interface MemoryServiceConfig {
	store: IMemoryStore
	index: IMemoryIndex
	vault?: IVaultProvider
	llm?: TieredLLMConfig
	synthesisThreshold?: number // entries before auto-synthesize (default 10)
	sessionId?: string
	tokenBudget?: number
	/** Optional pre-constructed graph instance. If omitted, a new InProcessGraph is created. */
	graph?: InProcessGraph
	maintenance?: { budgetMs?: number; runOnStartup?: boolean; disabled?: boolean }
	/** Optional typed-decision refinement + proposal sink for ContradictionResolutionProcessor (designJEVMisc.md fit #1). */
	contradiction?: ContradictionOptions
	/** Optional typed-decision refinement of episodic importance, which decides promotion to semantic (fit #4). */
	importance?: ImportanceOptions
	/** Optional model tier of profile classification (the profileHeader decision gate): see ProfileOptions. */
	profile?: ProfileOptions
}

/**
 * The model tier of profile classification, as a port. A durable statement the pattern classifier could not place is tagged
 * pending; classifyPendingProfileFacts() asks `classify` about it, in the background and in small batches. The answer says whether
 * a model could be asked at all, so "no model" (try again later, nothing counted) is not mistaken for "could not decide" (a try).
 * Without this option there is no model tier and pending entries simply wait.
 */
export type ProfileClassifyResult =
	| { status: 'unavailable' }
	| { status: 'shadow' }
	| { status: 'unclear' }
	| { status: 'answered'; header: ProfileHeader | null }

export interface ProfileOptions {
	/** `statement` is what the USER said (never the assistant's reply), capped by the adapter. */
	classify: (statement: string) => Promise<ProfileClassifyResult>
}

/** Metadata key used to persist the graph snapshot in the store. */
const GRAPH_SNAPSHOT_ID = '__graph_snapshot__'

/** Fixed ID for the single local Profile artifact (designCognitiveBrain.md
 *  §17.2.5), same fixed-ID-via-direct-store-access pattern as the graph snapshot. */
const PROFILE_ARTIFACT_ID = '__profile__'

/** Fixed ID for the single local Memory One-Pager artifact (designCognitiveBrain.md §17.3.6). */
const ONE_PAGER_ARTIFACT_ID = '__onepager__'

/** TTL for the cached one-pager - see getOnePager()'s doc comment for why a TTL stands in for §17.3.6's scheduler. */
const ONE_PAGER_TTL_MS = 30 * 60 * 1000

// Lazy LLM type - only available after @page-agent/llms is loaded
type LLMInstance = import('@page-agent/llms').LLM

export class MemoryService implements IMemoryService, IBrainEngine {
	private readonly memStore: IMemoryStore
	private readonly index: IMemoryIndex
	private readonly pipeline: Pipeline
	private readonly graph: InProcessGraph
	private readonly synthesis: SynthesisEngine
	private readonly workingMemory: WorkingMemoryManager
	private readonly compactionRecap = new CompactionRecap()
	private readonly defaultSessionId: string
	private readonly listeners = new Map<MemoryEvent, Set<EventCallback>>()
	/** Serializes writes to the single fixed-ID Profile artifact. Pipeline runs
	 *  up to maxParallel entries concurrently, and persistProfileSection() is an
	 *  unsynchronized read-modify-write (read current sections[], splice one in,
	 *  write back) - without this, two concurrently-classified facts targeting
	 *  different headers can each read the same "existing" snapshot and the
	 *  second write silently clobbers the first's section update. Same fix
	 *  shape as ContradictionResolutionProcessor's per-id serialize(). */
	private profileWriteLock: Promise<unknown> = Promise.resolve()
	/** Cached Stage-1 scope set from the last getOnePager() regeneration - used by
	 *  markOnePagerStaleIfScoped() to check new writes without recomputing scope. */
	private onePagerScopeEntityIds: string[] = []
	private readonly synthesisThreshold: number
	private readonly llmConfig: TieredLLMConfig | undefined
	private thinkLLM: LLMInstance | null = null
	private entriesSinceLastSynthesis = 0
	private initialized = false
	private readonly options: MemoryServiceConfig

	constructor(config: MemoryServiceConfig) {
		this.options = config
		this.memStore = config.store
		this.index = config.index
		this.synthesisThreshold = config.synthesisThreshold ?? 10
		this.llmConfig = config.llm

		this.pipeline = new Pipeline(this.memStore, this.index, {
			llm: config.llm,
			importance: config.importance,
		})

		this.graph = config.graph ?? new InProcessGraph()

		this.synthesis = new SynthesisEngine({
			llm: config.llm,
			quality: 'T1',
			vault: config.vault,
			// Local persistence is unconditional (§5.1, corrected 2026-09-23) -
			// synthesis must work with no vault configured at all, not just
			// tolerate one being temporarily unreachable.
			store: this.memStore,
		})

		this.defaultSessionId = config.sessionId ?? `session-${Date.now()}`
		this.workingMemory = new WorkingMemoryManager({
			tokenBudget: config.tokenBudget,
		})

		// §17.4 - capture a one-line summary of anything evicted from working
		// memory before it's dropped, so getCompactionRecap() has something to
		// show instead of silent context loss.
		this.workingMemory.onEvict((entry) => this.compactionRecap.append(entry))

		// Wire pipeline events to service events
		this.pipeline.on((event) => {
			if (event.type === 'entry.enriched') {
				this.emit('processing.completed', event.entryId)
				// §17.3.6 early invalidation - any enriched write (including a
				// ContradictionResolutionProcessor-resolved fact) can affect the
				// one-pager's currency; check it against the cached scope set.
				this.memStore
					.get(event.entryId)
					.then((entry) => this.markOnePagerStaleIfScoped(entry))
					.catch(() => {})
			} else if (event.type === 'job.failed') {
				this.emit('processing.failed', {
					id: event.entryId,
					error: event.error?.message,
					willRetry: event.willRetry === true,
				})
			}
		})
	}

	// ── IMemoryService implementation ─────────────────────────────────────────

	async initialize(): Promise<void> {
		if (this.initialized) return
		await this.memStore.initialize()
		await this.index.initialize()
		await this.pipeline.initialize()
		await this.synthesis.initialize()

		// ── Graph hydration ────────────────────────────────────────────────────
		// Attempt fast-path: restore from a persisted snapshot written by close().
		const snapshot = await this.memStore.get(GRAPH_SNAPSHOT_ID)
		if (snapshot?.metadata?.graphSnapshot) {
			try {
				const data = snapshot.metadata.graphSnapshot as Parameters<InProcessGraph['deserialize']>[0]
				this.graph.deserialize(data)
			} catch {
				// Snapshot corrupt - fall through to full hydration
				await this.hydrateGraphFromStore()
			}
		} else {
			// No snapshot: walk all stored entries and wire each one into the graph.
			await this.hydrateGraphFromStore()
		}

		// Wire the pluggable processor chain (§16.2/§16.3/§17.2.5). registerProcessor()
		// existed as an extension point but had no caller before this - the
		// contradiction-resolution processor is the first to use it.
		// ProfileClassificationProcessor runs after ContradictionResolutionProcessor
		// so it classifies the settled fact, not one mid-resolution (§17.2.5).
		this.pipeline.setPipelineContext({
			memory: this,
			llmService: this.getProcessorLLMAdapter(),
			graph: this.graph,
		})
		this.pipeline.registerProcessor(
			new ContradictionResolutionProcessor(this.options.contradiction)
		)
		this.pipeline.registerProcessor(new ProfileClassificationProcessor())
		// Runs after the other two: needs the settled/classified entry the same
		// way ProfileClassificationProcessor does, and is pure enrichment (never
		// mutates the entry itself), so ordering relative to it doesn't matter -
		// placed last by convention (newest processor, §16.8).
		this.pipeline.registerProcessor(new EventGraphProcessor())

		this.initialized = true

		if (!this.options?.maintenance?.disabled && this.options?.maintenance?.runOnStartup !== false) {
			setTimeout(() => {
				this.runMaintenance(this.options?.maintenance?.budgetMs).catch(() => {})
			}, 0)
		}
	}

	/** Full graph hydration by scanning all active entries in the store. */
	private async hydrateGraphFromStore(): Promise<void> {
		const { entries } = await this.memStore.query({ lifecycleState: 'active' })
		for (const entry of entries) {
			// Wire the full entry (extracts entity refs and creates mentions edges)
			if (entry.type === 'episodic' || entry.type === 'semantic') {
				this.graph.wireEntry(entry)
			}
			// Upsert any explicitly stored entity IDs
			if (entry.entities && entry.entities.length > 0) {
				for (const entityName of entry.entities) {
					const entityId = slugify(entityName)
					if (!this.graph.getEntity(entityId)) {
						this.graph.upsertEntity({ id: entityId, name: entityName, type: 'concept' })
					}
				}
			}
			// Mirror stored relations into the graph
			if (entry.relations && entry.relations.length > 0) {
				for (const rel of entry.relations) {
					this.graph.createEdge(entry.id, rel.type, rel.targetId, rel.weight ?? 1.0)
				}
			}
		}
	}

	async close(): Promise<void> {
		// Stop the pipeline first: a retry timer still pending would otherwise fire after the stores are closed
		// (e.g. after an account switch) and reload/write against the wrong or a closed store.
		this.pipeline.dispose()
		// Persist a graph snapshot so the next initialize() can skip full hydration.
		try {
			const snapshotData = this.graph.serialize()
			const now = new Date().toISOString()
			const snapshotEntry: MemoryEntry = {
				id: GRAPH_SNAPSHOT_ID,
				type: 'artifact',
				content: 'Graph snapshot - internal use only',
				tags: ['graph-snapshot'],
				createdAt: now,
				updatedAt: now,
				lifecycleState: 'active',
				metadata: { graphSnapshot: snapshotData },
			}
			await this.memStore.put(snapshotEntry)
		} catch {
			// Non-fatal - graph will rebuild from store on next launch
		}
		await this.memStore.close()
		await this.index.close()
	}

	// ── IBrainEngine implementation ───────────────────────────────────────────

	/** IBrainEngine.store - alias for create(). Satisfies the IBrainEngine contract. */
	async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
		return this.create(entry)
	}

	/**
	 * IBrainEngine.think - search top-K entries then synthesize an answer with LLM.
	 * Falls back to returning the top search result content when LLM is unavailable.
	 */
	async think(query: string): Promise<ThinkResult> {
		// Search for relevant context
		const searchPage = await this.search(query, { topK: 5 })
		const topEntries = searchPage.items.slice(0, 5)

		if (topEntries.length === 0) {
			return {
				answer: `No relevant memories found for: "${query}"`,
				confidence: 0,
				sources: [],
				synthesisQuality: 'T1',
			}
		}

		const sources = topEntries.map((r) => r.entry.id)

		// Try LLM-based answer
		const llm = await this.getThinkLLM()
		if (llm) {
			const contextText = topEntries
				.map((r) => `[${r.entry.id}] ${r.entry.title ?? ''}: ${r.entry.content.slice(0, 400)}`)
				.join('\n\n')

			const prompt = `Answer the following question using ONLY the provided memory context. Be concise and accurate.\n\nQuestion: ${query}\n\nContext:\n${contextText}\n\nReturn JSON: { "answer": "...", "confidence": 0.0-1.0 }`

			try {
				const abort = new AbortController()
				const result = await llm.invoke(
					[{ role: 'user', content: prompt }],
					{
						think_answer: {
							description: 'Answer based on memory context',
							inputSchema: {
								parse: (v: unknown) => v as { answer: string; confidence: number },
							} as never,
							execute: async (args: { answer: string; confidence: number }) => args,
						},
					},
					abort.signal
				)
				const toolResult = result.toolResult as { answer: string; confidence: number } | null
				if (toolResult?.answer) {
					return {
						answer: toolResult.answer,
						confidence: toolResult.confidence ?? 0.7,
						sources,
						synthesisQuality: 'T1',
					}
				}
			} catch {
				// Fall through to T3 fallback
			}
		}

		// T3 fallback: return the best-scoring entry content directly
		const best = topEntries[0]!
		return {
			answer: best.entry.content.slice(0, 500),
			confidence: best.score * 0.7,
			sources,
			synthesisQuality: 'T1',
		}
	}

	/**
	 * IBrainEngine.synthesize - trigger the synthesis pipeline over given or all active entries.
	 */
	async synthesize(entries?: MemoryEntry[]): Promise<number> {
		if (entries && entries.length > 0) {
			const count = await this.synthesis.compile(entries)
			if (count > 0) this.emit('synthesis.completed', { count })
			return count
		}
		return this.consolidate()
	}

	/**
	 * IBrainEngine.getContextPack - assemble token-budgeted context from working memory +
	 * semantic search + graph neighbors, shaped by ContextBuilder's intent-based reranking.
	 *
	 * Assembly pipeline (Phase 3.2):
	 *   1. Working memory - session-local entries
	 *   2. Semantic search - top-20 index results for the prompt
	 *   3. Graph expansion - neighbors of the top-3 search results
	 *   4. Deduplicate by id
	 *   5. ContextBuilder.buildContextForQuery() - intent detection, subject boost,
	 *      salience sort, token-budget slice → final context string
	 *   6. Wrap the assembled string as a single VaultPage artifact in ContextPack
	 */
	async getContextPack(prompt: string, budgetTokens = 4096): Promise<ContextPack> {
		// ── Step 1: Working memory ──────────────────────────────────────────────
		const wm = await this.getWorkingMemory(this.defaultSessionId)

		// ── Step 2: Semantic search (broad recall, topK=20) ────────────────────
		const searchPage = await this.search(prompt, { topK: 20 })
		const searchEntries = searchPage.items.map((r) => r.entry)

		// ── Step 3: Graph expansion - neighbors of top-3 results ──────────────
		const graphNeighbors: MemoryEntry[] = []
		const topResults = searchPage.items.slice(0, 3)
		for (const r of topResults) {
			try {
				const neighbors = await this.getRelated(r.entry.id)
				graphNeighbors.push(...neighbors)
			} catch {
				// Graph expansion is best-effort - missing edges are not fatal
			}
		}

		// ── Step 4: Combine + deduplicate by id ────────────────────────────────
		const seen = new Set<string>()
		const candidates: MemoryEntry[] = []
		for (const entry of [...wm, ...searchEntries, ...graphNeighbors]) {
			if (!seen.has(entry.id)) {
				seen.add(entry.id)
				candidates.push(entry)
			}
		}

		// ── Step 5: Intent-aware reranking + token-budget assembly ─────────────
		const contextString = ContextBuilder.buildContextForQuery(candidates, prompt, budgetTokens)

		// ── Step 6: Wrap in ContextPack ────────────────────────────────────────
		const cb = new ContextBuilder()
		const totalTokens = cb.estimateTokens(contextString)

		const artifacts: ContextPack['artifacts'] =
			contextString.length > 0
				? [
						{
							slug: 'context/assembled',
							title: 'Assembled Memory Context',
							content: contextString,
							frontmatter: { title: 'Assembled Memory Context' },
							updatedAt: new Date().toISOString(),
						},
					]
				: []

		return { artifacts, totalTokens }
	}

	async create(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string> {
		const id = generateId()
		const now = new Date().toISOString()

		const full: MemoryEntry = {
			...entry,
			id,
			createdAt: now,
			lifecycleState: 'active',
		}

		// Immediate write - non-blocking enrichment follows
		await this.memStore.put(full)

		// Self-wire graph on episodic writes (T0, synchronous)
		if (full.type === 'episodic' || full.type === 'semantic') {
			this.graph.wireEntry(full)
		}

		// Upsert explicitly provided entity names into the graph
		if (full.entities && full.entities.length > 0) {
			for (const entityName of full.entities) {
				const entityId = slugify(entityName)
				if (!this.graph.getEntity(entityId)) {
					this.graph.upsertEntity({ id: entityId, name: entityName, type: 'concept' })
				}
			}
		}

		// Mirror stored relations into the graph
		if (full.relations && full.relations.length > 0) {
			for (const rel of full.relations) {
				this.graph.createEdge(full.id, rel.type, rel.targetId, rel.weight ?? 1.0)
			}
		}

		// Add to working memory if session-scoped
		const entrySession = full.sessionId ?? this.defaultSessionId
		if (full.type === 'working' || full.sessionId === this.defaultSessionId) {
			await this.workingMemory.add(full, entrySession)
		}

		// Enqueue async enrichment
		this.pipeline.enqueue(full)

		this.emit('entry.created', { id })
		this.emit('processing.started', { id })

		// Check synthesis threshold
		this.entriesSinceLastSynthesis++
		if (this.entriesSinceLastSynthesis >= this.synthesisThreshold) {
			this.entriesSinceLastSynthesis = 0
			// Fire-and-forget - does not block the create call
			this.consolidate().catch(() => {})
		}

		return id
	}

	/**
	 * GuideAxon change (2026-10-09, memory sync, docs/designMemorySync.md section 5.6 rule 4): writes an entry
	 * that CAME FROM ANOTHER DEVICE, with its own id, into the store and the index ONLY. It is not enriched (no
	 * summarising, no entity extraction, no consolidation event), because the other device already did that and an
	 * imported record must not make this device's consolidation rewrite it in turn. An existing entry with this id is
	 * updated in place and keeps what is local to this device (salience, retrieval count, source links, relations).
	 * The entry is marked `metadata.imported` by the caller so consolidation can tell it from the entries it made.
	 */
	async importEntry(entry: MemoryEntry): Promise<void> {
		const existing = await this.memStore.get(entry.id)
		const now = new Date().toISOString()
		const merged: MemoryEntry = {
			...(existing ?? {}),
			...entry,
			createdAt: entry.createdAt ?? existing?.createdAt ?? now,
			updatedAt: entry.updatedAt ?? now,
			lifecycleState: entry.lifecycleState ?? existing?.lifecycleState ?? 'active',
			metadata: { ...(existing?.metadata ?? {}), ...(entry.metadata ?? {}) },
			// Local to this device: never overwritten by an import.
			...(existing?.salience !== undefined ? { salience: existing.salience } : {}),
			...(existing?.retrievalCount !== undefined
				? { retrievalCount: existing.retrievalCount }
				: {}),
			...(existing?.sourceIds ? { sourceIds: existing.sourceIds } : {}),
			...(existing?.relations ? { relations: existing.relations } : {}),
		}
		await this.memStore.put(merged)
		await this.index.index(merged)
		this.emit(existing ? 'entry.updated' : 'entry.created', { id: merged.id })
	}

	async get(id: string): Promise<MemoryEntry | null> {
		const entry = await this.memStore.get(id)
		if (entry) {
			// Track retrieval for salience boost
			entry.retrievalCount = (entry.retrievalCount ?? 0) + 1
			await this.memStore.put(entry)
		}
		return entry
	}

	async update(id: string, patch: Partial<MemoryEntry>): Promise<void> {
		const existing = await this.memStore.get(id)
		if (!existing) throw new Error(`Memory entry not found: ${id}`)

		const updated: MemoryEntry = {
			...existing,
			...patch,
			id,
			updatedAt: new Date().toISOString(),
		}

		await this.memStore.put(updated)
		await this.index.index(updated)

		// Refresh graph edges for the updated entry
		if (updated.type === 'episodic' || updated.type === 'semantic') {
			this.graph.wireEntry(updated)
		}
		if (updated.entities && updated.entities.length > 0) {
			for (const entityName of updated.entities) {
				const entityId = slugify(entityName)
				if (!this.graph.getEntity(entityId)) {
					this.graph.upsertEntity({ id: entityId, name: entityName, type: 'concept' })
				}
			}
		}
		if (updated.relations && updated.relations.length > 0) {
			for (const rel of updated.relations) {
				this.graph.createEdge(updated.id, rel.type, rel.targetId, rel.weight ?? 1.0)
			}
		}

		this.emit('entry.updated', { id })
	}

	async delete(id: string): Promise<void> {
		await this.memStore.delete(id)
		await this.index.remove(id)

		// Remove all graph edges that involve this entry.
		// InProcessGraph has no removeEntry() - we iterate the edge list and prune.
		const connectedEdges = this.graph.getEdges(id)
		for (const edge of connectedEdges) {
			// Setting weight below pruning threshold and calling removeWeakEdges would be
			// indirect. Instead we directly mark them as dead-weight and rely on the next
			// retention cycle, OR we call removeWeakEdges with a high threshold to catch them.
			// The cleanest available API is to set the weight to 0 so they get pruned on next
			// runRetentionPolicies(). We achieve this by re-creating the edge at weight 0.
			this.graph.createEdge(edge.from, edge.type, edge.to, -edge.weight)
		}
		// Immediately sweep the just-zeroed edges so they don't linger in the graph.
		this.graph.removeWeakEdges(0.01)

		this.emit('entry.deleted', { id })
	}

	// Superseded-fact states that must not silently outrank their own replacement.
	// See docs/Memory/designMemory.md §10.3 "Proposed Fix" - ContradictionResolutionProcessor
	// already marks a superseded entry 'deprecated', but nothing previously consulted that
	// flag at retrieval time (IndexResult only carries id/score - filtering by lifecycleState
	// requires the full MemoryEntry, which is only available here, after memStore.get()).
	private static readonly EXCLUDED_LIFECYCLE_STATES: LifecycleState[] = ['deprecated', 'deleted']

	private isRetrievable(entry: MemoryEntry, options?: SearchOptions): boolean {
		if (options?.includeArchived) return true

		// An explicit lifecycleState filter is the caller deliberately asking for
		// specific states (e.g. auditing deprecated facts) - enforce exactly that
		// request instead of the default exclusion below. This filtering has to
		// happen here rather than being trusted as already-applied upstream: the
		// underlying index's `filter` parameter (IndexSearchOptions.filter, passed
		// through to e.g. OramaIndex.search()) is currently unused by every index
		// implementation - see docs/Memory/designMemory.md §10.3 "Proposed Fix".
		const requestedStates = options?.filter?.lifecycleState
		if (requestedStates) {
			const states = Array.isArray(requestedStates) ? requestedStates : [requestedStates]
			return states.includes(entry.lifecycleState ?? 'active')
		}

		return !MemoryService.EXCLUDED_LIFECYCLE_STATES.includes(entry.lifecycleState ?? 'active')
	}

	async search(query: string, options?: SearchOptions): Promise<MemorySearchPage> {
		const topK = options?.topK ?? 10
		// Over-fetch from the index since some results may be filtered out below by
		// lifecycleState - the index itself has no lifecycleState field to filter on
		// (IndexResult is id/score only), so filtering happens post-fetch here instead.
		const results = await this.index.search(query, {
			topK: topK * 2,
			filter: options?.filter,
			intent: options?.intent,
		})

		const items = await Promise.all(
			results.map(async (r) => {
				const entry = await this.memStore.get(r.id)
				return entry ? { entry, score: r.score } : null
			})
		)

		const filtered = (items.filter(Boolean) as { entry: MemoryEntry; score: number }[])
			.filter((r) => this.isRetrievable(r.entry, options))
			.slice(0, topK)

		// ── Graph-augmented retrieval ───────────────────────────────────────────
		// For each seed result, expand its depth-1 graph neighbors and append any
		// highly salient neighbors that are not already in the result set (up to 3
		// bonus entries per seed, capped at topK bonus entries total).
		const seenIds = new Set(filtered.map((r) => r.entry.id))
		const bonus: { entry: MemoryEntry; score: number }[] = []
		const maxBonusTotal = topK

		for (const seed of filtered) {
			if (bonus.length >= maxBonusTotal) break
			const neighborIds = this.graph.expandNeighbors(seed.entry.id, 1)
			let bonusForSeed = 0

			for (const nid of neighborIds) {
				if (bonus.length >= maxBonusTotal || bonusForSeed >= 3) break
				if (seenIds.has(nid)) continue

				const neighbor = await this.memStore.get(nid)
				if (!neighbor) continue
				// Only include neighbors with meaningful salience
				if ((neighbor.salience ?? 0) < 0.3) continue
				if (!this.isRetrievable(neighbor, options)) continue

				seenIds.add(nid)
				bonus.push({ entry: neighbor, score: seed.score * 0.5 })
				bonusForSeed++
			}
		}

		const all = [...filtered, ...bonus]
		return { items: all, total: all.length, hasMore: false }
	}

	async list(options?: ListOptions): Promise<MemoryListPage> {
		const filter = options?.filter ?? {}
		const needsFullSort = options?.orderBy !== undefined && options.orderBy !== 'createdAt'

		// query() without an explicit limit falls back to each store's own default
		// page size - unlimited on IndexedDBStore, but SQLiteStore.query() defaults
		// to 100 (ORDER BY created_at DESC). A non-createdAt orderBy needs the FULL
		// matching set before it can sort correctly, or on native it would silently
		// sort only the 100 most-recently-created matches - wrong for any query
		// matching more than that (e.g. topSalienceEntitiesInWindow() on an active
		// user). count() first, then request exactly that many, only when a
		// client-side sort actually needs it - the common createdAt-order path is
		// unaffected and keeps relying on each store's own default/pagination.
		const queryLimit = needsFullSort ? await this.memStore.count(filter) : undefined
		const { entries } = await this.memStore.query(filter, queryLimit)
		const total = entries.length

		// IMemoryStore.query() implementations always sort by createdAt descending
		// (a fixed contract for cursor pagination) - orderBy/order here are
		// ListOptions-level requests the store doesn't know about, so honor them
		// client-side rather than silently ignoring them (the bug this comment
		// replaces: 'salience'-ordered callers, e.g. the one-pager's Stage 1
		// topSalienceEntitiesInWindow(), were getting createdAt order instead).
		const sorted = needsFullSort
			? sortEntries(entries, options!.orderBy as 'salience' | 'updatedAt')
			: [...entries]
		if (options?.order === 'asc') sorted.reverse()

		const limit = options?.limit ?? 50
		const offset = options?.offset ?? 0
		const page = sorted.slice(offset, offset + limit)

		return {
			items: page,
			total,
			hasMore: offset + limit < total,
		}
	}

	/**
	 * GuideAxon change: graph entities as read-only 'entity' rows (opt-in: list() does not return them): id `entity:<graphId>`, content 'Alice - sister, lives in Leeds' (the name plus
	 * the first line of up to two recent durable entries that mention it), isDurable, lifecycleState 'active'. They are not in
	 * the store, so get/update/delete on these ids do not work.
	 */
	async listEntities(options?: { filter?: MemoryFilter }): Promise<MemoryEntry[]> {
		const filter = options?.filter ?? {}
		if (
			filter.ids ||
			filter.tags ||
			filter.sessionId ||
			filter.userId ||
			filter.agentId ||
			filter.minSalience !== undefined ||
			filter.minImportance !== undefined ||
			filter.outcome ||
			filter.timeRange ||
			filter.maxAge !== undefined
		)
			return []
		if (filter.lifecycleState) {
			const states = Array.isArray(filter.lifecycleState)
				? filter.lifecycleState
				: [filter.lifecycleState]
			if (!states.includes('active')) return []
		}
		const rows: MemoryEntry[] = []
		for (const entity of this.graph.listEntities()) {
			const id = `entity:${entity.id}`
			const linked: MemoryEntry[] = []
			for (const edge of this.graph.getEdges(entity.id, 'mentions')) {
				if (edge.to !== entity.id) continue
				const m = await this.memStore.get(edge.from)
				if (m && m.isDurable && m.lifecycleState !== 'deleted' && m.lifecycleState !== 'deprecated')
					linked.push(m)
			}
			linked.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
			const desc =
				typeof entity.metadata?.description === 'string' ? [entity.metadata.description] : []
			const snippets = [
				...desc,
				...linked.slice(0, 2).map((m) => m.content.split('\n')[0]!.trim().slice(0, 120)),
			].filter(Boolean)
			const newest = linked[0]
			rows.push({
				id,
				type: 'entity',
				content: snippets.length ? `${entity.name} - ${snippets.join('; ')}` : entity.name,
				title: entity.name,
				createdAt: newest?.createdAt ?? '',
				updatedAt: newest?.updatedAt ?? newest?.createdAt ?? '',
				isDurable: true,
				lifecycleState: 'active',
				metadata: { synthesized: true, entityId: entity.id, entityType: entity.type },
			})
		}
		return rows
	}

	async getRelated(id: string, relationType?: string): Promise<MemoryEntry[]> {
		let neighborIds: string[]

		if (relationType) {
			// When a relationType filter is requested, walk edges directly so we can filter
			// by type before expanding further, rather than post-filtering a wide BFS result.
			const directEdges = this.graph.getEdges(id, relationType as EdgeType)
			const directIds = directEdges.map((e) => (e.from === id ? e.to : e.from))

			// Depth-2: also collect neighbors-of-neighbors that share the same edge type
			const depth2Ids: string[] = []
			for (const neighborId of directIds) {
				const secondHop = this.graph.getEdges(neighborId, relationType as EdgeType)
				for (const e of secondHop) {
					const candidate = e.from === neighborId ? e.to : e.from
					if (candidate !== id && !directIds.includes(candidate)) {
						depth2Ids.push(candidate)
					}
				}
			}
			neighborIds = [...new Set([...directIds, ...depth2Ids])]
		} else {
			// No type filter - BFS up to depth 2, exclude pure-entity nodes (only memory entries)
			neighborIds = this.graph.expandNeighbors(id, 2)
		}

		// Only return entries that actually exist in the store (filter out entity nodes)
		const entries = await Promise.all(neighborIds.map((nid) => this.memStore.get(nid)))
		return entries.filter(Boolean) as MemoryEntry[]
	}

	async addRelation(fromId: string, relation: MemoryRelation): Promise<void> {
		const entry = await this.memStore.get(fromId)
		if (!entry) throw new Error(`Memory entry not found: ${fromId}`)

		const relations = entry.relations ?? []
		const existing = relations.findIndex(
			(r) => r.targetId === relation.targetId && r.type === relation.type
		)
		if (existing >= 0) {
			relations[existing] = relation
		} else {
			relations.push(relation)
		}

		entry.relations = relations
		entry.updatedAt = new Date().toISOString()
		await this.memStore.put(entry)

		// Mirror in graph
		this.graph.createEdge(fromId, relation.type, relation.targetId, relation.weight ?? 1.0)
	}

	async removeRelation(
		fromId: string,
		relation: Pick<MemoryRelation, 'type' | 'targetId'>
	): Promise<void> {
		const entry = await this.memStore.get(fromId)
		if (!entry) throw new Error(`Memory entry not found: ${fromId}`)

		const before = entry.relations ?? []
		const after = before.filter(
			(r) => !(r.type === relation.type && r.targetId === relation.targetId)
		)
		if (after.length !== before.length) {
			entry.relations = after
			entry.updatedAt = new Date().toISOString()
			await this.memStore.put(entry)
		}
		this.graph.removeEdge(fromId, relation.type, relation.targetId)
	}

	async getWorkingMemory(sessionId?: string): Promise<MemoryEntry[]> {
		if (sessionId) {
			return this.workingMemory.getForSession(sessionId)
		}
		return this.workingMemory.getAll()
	}

	/**
	 * IBrainEngine.getCompactionRecap - designCognitiveBrain.md §17.4. One-line
	 * summaries of anything recently evicted from working memory, so eviction
	 * isn't silent context loss. '' when nothing has been evicted (§17.6 -
	 * conditionally empty, unlike the always-present Profile/one-pager).
	 */
	async getCompactionRecap(): Promise<string> {
		return this.compactionRecap.render()
	}

	/**
	 * §17.2.5 - writes one computed section into the fixed-ID Profile artifact.
	 * Uses direct store access (not create()/update()) because create() always
	 * generates its own ID and update() requires the entry to already exist -
	 * neither can target/bootstrap a fixed ID, the same reason GRAPH_SNAPSHOT_ID
	 * is written this way in close() below.
	 */
	async persistProfileSection(section: ProfileSection): Promise<void> {
		// Serialize against any other in-flight persistProfileSection() call -
		// see the profileWriteLock field comment for why this is necessary.
		const run = this.profileWriteLock.then(() => this.doPersistProfileSection(section))
		this.profileWriteLock = run.catch(() => undefined)
		return run
	}

	private async doPersistProfileSection(section: ProfileSection): Promise<void> {
		const now = new Date().toISOString()
		const existing = await this.memStore.get(PROFILE_ARTIFACT_ID)
		const sections: ProfileSection[] = existing?.metadata?.sections
			? [...(existing.metadata.sections as ProfileSection[])]
			: []

		const idx = sections.findIndex((s) => s.header === section.header)
		if (idx >= 0) sections[idx] = section
		else sections.push(section)

		// Fill in any headers with no facts yet as empty placeholders, so
		// getProfile() always returns all three headers in a stable order.
		for (const header of ALL_PROFILE_HEADERS) {
			if (!sections.some((s) => s.header === header)) {
				sections.push({ header, static: '', dynamic: '', updatedAt: new Date(0).toISOString() })
			}
		}
		sections.sort(
			(a, b) => ALL_PROFILE_HEADERS.indexOf(a.header) - ALL_PROFILE_HEADERS.indexOf(b.header)
		)

		const fullEntry: MemoryEntry = existing
			? { ...existing, updatedAt: now, metadata: { ...existing.metadata, sections } }
			: {
					id: PROFILE_ARTIFACT_ID,
					type: 'artifact',
					content: 'GuideAxon Profile - internal use only',
					tags: ['profile'],
					createdAt: now,
					updatedAt: now,
					lifecycleState: 'active',
					metadata: { sections },
				}

		// Not indexed (like the graph snapshot) - this is an internal artifact,
		// not something that should surface in ordinary search results.
		await this.memStore.put(fullEntry)
	}

	/** IBrainEngine.getProfile - designCognitiveBrain.md §17.2. */
	async getProfile(): Promise<Profile> {
		const entry = await this.memStore.get(PROFILE_ARTIFACT_ID)
		if (entry?.metadata?.sections) {
			return {
				sections: entry.metadata.sections as ProfileSection[],
				updatedAt: entry.updatedAt ?? entry.createdAt,
			}
		}
		return { sections: [], updatedAt: new Date(0).toISOString() }
	}

	/**
	 * IBrainEngine.assertProfileCorrection - §17.2.9. A direct user assertion
	 * bypasses ContradictionResolutionProcessor's LLM classification (the user
	 * IS ground truth) and goes straight to the `updates` version-chain path
	 * at confidence 1.0, reusing the same parent/child relation §16.2 uses for
	 * every other fact supersession - one versioning code path, not a second one.
	 */
	async assertProfileCorrection(
		header: ProfileHeader,
		factId: string,
		correctedText: string
	): Promise<void> {
		const fact = await this.memStore.get(factId)
		if (!fact) throw new Error(`Memory entry not found: ${factId}`)

		const newId = await this.create({
			type: fact.type,
			content: correctedText,
			isDurable: true,
			tags: fact.tags,
			entities: fact.entities,
			userId: fact.userId,
			metadata: { ...fact.metadata, assertedByUser: true, profileClassified: true },
		})

		await this.addRelation(newId, {
			type: 'parent',
			targetId: factId,
			metadata: { confidence: 1.0, assertedByUser: true },
		})
		await this.addRelation(factId, { type: 'child', targetId: newId })
		await this.update(factId, { lifecycleState: 'deprecated' })

		const section = await new ProfileSynthesizer().computeSection(
			header,
			this,
			this.getProcessorLLMAdapter()
		)
		await this.persistProfileSection(section)

		// §17.3.6 early invalidation - a resolved correction is a new fact; if its
		// entities intersect the one-pager's current scope, force the next
		// getOnePager() call to regenerate instead of serving a stale cache.
		await this.markOnePagerStaleIfScoped(await this.get(newId))
	}

	/**
	 * IBrainEngine.getOnePager - designCognitiveBrain.md §17.3. "What's going
	 * on right now" (active threads, open procedures, upcoming reminders), as
	 * distinct from the Profile's "who is this person."
	 *
	 * Cached with a TTL rather than the doc's "session start, or every N turns"
	 * scheduler (§17.3.6) - a fixed-ID artifact read/regenerate-if-stale gives
	 * the same "periodic, not per-turn" behavior described there without a new
	 * timer subsystem, plus the early-invalidation hook in
	 * assertProfileCorrection() above (and wherever else facts resolve) can mark
	 * the cache stale ahead of the TTL.
	 */
	async getOnePager(): Promise<string> {
		const entry = await this.memStore.get(ONE_PAGER_ARTIFACT_ID)
		const fresh =
			entry?.metadata?.regeneratedAt &&
			!entry.metadata.stale &&
			Date.now() - new Date(entry.metadata.regeneratedAt as string).getTime() < ONE_PAGER_TTL_MS

		if (fresh) return (entry!.metadata!.content as string) ?? ''

		const { OnePagerSynthesizer } = await import('./onepager/OnePagerSynthesizer')
		const content = await new OnePagerSynthesizer().regenerate(
			this,
			this.graph,
			this.getProcessorLLMAdapter()
		)
		this.onePagerScopeEntityIds = await this.computeOnePagerScope()

		const now = new Date().toISOString()
		await this.memStore.put({
			id: ONE_PAGER_ARTIFACT_ID,
			type: 'artifact',
			content: 'GuideAxon Memory One-Pager - internal use only',
			tags: ['onepager'],
			createdAt: entry?.createdAt ?? now,
			updatedAt: now,
			lifecycleState: 'active',
			metadata: { content, regeneratedAt: now, stale: false },
		})

		return content
	}

	/**
	 * IBrainEngine.getRecentEvents - designCognitiveBrain.md §16.8.3 read-back.
	 * Deliberately LLM-free (same rationale as getCompactionRecap()): this is a
	 * raw, deterministic list of what the event graph has recorded, not a
	 * synthesized narrative - that's getOnePager()'s job.
	 *
	 * Without explicit seeds, reuses getOnePager()'s own "what's currently hot"
	 * seed set (topSalienceEntitiesInWindow) rather than expanding to its
	 * depth-2 neighborhood (expandScope) - a 2-hop-out entity's events would
	 * often be unrelated activity that happens to share a distant graph
	 * neighbor, which is the wrong scope for "what's happened lately."
	 *
	 * Summary nodes (pruneStaleEvents() rollups, §16.8.2) are excluded - they're
	 * an audit/history record, not "recent" by construction.
	 */
	async getRecentEvents(seedEntityIds?: string[], limit = 8): Promise<EventSummary[]> {
		const { topSalienceEntitiesInWindow } = await import('./onepager/scopeSelection')
		const seeds =
			seedEntityIds && seedEntityIds.length > 0
				? seedEntityIds
				: await topSalienceEntitiesInWindow(this, 7, 5)
		if (seeds.length === 0) return []

		const byId = new Map<string, ReturnType<InProcessGraph['getEventsForEntity']>[number]>()
		for (const seedId of seeds) {
			for (const event of this.graph.getEventsForEntity(seedId)) {
				if (!event.isSummary) byId.set(event.id, event)
			}
		}

		const resolveName = (id?: string): string | undefined =>
			id ? (this.graph.getEntity(id)?.name ?? id) : undefined

		return Array.from(byId.values())
			.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
			.slice(0, limit)
			.map((e) => ({
				id: e.id,
				predicate: e.predicate,
				actorName: resolveName(e.actorId),
				targetName: resolveName(e.targetId),
				contextName: resolveName(e.contextId),
				occurredAt: e.occurredAt,
				confidence: e.confidence,
			}))
	}

	/** Recomputes just the scope-entity set (Stage 1) - used to check future writes against without re-running Stage 2/3. */
	private async computeOnePagerScope(): Promise<string[]> {
		const { topSalienceEntitiesInWindow, expandScope } = await import('./onepager/scopeSelection')
		const seeds = await topSalienceEntitiesInWindow(this, 7, 5)
		return expandScope(this.graph, seeds, 2)
	}

	/** §17.3.6 early invalidation - see getOnePager()'s doc comment. Never throws; a failed check just leaves the TTL as the fallback trigger. */
	private async markOnePagerStaleIfScoped(entry: MemoryEntry | null): Promise<void> {
		if (!entry || this.onePagerScopeEntityIds.length === 0) return
		try {
			const { OnePagerSynthesizer } = await import('./onepager/OnePagerSynthesizer')
			if (!new OnePagerSynthesizer().markStaleIfScoped(entry, this.onePagerScopeEntityIds)) return
			const existing = await this.memStore.get(ONE_PAGER_ARTIFACT_ID)
			if (!existing) return
			await this.memStore.put({ ...existing, metadata: { ...existing.metadata, stale: true } })
		} catch {
			// Non-fatal - TTL expiry is the fallback trigger.
		}
	}

	async consolidate(): Promise<number> {
		const { entries: all } = await this.memStore.query({ lifecycleState: 'active' })
		// GuideAxon change (memory sync, docs/designMemorySync.md section 5.6 rule 4): entries imported from another
		// device stay out of consolidation. The other device already summarised them; clustering them again would make
		// each device rewrite the other's insights in turn, forever.
		const entries = all.filter((e) => !e.metadata?.imported)
		const count = await this.synthesis.compile(entries)
		if (count > 0) {
			this.emit('synthesis.completed', { count })
		}
		return count
	}

	async checkProspectiveMemory(currentMessage?: string): Promise<MemoryEntry[]> {
		const now = new Date().toISOString()
		const fired: MemoryEntry[] = []
		const firedIds = new Set<string>()

		// ── Pathway 1: Time-based (Einstein dual-pathway model) ──────────────────
		// Scan ALL active entries (not just 'working') for prospective fireAt markers.
		// This catches reverify_fact reminders and user-scheduled memories.
		const { entries: all } = await this.memStore.query({ lifecycleState: 'active' })
		for (const entry of all) {
			if (!entry.metadata?.prospective) continue
			const fireAt = entry.metadata.fireAt as string | undefined
			if (fireAt && fireAt <= now) {
				fired.push(entry)
				firedIds.add(entry.id)
			}
		}

		// ── Pathway 2: Topic-based (McDaniel model) ──────────────────────────────
		// Semantic search for entries explicitly flagged as prospective that match
		// the current message content. Fires even before their scheduled fireAt.
		if (currentMessage && currentMessage.length > 0) {
			const results = await this.index.search(currentMessage, { topK: 5 })
			for (const r of results) {
				if (firedIds.has(r.id)) continue
				const entry = await this.memStore.get(r.id)
				if (entry?.metadata?.prospective && !firedIds.has(entry.id)) {
					// Only fire topic-based if content is highly relevant (score > 0.6)
					if (r.score >= 0.6) {
						fired.push(entry)
						firedIds.add(entry.id)
					}
				}
			}
		}

		// Mark fired entries as no longer pending (clear fireAt so they don't re-fire)
		for (const entry of fired) {
			const wasTime =
				(entry.metadata?.fireAt as string | undefined) !== undefined &&
				(entry.metadata!.fireAt as string) <= now
			if (wasTime) {
				entry.metadata = { ...(entry.metadata ?? {}), fireAt: null, firedAt: now }
				entry.updatedAt = now
				await this.memStore.put(entry)
			}
		}

		return fired
	}

	on(event: MemoryEvent, callback: EventCallback): void {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set())
		this.listeners.get(event)!.add(callback)
	}

	off(event: MemoryEvent, callback: EventCallback): void {
		this.listeners.get(event)?.delete(callback)
	}

	// ── Scheduled maintenance ─────────────────────────────────────────────────

	/**
	 * Run retention policy evaluation over all active entries.
	 * Implements IBrainEngine.runRetentionPolicies().
	 * Returns RetentionResult (matches IBrainEngine contract).
	 */
	async runRetentionPolicies(): Promise<RetentionResult> {
		const { entries } = await this.memStore.query({ lifecycleState: 'active' })
		const totalEntryCount = entries.length
		let entriesDeleted = 0,
			entriesCompressed = 0,
			entriesProcessed = 0
		let requantized = 0,
			reverified = 0,
			deprecated = 0

		for (const entry of entries) {
			entriesProcessed++
			recomputeSalience(entry)
			const policy = evaluateRetentionPolicy(entry)

			if (policy === 'tombstone_episode') {
				// Policy 1: permanent soft-delete
				entry.lifecycleState = 'deleted'
				entry.retentionPolicy = 'tombstone_episode'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				entriesDeleted++
			} else if (policy === 'compact_raw') {
				// Policy 2: compress content, keep entry in index
				entry.lifecycleState = 'compressed'
				entry.content = entry.content.slice(0, 200) + '…'
				entry.compressionLevel = 1
				entry.retentionPolicy = 'compact_raw'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				entriesCompressed++
			} else if (policy === 'requantize_embeddings') {
				// Policy 3: mark embedding as requantized (actual float32→uint8 done by index)
				if (shouldRequantize(entry, totalEntryCount)) {
					entry.metadata = { ...(entry.metadata ?? {}), embeddingDtype: 'uint8' }
					entry.retentionPolicy = 'requantize_embeddings'
					entry.updatedAt = new Date().toISOString()
					await this.memStore.put(entry)
					requantized++
				}
			} else if (policy === 'deprecate_procedure') {
				// Policy 4: mark superseded procedure as deprecated
				entry.lifecycleState = 'deprecated'
				entry.retentionPolicy = 'deprecate_procedure'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				deprecated++
			} else if (policy === 'reverify_fact') {
				// Policy 5: flag low-confidence facts for human/agent verification
				// Add a prospective memory reminder rather than deleting
				entry.retentionPolicy = 'reverify_fact'
				entry.metadata = {
					...(entry.metadata ?? {}),
					prospective: true,
					fireAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), // 7 days
					reverifyReason: `Low confidence (${(entry.confidence ?? 0).toFixed(2)}) and <3 sources`,
				}
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
				reverified++
			} else if (policy === 'demote_episode') {
				// Policy 7: halve salience score
				entry.salience = (entry.salience ?? 0) * 0.5
				entry.retentionPolicy = 'demote_episode'
				entry.updatedAt = new Date().toISOString()
				await this.memStore.put(entry)
			}
		}

		// Policy 6: prune_edges - weak graph edges (weight < 0.1)
		const edgesPruned = this.graph.removeWeakEdges(0.1)

		// Emit retention event
		this.emit('processing.completed', {
			type: 'retention',
			entriesProcessed,
			entriesCompressed,
			entriesDeleted,
			edgesPruned,
			requantized,
			reverified,
			deprecated,
		})

		return { entriesProcessed, entriesCompressed, entriesDeleted, edgesPruned }
	}

	/**
	 * Run the full 10-phase MaintenanceCycle.
	 * Errors are swallowed to prevent crashing the app.
	 * Emits 'maintenance.completed' when done.
	 */
	async runMaintenance(budgetMs = 60_000): Promise<void> {
		try {
			const cycle = new MaintenanceCycle({
				store: this.memStore,
				index: this.index,
				graph: this.graph,
				pipeline: this.pipeline,
				synthesisEngine: this.synthesis,
				vault: this.options.vault,
				quality: this.options.llm ? 'T1' : undefined,
			})
			await cycle.run(budgetMs)
			await this.backfillProfileClassification().catch(() => 0)
			await this.classifyPendingProfileFacts().catch(() => 0)
			await this.logGap11Metrics()
			this.emit('maintenance.completed', { budgetMs })
		} catch {
			// Non-fatal - maintenance failure must not crash the app
		}
	}

	/**
	 * Re-checks durable entries stored under an older classifier (ProfileClassifier.ts, PROFILE_CLASSIFIER_VERSION): the patterns
	 * now cover more phrasings, but an entry the old patterns missed was already marked classified and would never be looked at
	 * again. Patterns only (no model); an entry they still miss is tagged pending for the model pass. In batches, each stamped with
	 * the version so it is checked once; returns how many were checked.
	 */
	async backfillProfileClassification(batch = PROFILE_BACKFILL_BATCH): Promise<number> {
		const startedAt = nowMs()
		const { entries } = await this.memStore.query(
			{ lifecycleState: 'active', isDurable: true } as never,
			10_000
		)
		const unchecked = entries.filter(
			(e) =>
				e.isDurable === true &&
				((e.metadata?.profileClassifierVersion as number | undefined) ?? 0) <
					PROFILE_CLASSIFIER_VERSION
		)
		const todo = unchecked.slice(0, batch)
		const headersChanged = new Set<ProfileHeader>()
		for (const entry of todo) {
			const stamp = {
				...entry.metadata,
				profileClassified: true,
				profileClassifierVersion: PROFILE_CLASSIFIER_VERSION,
			}
			if (isProfileFact(entry)) {
				await this.update(entry.id, { metadata: stamp }) // already placed by the old patterns
				continue
			}
			const probe = { ...entry, tags: [...(entry.tags ?? [])] } as MemoryEntry
			const header = applyProfileClassification(probe)
			let tags = probe.tags ?? []
			if (
				!header &&
				!entry.metadata?.profileModelChecked &&
				!tags.includes(PROFILE_PENDING_TAG) &&
				!tags.includes(PROFILE_SHADOWED_TAG)
			)
				tags = [...tags, PROFILE_PENDING_TAG]
			await this.update(entry.id, { tags, metadata: stamp })
			if (header) headersChanged.add(header)
		}
		for (const header of headersChanged) {
			await this.persistProfileSection(await new ProfileSynthesizer().computeSection(header, this))
		}
		// Measuring only (a dev build, or GAP_METRICS): this loads up to 10,000 durable entries on every start even when nothing is
		// left to check. The numbers say whether that costs anything on a real store, before a "done at this version" marker is
		// considered (a marker could hide entries that arrive already stamped, e.g. synced from an older device).
		const ms = Math.round((nowMs() - startedAt) * 10) / 10
		gapMetric('profile', 'backfill_scan', {
			durableScanned: entries.length,
			checked: todo.length,
			stillUnchecked: unchecked.length - todo.length,
			ms,
			verdict:
				entries.length >= 10_000
					? 'WATCH: the scan hit its 10,000-entry cap, entries beyond it are never re-checked'
					: ms > 250
						? 'WATCH: a slow scan on every start; consider a done marker (after checking how synced entries are stamped)'
						: 'fine, the scan is cheap',
		})
		return todo.length
	}

	/** IBrainEngine.flushProcessing: resolves when the pipeline has finished everything queued so far. */
	async flushProcessing(): Promise<void> {
		await this.pipeline.whenIdle()
	}

	/**
	 * The model tier of profile classification (docs/Memory/designMemoryProcessing.md, section 5). The pipeline places a durable
	 * fact in the Profile by patterns only; one they miss is tagged `profile-pending`. Here a model, through the `profile.classify`
	 * port (the profileHeader decision gate in the app), reads the user's statement for up to `batch` of them and names the header
	 * or none. Off the write path on purpose (a model call per entry would hold up the pipeline queue), bounded per run, and asked
	 * at most MAX_PROFILE_MODEL_TRIES times per entry when it cannot decide, so the same entries do not stay at the front forever.
	 *
	 * What each answer does:
	 *  - unavailable (gate off, none loaded, hosted without opt-in): the pass stops, nothing is counted, the tags stay;
	 *  - shadow (the gate recorded an answer and applied none): the entry moves to `profile-shadowed`, no try is counted, so
	 *    evaluating in shadow mode does not use up the entries. Entries under that tag are asked about only after the pending ones,
	 *    and only ONE of them per pass while the gate stays in shadow mode (a probe); when the gate goes live they are classified;
	 *  - unclear: a try is counted; after MAX_PROFILE_MODEL_TRIES the entry is given up on (stays unplaced);
	 *  - answered: the header tag is added (or none), the waiting tag removed, the section regenerated.
	 * Without the port nothing is asked. The section text is written offline from the user's words. Returns how many entries were
	 * settled (answered or given up).
	 */
	async classifyPendingProfileFacts(batch = PROFILE_MODEL_BATCH): Promise<number> {
		const classify = this.options.profile?.classify
		if (!classify) return 0

		const headersChanged = new Set<ProfileHeader>()
		let settled = 0
		let asked = 0
		let unavailable = false
		let sawShadow = false

		const ask = async (entry: MemoryEntry): Promise<void> => {
			const waitingTags = [PROFILE_PENDING_TAG, PROFILE_SHADOWED_TAG]
			const others = (entry.tags ?? []).filter((t) => !waitingTags.includes(t))
			const wasShadowed = (entry.tags ?? []).includes(PROFILE_SHADOWED_TAG)
			let result: ProfileClassifyResult
			try {
				result = await classify(statementOf(entry))
			} catch {
				result = { status: 'unclear' }
			}
			asked++
			if (result.status === 'unavailable') {
				unavailable = true
				return
			}
			if (result.status === 'shadow') {
				sawShadow = true
				if (!wasShadowed) await this.update(entry.id, { tags: [...others, PROFILE_SHADOWED_TAG] })
				return
			}
			const answered = result.status === 'answered'
			const header = result.status === 'answered' ? result.header : null
			const tries =
				((entry.metadata?.profileModelTries as number | undefined) ?? 0) + (answered ? 0 : 1)
			if (!answered && tries < MAX_PROFILE_MODEL_TRIES) {
				// Still undecided: back to (or stay) pending, with the try counted.
				await this.update(entry.id, {
					tags: [...others, PROFILE_PENDING_TAG],
					metadata: { ...entry.metadata, profileModelTries: tries },
				})
				return
			}
			await this.update(entry.id, {
				tags: header ? [...others, profileTag(header)] : others,
				metadata: {
					...entry.metadata,
					profileModelTries: tries,
					...(answered ? { profileModelChecked: true } : {}),
				},
			})
			if (header) headersChanged.add(header)
			settled++
		}

		const pending = (
			await this.list({
				filter: { tags: [PROFILE_PENDING_TAG], lifecycleState: 'active' },
				limit: batch,
			})
		).items
		for (const entry of pending) {
			if (unavailable || asked >= batch) break
			await ask(entry)
		}
		// Entries asked about during shadow mode: only once nothing is pending, and a single probe while the gate is still in shadow
		// mode (asking all of them again would record the same decisions again). A live gate classifies them.
		if (!unavailable && !sawShadow && asked < batch) {
			const shadowed = (
				await this.list({
					filter: { tags: [PROFILE_SHADOWED_TAG], lifecycleState: 'active' },
					limit: batch - asked,
				})
			).items
			for (const entry of shadowed) {
				if (unavailable || sawShadow || asked >= batch) break
				await ask(entry)
			}
		}
		for (const header of headersChanged) {
			await this.persistProfileSection(await new ProfileSynthesizer().computeSection(header, this))
		}
		return settled
	}

	/**
	 * Gap 11 (docs/designKnownGaps.md, section 10.1): what is lost when the app is killed mid-enrichment. After each maintenance run
	 * (which recovers entities, salience and the semantic summary) this logs the pipeline's counters for this session and the
	 * entries the processor chain has not marked done. `durableUnclassified` is a proxy: a durable entry without
	 * `metadata.profileClassified` either was never processed or the processor did not persist its mark, so read it as an upper
	 * bound. A number that keeps growing across restarts, with `failedFinal` or `startedNotFinished` above zero, is the signal to
	 * build the durable marker (which needs an atomic single-field update; see the gap 11 decision).
	 */
	private async logGap11Metrics(): Promise<void> {
		if (!gapMetricsEnabled()) return
		try {
			const { entries } = await this.memStore.query(
				{ lifecycleState: 'active', isDurable: true } as never,
				10_000
			)
			const durable = entries.filter((e) => e.isDurable === true)
			const unclassified = durable.filter((e) => !e.metadata?.profileClassified).length
			const st = this.pipeline.stats
			const startedNotFinished = Math.max(0, st.started - st.completed - st.failed)
			gapMetric('gap11', 'after_maintenance', {
				...st,
				startedNotFinished,
				durableEntries: durable.length,
				durableUnclassified: unclassified,
				verdict:
					st.failedFinal > 0 || unclassified > 0
						? 'WATCH: some passes failed for good or entries lack the processor-chain mark; compare across restarts'
						: 'fine, nothing lost this session',
			})
		} catch {
			// measuring must never break maintenance
		}
	}

	// ── Internal ──────────────────────────────────────────────────────────────

	/** Lazily initialise and cache the T1 LLM used for think(). */
	private async getThinkLLM(): Promise<LLMInstance | null> {
		if (this.thinkLLM) return this.thinkLLM
		const llmCfg = this.llmConfig?.t1 ?? this.llmConfig?.t2
		if (!llmCfg) return null

		try {
			const { LLM } = await import('@page-agent/llms')
			this.thinkLLM = new LLM({
				baseURL: llmCfg.baseURL,
				model: llmCfg.model,
				apiKey: llmCfg.apiKey ?? '',
				temperature: 0.2,
				maxRetries: 1,
			})
			return this.thinkLLM
		} catch {
			return null
		}
	}

	/**
	 * Build a simple text-completion adapter over the T1 LLM, for the pluggable
	 * processor chain's ProcessorContext.llmService (§16.2). Reuses
	 * getThinkLLM()'s tool-invoke pattern rather than adding a second LLM client.
	 *
	 * Always returns an adapter object (never undefined) and resolves
	 * getThinkLLM() fresh on every complete() call, rather than once here -
	 * getThinkLLM() itself is unaffected by that: it caches the LLM instance on
	 * first success but returns null (not cached) on failure/no-config, so a
	 * caller that re-invokes it later picks up an LLM that becomes available
	 * mid-session instead of being permanently pinned to whatever was true at
	 * initialize() time. complete() throws when no LLM is available; callers
	 * (ContradictionResolutionProcessor.classify()) already catch and fall back
	 * to their own no-LLM heuristic.
	 */
	private getProcessorLLMAdapter(): { complete(prompt: string): Promise<string> } {
		return {
			complete: async (prompt: string) => {
				const llm = await this.getThinkLLM()
				if (!llm) throw new Error('No T1/T2 LLM configured')
				const abort = new AbortController()
				const result = await llm.invoke(
					[{ role: 'user', content: prompt }],
					{
						respond: {
							description: 'Return the raw text response',
							inputSchema: { parse: (v: unknown) => v as { text: string } } as never,
							execute: async (args: { text: string }) => args,
						},
					},
					abort.signal
				)
				const toolResult = result.toolResult as { text: string } | null
				return toolResult?.text ?? ''
			},
		}
	}

	private emit(event: MemoryEvent, payload: unknown): void {
		const cbs = this.listeners.get(event)
		if (!cbs) return
		for (const cb of cbs) {
			try {
				cb(payload)
			} catch {
				// Listener failures must not crash the service
			}
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID()
	}
	// Fallback: timestamp + random
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** list()'s client-side sort for orderBy values IMemoryStore.query() doesn't natively support - see list()'s comment. */
function sortEntries(entries: MemoryEntry[], orderBy: 'salience' | 'updatedAt'): MemoryEntry[] {
	const key = (e: MemoryEntry): string | number =>
		orderBy === 'salience'
			? (e.salience ?? (e.importance ? (e.importance - 1) / 4 : 0))
			: (e.updatedAt ?? e.createdAt)
	// Descending by default (matches the store's own createdAt-descending contract) -
	// list() reverses afterward when the caller asked for 'asc'.
	return [...entries].sort((a, b) => (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0))
}
