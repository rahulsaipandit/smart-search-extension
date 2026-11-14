/**
 * Verification gate called for in designCognitiveBrain.md §16.8.2:
 *
 *   "re-run the depth-2 traversal benchmark synthetically at 10k and 100k
 *   nodes with realistic (non-uniform) degree skew. If it doesn't hold up
 *   under the hot-window + degree-cap mitigations above, that's a signal to
 *   tighten the window further before writing extraction code, not after."
 *
 * §3.3's existing figure (~5-10ms at 1,000 UNIFORM-degree nodes) doesn't
 * transfer to the event graph: event-hub graphs grow with conversation
 * volume, not distinct-entity count, and real usage concentrates on a small
 * number of hub entities (self, close family, employer, 1-2 active
 * projects) - Zipfian, not uniform. This benchmark builds that skew
 * deliberately and measures expandNeighbors() from a worst-case hub entity,
 * both with and without the pruneStaleEvents() mitigation from §16.8.2
 * point 5.
 *
 * Run: npx tsx benchmarks/eventGraphTraversal.bench.ts
 */
import { InProcessGraph } from '../src/core/graph/InProcessGraph'

// ── Synthetic corpus generation ─────────────────────────────────────────────

/** Small distinct-entity pool (realistic: a few hundred people/projects/places over years), Zipfian-weighted so a handful of hub entities dominate. */
function buildEntityPool(size: number): string[] {
	return Array.from({ length: size }, (_, i) => `entity-${i}`)
}

/** Zipfian sampler: index 0 is ~size× more likely than the last index. Approximates the "small number of hub entities" real usage pattern. */
function makeZipfSampler(size: number): () => number {
	const weights = Array.from({ length: size }, (_, i) => 1 / (i + 1))
	const total = weights.reduce((a, b) => a + b, 0)
	const cumulative: number[] = []
	let running = 0
	for (const w of weights) {
		running += w
		cumulative.push(running / total)
	}
	return () => {
		const r = Math.random()
		for (let i = 0; i < cumulative.length; i++) {
			if (r <= cumulative[i]!) return i
		}
		return cumulative.length - 1
	}
}

function daysAgoIso(days: number): string {
	return new Date(Date.now() - days * 86_400_000).toISOString()
}

/**
 * Builds a graph of `eventCount` events over `entityPoolSize` distinct
 * entities, spread over `spanDays`, with Zipfian actor/target selection.
 */
function buildSyntheticGraph(
	eventCount: number,
	entityPoolSize: number,
	spanDays: number
): { graph: InProcessGraph; hubEntityId: string; typicalEntityId: string } {
	const graph = new InProcessGraph()
	const pool = buildEntityPool(entityPoolSize)
	for (const id of pool) {
		graph.upsertEntity({ id, name: id, type: 'concept' })
	}

	const sample = makeZipfSampler(entityPoolSize)

	for (let i = 0; i < eventCount; i++) {
		const actorIdx = sample()
		let targetIdx = sample()
		if (targetIdx === actorIdx) targetIdx = (targetIdx + 1) % entityPoolSize
		const hasContext = Math.random() < 0.4
		const contextIdx = hasContext ? sample() : -1

		graph.createEventNode({
			predicate: 'interacted',
			actorId: pool[actorIdx]!,
			targetId: pool[targetIdx]!,
			contextId: contextIdx >= 0 ? pool[contextIdx]! : undefined,
			occurredAt: daysAgoIso(Math.random() * spanDays),
			confidence: 0.7 + Math.random() * 0.3,
			sourceEntryId: `entry-${i}`,
		})
	}

	// Index 0 is the Zipfian-favored hub entity by construction; pick a
	// mid-pool entity as the "typical" (low-degree) comparison point.
	return { graph, hubEntityId: pool[0]!, typicalEntityId: pool[Math.floor(entityPoolSize / 2)]! }
}

// ── Timing helper ────────────────────────────────────────────────────────────

function timeMs(fn: () => void): number {
	const start = process.hrtime.bigint()
	fn()
	const end = process.hrtime.bigint()
	return Number(end - start) / 1_000_000
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function benchmarkTraversal(
	graph: InProcessGraph,
	nodeId: string,
	runs = 20
): { medianMs: number; maxMs: number } {
	const samples: number[] = []
	for (let i = 0; i < runs; i++) {
		samples.push(timeMs(() => graph.expandNeighbors(nodeId, 2)))
	}
	return { medianMs: median(samples), maxMs: Math.max(...samples) }
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

const ENTITY_POOL_SIZE = 300 // "a few hundred distinct people/projects/places over years" per §16.8's sizing model
const HOT_WINDOW_DAYS = 90
const HOT_CAP = 500

function runScenario(eventCount: number, spanDays: number): void {
	console.log(
		`\n=== ${eventCount.toLocaleString()} events over ${spanDays} days (unbounded, no rollup) ===`
	)
	const { graph, hubEntityId, typicalEntityId } = buildSyntheticGraph(
		eventCount,
		ENTITY_POOL_SIZE,
		spanDays
	)

	const hubDegree = graph.getEdges(hubEntityId).length
	const typicalDegree = graph.getEdges(typicalEntityId).length
	console.log(`hub entity degree: ${hubDegree}, typical entity degree: ${typicalDegree}`)

	const hubResult = benchmarkTraversal(graph, hubEntityId)
	const typicalResult = benchmarkTraversal(graph, typicalEntityId)
	console.log(
		`depth-2 traversal FROM HUB:     median ${hubResult.medianMs.toFixed(2)}ms, max ${hubResult.maxMs.toFixed(2)}ms`
	)
	console.log(
		`depth-2 traversal from typical: median ${typicalResult.medianMs.toFixed(2)}ms, max ${typicalResult.maxMs.toFixed(2)}ms`
	)

	// Apply the §16.8.2 point 5 mitigation and re-measure.
	const { archived } = graph.pruneStaleEvents(Date.now(), HOT_WINDOW_DAYS * 86_400_000, HOT_CAP)
	console.log(
		`\n--- after pruneStaleEvents(maxAge=${HOT_WINDOW_DAYS}d, maxHot=${HOT_CAP}): archived ${archived.length}, hot graph now ${graph.stats.eventCount} events ---`
	)
	const hubDegreeAfter = graph.getEdges(hubEntityId).length
	console.log(`hub entity degree after rollup: ${hubDegreeAfter}`)

	const hubResultAfter = benchmarkTraversal(graph, hubEntityId)
	console.log(
		`depth-2 traversal FROM HUB (bounded): median ${hubResultAfter.medianMs.toFixed(2)}ms, max ${hubResultAfter.maxMs.toFixed(2)}ms`
	)
}

console.log(
	'Event-hub graph traversal benchmark (designCognitiveBrain.md §16.8.2 verification gate)'
)
console.log(
	`Entity pool: ${ENTITY_POOL_SIZE} distinct entities, Zipfian actor/target selection (hub-skewed)`
)
console.log(
	'Baseline for comparison: §3.3 measured ~5-10ms for depth-2 traversal at 1,000 UNIFORM-degree nodes'
)

// Heavy user, 1 year (~11,000 events/year per §16.8's sizing model)
runScenario(10_000, 365)
// Heavy user, ~3 years - the horizon the sizing analysis flagged as the risk zone
runScenario(100_000, 3 * 365)
