import type { EdgeType, Entity, EventNode, GraphEdge, MemoryEntry } from '../../types'
import { nextId } from '../../utils/nextId'
import { extractEntityRefs } from '../pipeline/processors/T0EntityExtractor'

/**
 * In-process knowledge graph (Phase 1 - mobile/web).
 *
 * Uses an adjacency map backed by memory (not persisted across page reloads
 * unless the caller serializes/deserializes via the store).
 *
 * Desktop Phase 3 will replace this with Neo4j/Memgraph, but through the same interface.
 *
 * Graph building uses a 3-pass algorithm (Smriti design):
 *   Pass 1 - Entity co-occurrence: wire `mentions` edges for entities sharing an entry
 *   Pass 2 - Typed edge inference: promote co-occurrence ≥ 2 pairs to typed edges
 *   Pass 3 - Salience clustering: greedy cluster assignment by edge weight
 */

export class InProcessGraph {
	/** entityId → Entity */
	private entities = new Map<string, Entity>()
	/** "fromId:type:toId" → GraphEdge */
	private edges = new Map<string, GraphEdge>()
	/** entityId → Set<edgeKey> */
	private adjacency = new Map<string, Set<string>>()
	/** eventId → EventNode (designCognitiveBrain.md §16.8) */
	private eventNodes = new Map<string, EventNode>()

	// ── 3-pass state ──────────────────────────────────────────────────────────

	/**
	 * Co-occurrence matrix: entityId → neighborEntityId → count.
	 * Populated by recordCoOccurrences (Pass 1).
	 */
	private coOccurrences = new Map<string, Map<string, number>>()

	/**
	 * Cluster assignments: entityId → clusterId.
	 * Populated by computeClusters (Pass 3).
	 */
	private clusterAssignments = new Map<string, number>()

	// ── Entity management ────────────────────────────────────────────────────

	upsertEntity(entity: Entity): void {
		this.entities.set(entity.id, { ...entity })
	}

	getEntity(id: string): Entity | undefined {
		return this.entities.get(id)
	}

	/** GuideAxon change: every entity node (read-only copies), for MemoryService.listEntities(). */
	listEntities(): Entity[] {
		return Array.from(this.entities.values(), (e) => ({ ...e }))
	}

	findEntityByName(name: string): Entity | undefined {
		const lower = name.toLowerCase()
		for (const entity of this.entities.values()) {
			if (
				entity.name.toLowerCase() === lower ||
				entity.aliases?.some((a) => a.toLowerCase() === lower)
			) {
				return entity
			}
		}
		return undefined
	}

	// ── Edge management ──────────────────────────────────────────────────────

	createEdge(from: string, type: EdgeType, to: string, weight = 1.0): GraphEdge {
		const key = `${from}:${type}:${to}`
		const existing = this.edges.get(key)
		if (existing) {
			// Strengthen existing edge
			existing.weight = Math.min(1.0, existing.weight + weight * 0.1)
			return existing
		}
		const edge: GraphEdge = { from, type, to, weight, createdAt: new Date().toISOString() }
		this.edges.set(key, edge)

		if (!this.adjacency.has(from)) this.adjacency.set(from, new Set())
		if (!this.adjacency.has(to)) this.adjacency.set(to, new Set())
		this.adjacency.get(from)!.add(key)
		this.adjacency.get(to)!.add(key)

		return edge
	}

	/** Remove one edge; returns whether it existed. */
	removeEdge(from: string, type: EdgeType, to: string): boolean {
		const key = `${from}:${type}:${to}`
		if (!this.edges.delete(key)) return false
		this.adjacency.get(from)?.delete(key)
		this.adjacency.get(to)?.delete(key)
		return true
	}

	getEdges(nodeId: string, type?: EdgeType): GraphEdge[] {
		const keys = this.adjacency.get(nodeId) ?? new Set()
		const result: GraphEdge[] = []
		for (const key of keys) {
			const edge = this.edges.get(key)
			if (edge && (!type || edge.type === type)) {
				result.push(edge)
			}
		}
		return result
	}

	removeWeakEdges(minWeight = 0.1): number {
		let removed = 0
		for (const [key, edge] of this.edges) {
			if (edge.weight < minWeight) {
				this.edges.delete(key)
				this.adjacency.get(edge.from)?.delete(key)
				this.adjacency.get(edge.to)?.delete(key)
				removed++
			}
		}
		return removed
	}

