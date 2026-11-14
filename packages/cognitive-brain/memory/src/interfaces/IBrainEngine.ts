import type {
	ContextPack,
	EventSummary,
	MemoryEntry,
	MemoryEvent,
	MemoryRelation,
	MemorySearchPage,
	Profile,
	ProfileHeader,
	RetentionResult,
	SearchOptions,
	ThinkResult,
} from '../types'

/**
 * IBrainEngine - Universal memory interface (v2.1).
 * Implemented on all platforms (web, mobile, desktop).
 * Does NOT know about agents, workflows, or skill execution.
 *
 * Design: Section 6.2 of designCognitiveBrain.md
 */
export interface IBrainEngine {
	/** Store a new memory entry. Returns assigned ID. Write succeeds immediately;
	 *  pipeline enrichment happens async. */
	store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string>

	/** GuideAxon change (memory sync): write an entry that came from another device, keeping its id, into the store and
	 *  index only: no enrichment, no consolidation event. Optional: an engine without it cannot import synced records. */
	importEntry?(entry: MemoryEntry): Promise<void>

	/** Hybrid semantic + keyword search. */
	search(query: string, options?: SearchOptions): Promise<MemorySearchPage>

	/** T1/T2 synthesis answer - assembles context and invokes LLM for a direct answer. */
	think(query: string): Promise<ThinkResult>

	/** Trigger synthesis pipeline. Returns number of vault artifacts produced. */
	synthesize(entries?: MemoryEntry[]): Promise<number>

	/** Assemble a token-budgeted context pack for an agent prompt. */
	getContextPack(prompt: string, budgetTokens?: number): Promise<ContextPack>

	/** Retrieve current working memory for a session. */
	getWorkingMemory(sessionId?: string): Promise<MemoryEntry[]>

	/**
	 * Resolves when the background enrichment of everything stored so far (entities, salience, the profile classification) has
	 * finished. A store() returns before that. For tests, and for a caller that must read what enrichment writes. Optional:
	 * an engine with no background processing can leave it out.
	 */
	flushProcessing?(): Promise<void>

	/**
	 * Asks a model to place up to `batch` stored facts the pattern classifier could not (the "model tier" of the profile
	 * classification). Returns how many were settled; 0 when there are none or no model is available. Optional.
	 */
	classifyPendingProfileFacts?(batch?: number): Promise<number>

	/** Read the current Profile - the three fixed headers (life_context,
	 *  autonomy, communication_style) always injected into the answering
	 *  model's prompt (designCognitiveBrain.md §17.2). */
	getProfile(): Promise<Profile>

	/** §17.2.9 - a direct user assertion that a specific fact is wrong.
	 *  Bypasses ContradictionResolutionProcessor's LLM classification entirely
	 *  (the user is ground truth, not something an LLM needs to judge) and
	 *  writes the correction as an `updates` version-chain entry at
	 *  confidence 1.0, then regenerates the affected Profile section. */
	assertProfileCorrection(
		header: ProfileHeader,
		factId: string,
		correctedText: string
	): Promise<void>

	/** Read the current Memory One-Pager - "what's going on right now" (active
	 *  threads, open procedures, upcoming reminders), as distinct from the
	 *  Profile's "who is this person" (designCognitiveBrain.md §17.3). Cached
	 *  and regenerated periodically, not per-turn (§17.3.6). */
	getOnePager(): Promise<string>

	/** One-line summaries of anything recently evicted from working memory -
	 *  '' when nothing has been evicted (designCognitiveBrain.md §17.4). */
	getCompactionRecap(): Promise<string>

	/** Recent Actor/Event/Target/Context activity from the event graph
	 *  (designCognitiveBrain.md §16.8.3 read-back) - "what's happened lately"
	 *  as distinct from getOnePager()'s narrative synthesis. Names are
	 *  pre-resolved from graph entity ids; empty when the event graph has
	 *  nothing recent to show. Scoped to the same "currently hot" entities as
	 *  getOnePager() unless seedEntityIds is given explicitly. */
	getRecentEvents(seedEntityIds?: string[], limit?: number): Promise<EventSummary[]>

	/** Get structurally related entries via the knowledge graph. */
	getRelated(id: string, relationType?: string): Promise<MemoryEntry[]>

	/** Add a typed relation between two entries. */
	addRelation(fromId: string, relation: MemoryRelation): Promise<void>

	/** Remove a relation added with addRelation (matched by type + targetId). No-op if absent. */
	removeRelation(fromId: string, relation: Pick<MemoryRelation, 'type' | 'targetId'>): Promise<void>

	/** Run retention policies - compress, archive, prune low-salience entries. */
	runRetentionPolicies(): Promise<RetentionResult>

	/** Subscribe to memory lifecycle events. */
	on(event: MemoryEvent, callback: (payload: unknown) => void): void

	/** Unsubscribe. */
	off(event: MemoryEvent, callback: (payload: unknown) => void): void

	/** Initialise all subsystems. Must be called before first use. */
	initialize(): Promise<void>

	/** Graceful shutdown. */
	close(): Promise<void>
}
