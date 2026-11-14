// ===================================================================
// SMRITI Memory Orchestration - `@page-agent/memory/orchestration`
// ===================================================================
// The orchestrator (turn lifecycle, working memory, consolidation,
// semantic search) assembled over the IndexedDB adapters, so this is
// WEB-TIER code: it imports ../adapters/web and must never be exported
// from the package root (which stays platform-neutral; see
// index.noNodeDeps.test.ts). A mobile/desktop equivalent would wire the
// same classes to SQLite/Postgres adapters.
//
// The host app must call configureInferenceAdapter() once at startup;
// see InferenceAdapterOptions for what it supplies.
// ===================================================================

// ─── Orchestrator (main entry point) ──────────────────────────────
export { SmritiOrchestrator } from './orchestrator'
export type { SmritiMemoryConfig } from './orchestrator'

// ─── Orchestration classes ────────────────────────────────────────
export { ConsolidationManager } from './consolidation'
export {
	InferenceAdapter,
	configureInferenceAdapter,
	getInferenceAdapter,
} from './inferenceAdapter'
export type {
	APIClientConfig,
	BrowserInferenceRequest,
	BrowserInferenceResponse,
	InferenceAdapterOptions,
	ResolvedInferenceClient,
} from './inferenceAdapter'
export { DEFAULT_QUOTA } from './quota'

// ─── Types from @page-agent/memory (canonical source) ────────────
export type {
	EntityKind,
	NodeKind,
	ActivationItem,
	EvictionPolicy,
	WorkingMemoryBudget,
	ProcedureRecord,
	ProcedureVersionRecord,
	ProcedureStep,
	ProcedureStatus,
	ProcedureVersionStatus,
	ProcedurePatch,
	ProcedurePatchAction,
	EvolutionPreconditionCheck,
	MergeCandidate,
	MetaMemoryRecord,
	MutationEvent,
	MutationType,
	ConsolidationJob,
	ConsolidationJobType,
	ConsolidationStatus as JobStatus,
	RetentionPolicyConfig,
	RetentionPolicyAction,
	MaintenanceReport,
	StorageUsage,
	// Phase 4 types
	VersionedRecord,
	OutcomeType,
	EntityRecord,
	FactRecord,
	TurnRecord,
	EpisodeRecord,
	GraphEdgeType,
	GraphNodeRecord,
	StoredGraphEdge,
	RetrievalIntent,
	ScoredCandidate,
	RetrievalPlan,
	InferenceTier,
	InferenceRequest,
	InferenceResult,
	WikiKnowledgeBaseConfig,
	WikiPage,
	WikiRawEntry,
	IGraphOps,
	IWikiStore,
	IWikiRawStore,
} from '../index'

export {
	DEFAULT_WM_BUDGET,
	SmritiWorkingMemory as WorkingMemory,
	CacheConsistencyManager,
	ProceduralStore,
} from '../index'

// Web-only adapters now live on the /adapters/web subpath (the package root is platform-neutral).
export type {
	// Phase 4 adapters/classes
	IndexedDBEpisodicStore,
	IndexedDBSemanticStore,
	IndexedDBGraphStore,
	IndexedDBJobQueue,
	IEmbedder,
	OffscreenBridgeFn,
	IVectorSyncDataSources,
} from '../adapters/web'
export { IndexedDBProceduralStore } from '../adapters/web'
