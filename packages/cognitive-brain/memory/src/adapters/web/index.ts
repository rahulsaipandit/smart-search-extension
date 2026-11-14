// Web factory lives here (not on the package root): it dynamically imports the IndexedDB/Orama adapters above,
// and Metro resolves dynamic imports statically, so exporting it from the root would drag them into Expo bundles.
export { createWebMemoryService, createWebBrainEngine } from '../../factory'
export type { CreateWebMemoryServiceOptions } from '../../factory'
export { IndexedDBStore } from './IndexedDBStore'
export { OramaIndex, SemanticSearchBridge } from './OramaIndex'
export type { SemanticIndexEntry, SemanticSearchConfig } from './OramaIndex'
export { IndexedDBProceduralStore } from './IndexedDBProceduralStore'
export {
	IndexedDBEpisodicStore,
	EpisodicStore,
	TurnStore,
	MutationEventStore,
} from './IndexedDBEpisodicStore'
export {
	IndexedDBSemanticStore,
	EntityStore,
	FactStore,
	MetaStore,
	TombstoneStore,
	WikiPageStore,
	WikiRawStore,
} from './IndexedDBSemanticStore'
export { IndexedDBGraphStore } from './IndexedDBGraphStore'
export { IndexedDBJobQueue, JobQueueStore, SnapshotStore } from './IndexedDBJobQueue'
export { OffscreenEmbedder, NullEmbedder } from './OffscreenEmbedder'
export type { IEmbedder, EmbedOptions, OffscreenBridgeFn } from './OffscreenEmbedder'
export { VectorIndexSync } from './VectorIndexSync'
export type { IVectorSyncDataSources } from './VectorIndexSync'
