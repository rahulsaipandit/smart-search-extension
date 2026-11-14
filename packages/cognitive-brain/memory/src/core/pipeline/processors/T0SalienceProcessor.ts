import type { MemoryEntry, RetentionPolicy } from '../../../types'
import { isProfileFact } from '../../profile/ProfileClassifier'

/**
 * T0 Salience Processor - zero LLM cost, pure computation.
 *
 * Multi-factor salience formula (from GA + Smriti reference implementations):
 *
 *   salience = recency(0.30) + outcome_boost + entity_linkage(max 0.20)
 *              + procedure_link(0.20) + retrieval_boost(max 0.10)
 *              + reinforcement_boost(max 0.15)
 *
 * Salience must be recomputed hourly because `recency` decays with time.
 *
 * reinforcement_boost (designCognitiveBrain.md §16.3, Supermemory comparison):
 * rewards a memory being *restated* by the user, distinct from retrieval_boost
 * which rewards a memory being *recalled*. Driven by
 * `metadata.restatementCount`, incremented by ContradictionResolutionProcessor
 * when it detects a near-duplicate durable entry rather than a genuine update.
 */

export function computeSalience(entry: MemoryEntry): number {
	const now = Date.now()
	const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : now
	const ageHours = (now - createdAt) / 3_600_000

	// Recency: decays linearly over 24 hours (0.30 weight)
	const recency = Math.max(0, 1 - ageHours / 24) * 0.3

	// Outcome boost - failures are prioritized for learning
	const outcomeBoost: Record<string, number> = {
		failure: 0.4,
		resolved: 0.3,
		success: 0.2,
		pending: 0.1,
		abandoned: 0.0,
	}
	const boost = outcomeBoost[entry.outcome ?? 'pending'] ?? 0.1

	// Entity linkage: up to 4 linked entities → max 0.20
	const entityLinkage = Math.min(entry.entities?.length ?? 0, 4) * 0.05

	// Procedure link: +0.20 if linked to a procedure
	const procedureLink = (entry.linkedProcedureIds?.length ?? 0) > 0 ? 0.2 : 0

	// Retrieval boost: each retrieval adds 0.02, capped at 0.10
	const retrievalBoost = Math.min((entry.retrievalCount ?? 0) * 0.02, 0.1)

	// Reinforcement boost: each restatement adds 0.02, capped at 0.15 (§16.3)
	const restatementCount = (entry.metadata?.restatementCount as number | undefined) ?? 0
	const reinforcementBoost = Math.min(restatementCount * 0.02, 0.15)

	const raw = recency + boost + entityLinkage + procedureLink + retrievalBoost + reinforcementBoost
	return Math.min(1, Math.max(0, raw))
}

/**
 * Mutates entry.salience in-place. Returns the new value.
 */
export function recomputeSalience(entry: MemoryEntry): number {
	const s = computeSalience(entry)
	entry.salience = s
	return s
}

// ── Retention policy evaluation ──────────────────────────────────────────────

/** Importance (1-5) at or above which an entry is kept whole: it is something the user would expect to be remembered. */
export const PROTECTED_IMPORTANCE = 4

/**
 * An important memory is not forgotten, and not shortened, just because it is old. Salience is mostly recency (it is ~0 after a
 * day), so without this an old fact scores as low as an old greeting and is halved after 30 days and deleted after 90. Two things
 * mark an entry as important: a high importance score, and having been accepted into the user's profile (a `profile:` tag, set by
 * the profile classifier for identity, preference and autonomy statements). Both are narrow on purpose: "durable" alone is a
 * broad regex ("I'm hungry" matches it), and protecting all of it would let storage grow without bound.
 */
export function isProtectedFromForgetting(
	entry: Pick<MemoryEntry, 'importance' | 'tags'>
): boolean {
	return (entry.importance ?? 0) >= PROTECTED_IMPORTANCE || isProfileFact(entry)
}

/**
 * Evaluate which retention policy (if any) should fire for this entry.
 * Implements all 7 policies from the Smriti reference (design doc §9).
 *
 * Priority order (highest first):
 *   1. tombstone_episode - permanent soft-delete
 *   2. compact_raw       - content compression
 *   3. requantize_embeddings - embedding compression (count-based quota proxy)
 *   4. deprecate_procedure - superseded procedures
 *   5. reverify_fact     - low-confidence facts
 *   6. prune_edges       - weak graph edges (evaluated at graph level, not per-entry)
 *   7. demote_episode    - salience decay
 *
 * GuideAxon: policies 1, 2 and 7 are skipped for an entry that isProtectedFromForgetting() (above).
 */
export function evaluateRetentionPolicy(entry: MemoryEntry): RetentionPolicy | null {
	const now = Date.now()
	const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : now
	const ageDays = (now - createdAt) / 86_400_000
	const salience = entry.salience ?? computeSalience(entry)
	const keepWhole = isProtectedFromForgetting(entry)

	// 1. Tombstone: very old + very low salience episodics
	if (!keepWhole && ageDays > 90 && salience < 0.15 && entry.type === 'episodic') {
		return 'tombstone_episode'
	}

	// 2. Compact raw: moderately old + low salience
	if (!keepWhole && ageDays > 30 && salience < 0.3 && (entry.compressionLevel ?? 0) === 0) {
		return 'compact_raw'
	}

	// 3. Requantize: entry has embedding metadata indicating float32, and is old
	if (
		ageDays > 14 &&
		entry.metadata?.embeddingDim === 384 &&
		entry.metadata?.embeddingDtype !== 'uint8'
	) {
		return 'requantize_embeddings'
	}

	// 4. Deprecate procedure: explicitly superseded by a newer version
	if (
		entry.type === 'procedure' &&
		entry.lifecycleState === 'active' &&
		entry.metadata?.supersededBy
	) {
		return 'deprecate_procedure'
	}

	// 5. Reverify fact: low confidence and few source citations. Skipped once the user has confirmed the
	// fact is still true (metadata.verifiedAt, set when an "out of date?" suggestion is dismissed), so the
	// same fact is not flagged, and asked about, again on every maintenance cycle.
	if (
		(entry.type === 'semantic' || entry.type === 'insight') &&
		(entry.confidence ?? 1) < 0.5 &&
		(entry.sourceIds?.length ?? 0) < 3 &&
		!entry.metadata?.verifiedAt
	) {
		return 'reverify_fact'
	}

	// 7. Demote: any active entry with low salience (not already compressed/archived)
	if (!keepWhole && salience < 0.15 && entry.lifecycleState === 'active') {
		return 'demote_episode'
	}

	return null
}

/**
 * Apply the demote_episode policy: halve the salience score.
 * Mutates the entry.
 */
export function applyDemotePolicy(entry: MemoryEntry): void {
	entry.salience = (entry.salience ?? computeSalience(entry)) * 0.5
	entry.retentionPolicy = 'demote_episode'
	entry.updatedAt = new Date().toISOString()
}

/**
 * Determine whether an entry's embedding should be requantized.
 * Called during batch retention scans; returns true for entries that qualify.
 */
export function shouldRequantize(entry: MemoryEntry, totalEntryCount: number): boolean {
	// Proxy for "storage > 85% quota": trigger requantize when total entries > 8,500
	// (assuming ~85% of a 10,000-entry soft quota).
	const quotaThreshold = 8_500
	if (totalEntryCount < quotaThreshold) return false

	const ageDays = (Date.now() - new Date(entry.createdAt).getTime()) / 86_400_000
	// Requantize entries older than 7 days that still have float32 embeddings
	return ageDays > 7 && entry.metadata?.embeddingDtype !== 'uint8'
}