	// ── Event-centric graph (designCognitiveBrain.md §16.8) ──────────────────

	/**
	 * Create an event hub node and wire its role edges to existing entity/event
	 * nodes: actor --event_actor--> event --event_target--> target,
	 * event --event_context--> context. actorId/targetId/contextId are all
	 * optional — a partially-resolved event (e.g. no context anchor found) is
	 * still stored, just with fewer edges.
	 */
	createEventNode(input: Omit<EventNode, 'id' | 'createdAt'>): EventNode {
		const node: EventNode = { ...input, id: nextId('event'), createdAt: new Date().toISOString() }
		this.eventNodes.set(node.id, node)

		if (node.actorId) this.createEdge(node.actorId, 'event_actor', node.id)
		if (node.targetId) this.createEdge(node.id, 'event_target', node.targetId)
		if (node.contextId) this.createEdge(node.id, 'event_context', node.contextId)

		return node
	}

	getEventNode(id: string): EventNode | undefined {
		return this.eventNodes.get(id)
	}

	/**
	 * Find events where the given entity participates in the given role
	 * (or any role, if omitted). Used by retrieval to answer "what happened
	 * involving X" without a full graph scan.
	 */
	getEventsForEntity(entityId: string, role?: 'actor' | 'target' | 'context'): EventNode[] {
		const roleToEdgeType: Record<'actor' | 'target' | 'context', EdgeType> = {
			actor: 'event_actor',
			target: 'event_target',
			context: 'event_context',
		}
		const roles = role ? [role] : (['actor', 'target', 'context'] as const)

		const eventIds = new Set<string>()
		for (const r of roles) {
			for (const edge of this.getEdges(entityId, roleToEdgeType[r])) {
				const eventId = edge.from === entityId ? edge.to : edge.from
				if (this.eventNodes.has(eventId)) eventIds.add(eventId)
			}
		}

		return Array.from(eventIds, (id) => this.eventNodes.get(id)!)
	}

	get eventStats(): { hotEventCount: number } {
		return { hotEventCount: this.eventNodes.size }
	}

	/**
	 * Bound the hot, actively-traversable event graph (designCognitiveBrain.md
	 * §16.8.2 point 5 — event-hub graphs grow with conversation volume, not
	 * distinct-entity count, and unbounded growth degrades depth-2 traversal).
	 *
	 * Events older than `maxAgeMs`, beyond the `maxHotEvents` most-recent cap,
	 * are removed from the hot graph and rolled up into one summary EventNode
	 * per actor (the shared dimension most queries traverse on). Raw events are
	 * NOT deleted from the returned `archived` list — the caller is responsible
	 * for pushing them to the vault (Tier 3) before discarding, preserving the
	 * append-only/audit property outside the hot local index.
	 */
	pruneStaleEvents(
		now: number,
		maxAgeMs: number,
		maxHotEvents: number
	): { archived: EventNode[]; summaries: EventNode[] } {
		const all = Array.from(this.eventNodes.values())
			.filter((e) => !e.isSummary)
			.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())

		// "Hot" = within the age window AND within the recency-rank cap - both
		// limits apply, not just whichever is larger, so a low-volume graph
		// still ages entries out even though it never hits the count cap.
		const withinAge = all.filter((e) => now - new Date(e.occurredAt).getTime() <= maxAgeMs)
		const hotIds = new Set(withinAge.slice(0, maxHotEvents).map((e) => e.id))
		const stale = all.filter((e) => !hotIds.has(e.id))
		if (stale.length === 0) return { archived: [], summaries: [] }

		// Group by actor (falling back to a shared bucket for actor-less events)
		// rather than a full computeClusters() pass — events don't participate in
		// entity co-occurrence the same way, and per-actor is the dimension
		// getEventsForEntity() traverses on.
		const byActor = new Map<string, EventNode[]>()
		for (const event of stale) {
			const key = event.actorId ?? '__unattributed__'
			if (!byActor.has(key)) byActor.set(key, [])
			byActor.get(key)!.push(event)
		}

		const summaries: EventNode[] = []
		for (const [actorId, events] of byActor) {
			const avgConfidence = events.reduce((s, e) => s + e.confidence, 0) / events.length
			const summary = this.createEventNode({
				predicate: 'summary',
				actorId: actorId === '__unattributed__' ? undefined : actorId,
				occurredAt: events[0]!.occurredAt,
				confidence: avgConfidence,
				sourceEntryId: events.map((e) => e.sourceEntryId).join(','),
				isSummary: true,
				summarizedEventIds: events.map((e) => e.id),
			})
			summaries.push(summary)
		}

