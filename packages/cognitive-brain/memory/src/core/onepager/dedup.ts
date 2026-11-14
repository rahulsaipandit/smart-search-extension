import type { MemoryEntry, MemoryType } from '../../types'

/**
 * Stage 2 of OnePagerSynthesizer.regenerate() - designCognitiveBrain.md
 * §17.3.4. Dedupes the candidate set against itself (near-duplicate pairs
 * within the ~40 candidates, not against existing one-pager content or
 * working memory).
 */

export type EmbeddingFn = (text: string) => Promise<number[]>

const SIMILARITY_THRESHOLD = 0.92

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0
	let normA = 0
	let normB = 0
	const len = Math.min(a.length, b.length)
	for (let i = 0; i < len; i++) {
		dot += a[i]! * b[i]!
		normA += a[i]! * a[i]!
		normB += b[i]! * b[i]!
	}
	if (normA === 0 || normB === 0) return 0
	return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * T3 fallback when no embeddingFn is available: lexical (Jaccard) similarity
 * over lowercased word sets. Coarser than cosine similarity over embeddings,
 * but still catches near-verbatim duplicates - the same graceful-degradation
 * shape as ProfileSynthesizer.compose()'s T3 path, applied to dedup instead
 * of composition.
 */
function jaccardSimilarity(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean))
	const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean))
	if (wordsA.size === 0 || wordsB.size === 0) return 0
	let intersection = 0
	for (const w of wordsA) if (wordsB.has(w)) intersection++
	const union = wordsA.size + wordsB.size - intersection
	return union === 0 ? 0 : intersection / union
}

/**
 * Cluster candidates by near-duplicate similarity (threshold 0.92, deliberately
 * strict - near-dup, not topical-sim). Single-link clustering: an entry joins
 * the first existing cluster any of whose members it's similar enough to.
 */
export async function clusterBySimilarity(
	candidates: MemoryEntry[],
	embeddingFn?: EmbeddingFn,
	threshold: number = SIMILARITY_THRESHOLD
): Promise<MemoryEntry[][]> {
	if (candidates.length === 0) return []

	const embeddings: (number[] | null)[] = embeddingFn
		? await Promise.all(
				candidates.map(async (c) => {
					try {
						return await embeddingFn(c.content)
					} catch {
						return null
					}
				})
			)
		: candidates.map(() => null)

	const clusters: MemoryEntry[][] = []
	const clusterEmbeddings: (number[] | null)[] = []

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i]!
		const embedding = embeddings[i] ?? null

		let joined = false
		for (let c = 0; c < clusters.length; c++) {
			const sim =
				embedding && clusterEmbeddings[c]
					? cosineSimilarity(embedding, clusterEmbeddings[c]!)
					: jaccardSimilarity(candidate.content, clusters[c]![0]!.content)

			if (sim >= threshold) {
				clusters[c]!.push(candidate)
				joined = true
				break
			}
		}

		if (!joined) {
			clusters.push([candidate])
			clusterEmbeddings.push(embedding)
		}
	}

	return clusters
}

/** Tier ranking for representative selection - highest tier wins (§17.3.4). */
const TYPE_TIER: Record<MemoryType, number> = {
	insight: 5,
	procedure: 4,
	semantic: 3,
	episodic: 2,
	prospective: 1,
	artifact: 0,
	goal: 0,
	entity: 0,
	working: 0,
}

function isSuperseded(entry: MemoryEntry): boolean {
	return (entry.relations ?? []).some((r) => r.type === 'child')
}

/**
 * Pick the representative entry for a dedup cluster: prefer higher type tier
 * (insight > procedure > semantic > episodic > prospective), then prefer an
 * entry not superseded by a newer version (§16.2 version chain), then
 * tie-break by highest salience.
 */
export function pickRepresentative(cluster: MemoryEntry[]): MemoryEntry {
	return cluster.reduce((best, candidate) => {
		const bestTier = TYPE_TIER[best.type] ?? 0
		const candidateTier = TYPE_TIER[candidate.type] ?? 0
		if (candidateTier !== bestTier) return candidateTier > bestTier ? candidate : best

		const bestSuperseded = isSuperseded(best)
		const candidateSuperseded = isSuperseded(candidate)
		if (candidateSuperseded !== bestSuperseded) return candidateSuperseded ? best : candidate

		const bestSalience = best.salience ?? 0
		const candidateSalience = candidate.salience ?? 0
		return candidateSalience > bestSalience ? candidate : best
	})
}
