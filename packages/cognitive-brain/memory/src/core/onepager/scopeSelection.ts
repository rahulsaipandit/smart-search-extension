import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry, MemoryType } from '../../types'
import type { InProcessGraph } from '../graph/InProcessGraph'

/**
 * Stage 1 of OnePagerSynthesizer.regenerate() - designCognitiveBrain.md
 * §17.3.3. Graph-seeded scope: find "what's currently hot" (highest-salience
 * recent entries), then walk the entity graph outward from it, so the
 * one-pager covers a coherent neighborhood of related activity instead of an
 * arbitrary top-K salience list that mixes unrelated topics (§17.3.1).
 */

const ONE_PAGER_TYPES: MemoryType[] = [
	'episodic',
	'semantic',
	'insight',
	'procedure',
	'prospective',
]

/**
 * Highest-salience entries created/updated in the last `days`, up to `limit`.
 * Returns the union of their `.entities` as the graph-walk seed set.
 */
export async function topSalienceEntitiesInWindow(
	memory: IMemoryService,
	days = 7,
	limit = 5
): Promise<string[]> {
	const start = new Date(Date.now() - days * 86_400_000).toISOString()
	const page = await memory.list({
		filter: { timeRange: { start } },
		orderBy: 'salience',
		order: 'desc',
		limit,
	})

	const seeds = new Set<string>()
	for (const entry of page.items) {
		for (const entityId of entry.entities ?? []) {
			seeds.add(entityId)
		}
	}
	return Array.from(seeds)
}

/**
 * Depth-2 graph walk from each seed entity (same default as WikiRetriever
 * §6/§8 - depth-1 misses indirect context, depth-3+ adds noise), unioned into
 * a single scope set.
 */
export function expandScope(graph: InProcessGraph, seedEntityIds: string[], depth = 2): string[] {
	const scope = new Set<string>(seedEntityIds)
	for (const seedId of seedEntityIds) {
		for (const neighborId of graph.expandNeighbors(seedId, depth)) {
			scope.add(neighborId)
		}
	}
	return Array.from(scope)
}

/**
 * Collect candidate entries for the one-pager: any entry of a one-pager-eligible
 * type whose `.entities` overlap the scope set, or whose `linkedProcedureIds`
 * reference a scoped procedure entry. Capped at `limit` (default 40, §17.3.2).
 */
export async function collectEntriesLinkedToEntities(
	memory: IMemoryService,
	scopeEntityIds: string[],
	limit = 40
): Promise<MemoryEntry[]> {
	if (scopeEntityIds.length === 0) return []
	const scopeSet = new Set(scopeEntityIds)

	const page = await memory.list({
		filter: { type: ONE_PAGER_TYPES },
		orderBy: 'salience',
		order: 'desc',
		// Over-fetch before the entity-overlap filter narrows the set, same
		// "store limit is a hint only" pattern GoalManager.getGoals() uses.
		limit: limit * 4,
	})

	const linkedProcedureIds = new Set(
		page.items
			.filter((e) => e.type === 'procedure' && (e.entities ?? []).some((id) => scopeSet.has(id)))
			.map((e) => e.id)
	)

	const matches = page.items.filter((entry) => {
		if ((entry.entities ?? []).some((id) => scopeSet.has(id))) return true
		return (entry.linkedProcedureIds ?? []).some((id) => linkedProcedureIds.has(id))
	})

	return matches.slice(0, limit)
}