		// Remove raw stale events from the hot graph: drop their role edges and
		// the node itself. They're already captured in `archived` for the caller.
		for (const event of stale) {
			for (const edge of this.getEdges(event.id)) {
				const key = `${edge.from}:${edge.type}:${edge.to}`
				this.edges.delete(key)
				this.adjacency.get(edge.from)?.delete(key)
				this.adjacency.get(edge.to)?.delete(key)
			}
			this.eventNodes.delete(event.id)
		}

		return { archived: stale, summaries }
	}

	// ── Self-wiring on episodic writes ───────────────────────────────────────

	/**
	 * Called on every episodic memory write (T0 - zero LLM cost).
	 * Extracts entity references from content and wires 'mentions' edges.
	 */
	wireEntry(entry: MemoryEntry): void {
		const text = [entry.title ?? '', entry.content].join(' ')
		const refs = extractEntityRefs(text)

		const entityIds: string[] = []
		for (const ref of refs) {
			// Ensure entity node exists
			const entityId = slugify(ref.name)
			if (!this.entities.has(entityId)) {
				this.upsertEntity({
					id: entityId,
					name: ref.name,
					type: ref.type as Entity['type'],
				})
			}
			entityIds.push(entityId)
			// Wire 'mentions' edge
			this.createEdge(entry.id, 'mentions', entityId)
		}

		// Also record co-occurrences inline for incremental updates
		if (entityIds.length > 1) {
			this.recordCoOccurrences(entry.id, entityIds)
		}
	}

	// ── 3-pass graph building ─────────────────────────────────────────────────

	/**
	 * Run all 3 passes over a batch of entries. Call after bulk loading.
	 *
	 * Pass 1: entity co-occurrence per entry
	 * Pass 2: typed edge inference from accumulated co-occurrence
	 * Pass 3: salience-based cluster assignment
	 */
	buildGraph(entries: { id: string; entities: string[]; type: string }[]): void {
		// Pass 1
		for (const entry of entries) {
			const entityIds = entry.entities.map((name) => slugify(name))

			// Ensure entity nodes exist (we only have name, infer type from pass-1 data)
			for (let i = 0; i < entry.entities.length; i++) {
				const entityId = entityIds[i]!
				if (!this.entities.has(entityId)) {
					this.upsertEntity({
						id: entityId,
						name: entry.entities[i]!,
						type: inferEntityType(entry.entities[i]!),
					})
				}
				// Wire mentions edge from entry to entity
				this.createEdge(entry.id, 'mentions', entityId)
			}

			this.recordCoOccurrences(entry.id, entityIds)
		}

		// Pass 2
		this.inferTypedEdges()

		// Pass 3
		this.computeClusters()
	}

	/**
	 * Pass 1: record entity co-occurrences from a single entry.
	 * All entity pairs that appear together in the same entry get their co-occurrence
	 * count incremented.
	 */
	recordCoOccurrences(entryId: string, entityIds: string[]): void {
		// Create an explicit `mentions` edge to the entry so we can trace provenance
		for (const entityId of entityIds) {
			if (!this.entities.has(entityId)) {
				this.upsertEntity({ id: entityId, name: entityId, type: 'other' })
			}
		}

		// Record all pairwise co-occurrences
		for (let i = 0; i < entityIds.length; i++) {
			const a = entityIds[i]!
			if (!this.coOccurrences.has(a)) this.coOccurrences.set(a, new Map())
			const aMap = this.coOccurrences.get(a)!

			for (let j = i + 1; j < entityIds.length; j++) {
				const b = entityIds[j]!
				if (!this.coOccurrences.has(b)) this.coOccurrences.set(b, new Map())
				const bMap = this.coOccurrences.get(b)!

				// Increment both directions for O(1) lookup
				aMap.set(b, (aMap.get(b) ?? 0) + 1)
				bMap.set(a, (bMap.get(a) ?? 0) + 1)
			}
		}
	}

	/**
	 * Pass 2: infer typed edges from accumulated co-occurrence data.
	 * For every entity pair with co-occurrence ≥ 2, create a typed edge based on
	 * entity types:
	 *   person + organization → works_at (0.6)
	 *   person + project      → owns (0.6)
	 *   project + system      → depends_on (0.5)
	 *   system + system       → depends_on (0.5)
	 *   person + person       → references (0.4)
	 */
	inferTypedEdges(): void {
		for (const [entityIdA, neighbors] of this.coOccurrences) {
			const entityA = this.entities.get(entityIdA)
			if (!entityA) continue

			for (const [entityIdB, count] of neighbors) {
				if (count < 2) continue
				if (entityIdA >= entityIdB) continue // process each pair once

				const entityB = this.entities.get(entityIdB)
				if (!entityB) continue

				const typedEdge = inferEdgeType(entityA.type, entityB.type)
				if (!typedEdge) continue

				const { edgeType, weight, fromId, toId } = resolveEdgeDirection(
					entityIdA,
					entityA.type,
					entityIdB,
					entityB.type,
					typedEdge.edgeType,
					typedEdge.weight
				)

				this.createEdge(fromId, edgeType, toId, weight)
			}
		}
	}

	/**
	 * Pass 3: compute salience-based clustering.
	 * Assigns cluster IDs to entities. Entities with edge weight > 0.5 to a
	 * cluster representative are in the same cluster.
	 *
	 * Returns a map of entityId → clusterId.
	 */
	computeClusters(): Map<string, number> {
		this.clusterAssignments.clear()

		// Score entities by degree (number of edges) - higher degree = better representative
		const degrees = new Map<string, number>()
		for (const entityId of this.entities.keys()) {
			const edgeCount = (this.adjacency.get(entityId) ?? new Set()).size
			degrees.set(entityId, edgeCount)
		}

		// Sort entities by degree descending to process high-degree nodes first
		const sortedEntityIds = Array.from(this.entities.keys()).sort(
			(a, b) => (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0)
		)

		let nextClusterId = 0

		for (const entityId of sortedEntityIds) {
			if (this.clusterAssignments.has(entityId)) continue

			// This entity becomes a cluster representative
			const clusterId = nextClusterId++
			this.clusterAssignments.set(entityId, clusterId)

			// Assign all neighbors with edge weight > 0.5 to this cluster
			for (const edge of this.getEdges(entityId)) {
				if (edge.weight <= 0.5) continue

				const neighborId = edge.from === entityId ? edge.to : edge.from
				// Only assign to entity nodes (not memory entry nodes)
				if (!this.entities.has(neighborId)) continue
				if (!this.clusterAssignments.has(neighborId)) {
					this.clusterAssignments.set(neighborId, clusterId)
				}
			}
		}

		return new Map(this.clusterAssignments)
	}

	/**
	 * Get all entities in the same cluster as the given entity.
	 * Returns entity IDs (not including the queried entity itself).
	 */
	getCluster(entityId: string): string[] {
		const clusterId = this.clusterAssignments.get(entityId)
		if (clusterId === undefined) return []

		const result: string[] = []
		for (const [id, cId] of this.clusterAssignments) {
			if (id !== entityId && cId === clusterId) {
				result.push(id)
			}
		}
		return result
	}

	// ── Traversal ────────────────────────────────────────────────────────────

	/**
	 * Expand neighbors of a node up to `depth` hops.
	 * Returns node IDs (both memory entries and entities).
	 */
	expandNeighbors(nodeId: string, depth = 2): string[] {
		const visited = new Set<string>()
		const queue: { id: string; d: number }[] = [{ id: nodeId, d: 0 }]
		// Index cursor instead of Array.shift(): shift() re-indexes the entire
		// remaining array on every call, making BFS O(frontier²) instead of
		// O(frontier) - invisible at the graph's original ~1,000-node benchmark
		// scale (§3.3) but catastrophic once a hub entity's degree reaches the
		// thousands (exactly the event-hub fan-out scenario §16.8.2 flagged as
		// a risk to verify - see benchmarks/eventGraphTraversal.bench.ts).
		let head = 0

		while (head < queue.length) {
			const item = queue[head++]!
			if (visited.has(item.id) || item.d > depth) continue
			visited.add(item.id)

			for (const edge of this.getEdges(item.id)) {
				const neighbor = edge.from === item.id ? edge.to : edge.from
				if (!visited.has(neighbor)) {
					queue.push({ id: neighbor, d: item.d + 1 })
				}
			}
		}

		visited.delete(nodeId)
		return Array.from(visited)
	}

	// ── Serialization ─────────────────────────────────────────────────────────

	serialize(): { entities: Entity[]; edges: GraphEdge[]; eventNodes: EventNode[] } {
		return {
			entities: Array.from(this.entities.values()),
			edges: Array.from(this.edges.values()),
			eventNodes: Array.from(this.eventNodes.values()),
		}
	}

	deserialize(data: { entities: Entity[]; edges: GraphEdge[]; eventNodes?: EventNode[] }): void {
		this.entities.clear()
		this.edges.clear()
		this.adjacency.clear()
		this.coOccurrences.clear()
		this.clusterAssignments.clear()
		this.eventNodes.clear()

		for (const entity of data.entities) {
			this.upsertEntity(entity)
		}
		// Restore event nodes before edges so role edges referencing an event id
		// resolve against a populated eventNodes map (getEventsForEntity relies
		// on membership there, not just adjacency).
		for (const event of data.eventNodes ?? []) {
			this.eventNodes.set(event.id, event)
		}
		for (const edge of data.edges) {
			this.createEdge(edge.from, edge.type, edge.to, edge.weight)
		}
	}

	get stats(): { entityCount: number; edgeCount: number; eventCount: number } {
		return {
			entityCount: this.entities.size,
			edgeCount: this.edges.size,
			eventCount: this.eventNodes.size,
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Canonical entity-id normalization - exported so callers that need to derive
 * the same id an entity was wired under (MemoryService, EventGraphProcessor)
 * import this instead of re-declaring their own copy. Keeping one definition
 * means a future change here (e.g. Unicode name handling) can't silently drift
 * out of sync with a second copy and break id matching for those callers.
 */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
}

type EntityType = Entity['type']

/**
 * Given two entity types, return the preferred typed edge and its weight.
 * Returns null if no typed edge applies.
 */
function inferEdgeType(
	typeA: EntityType,
	typeB: EntityType
): { edgeType: EdgeType; weight: number; personFirst?: boolean } | null {
	const pair = [typeA, typeB].sort().join('+') as string

	const rules: Record<string, { edgeType: EdgeType; weight: number; personFirst?: boolean }> = {
		'organization+person': { edgeType: 'works_at', weight: 0.6, personFirst: true },
		'person+project': { edgeType: 'owns', weight: 0.6, personFirst: true },
		'project+system': { edgeType: 'depends_on', weight: 0.5, personFirst: false },
		'system+system': { edgeType: 'depends_on', weight: 0.5 },
		'person+person': { edgeType: 'references', weight: 0.4 },
	}

	return rules[pair] ?? null
}

/**
 * Determine the canonical direction for a typed edge.
 * Some edges are directional (person → organization for works_at).
 */
function resolveEdgeDirection(
	idA: string,
	typeA: EntityType,
	idB: string,
	typeB: EntityType,
	edgeType: EdgeType,
	weight: number
): { fromId: string; toId: string; edgeType: EdgeType; weight: number } {
	// For works_at: person → organization
	if (edgeType === 'works_at') {
		const personId = typeA === 'person' ? idA : idB
		const orgId = typeA === 'organization' ? idA : idB
		return { fromId: personId, toId: orgId, edgeType, weight }
	}
	// For owns: person → project
	if (edgeType === 'owns') {
		const personId = typeA === 'person' ? idA : idB
		const projectId = typeA === 'project' ? idA : idB
		return { fromId: personId, toId: projectId, edgeType, weight }
	}
	// For depends_on: project → system, or system → system (alphabetical for determinism)
	if (edgeType === 'depends_on') {
		if (typeA === 'project' || (typeA === 'system' && idA <= idB)) {
			return { fromId: idA, toId: idB, edgeType, weight }
		}
		return { fromId: idB, toId: idA, edgeType, weight }
	}
	// Default: alphabetical order for determinism
	if (idA <= idB) {
		return { fromId: idA, toId: idB, edgeType, weight }
	}
	return { fromId: idB, toId: idA, edgeType, weight }
}

/**
 * Heuristic: infer entity type from the entity name when no explicit type is available.
 * Used when buildGraph receives entity names without type metadata.
 */
function inferEntityType(name: string): EntityType {
	// CamelCase → likely a system/tech term
	if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(name)) return 'system'
	// Contains @ → email / person
	if (name.includes('@')) return 'person'
	// All caps short → likely a system or concept
	if (/^[A-Z]{2,8}$/.test(name)) return 'concept'
	// Title-case multi-word → person or organization
	if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(name)) return 'person'
	return 'concept'
}
