import type { StorageQuota } from '../types'

export const DEFAULT_QUOTA: StorageQuota = {
	maxBytesTotal: 200 * 1024 * 1024,
	maxBytesEmbeddings: 50 * 1024 * 1024,
	maxEpisodes: 10_000,
	maxProcedureVersions: 500,
	maxRawTurns: 5_000,
	maxGraphEdges: 100_000,
	watermarkThreshold: 0.85,
}
