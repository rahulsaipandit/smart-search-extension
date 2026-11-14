/**
 * EventGraphProcessor - writes Actor→Event→Target→Context nodes into the
 * knowledge graph (designCognitiveBrain.md §16.8, "Knowledge Graph: Final
 * Approach"). Supersedes the deprecated §16.4 flat typed-predicate-edge
 * proposal.
 *
 * Runs as a single-pass T0/T1 step, not brainapi2's 4-agent extraction swarm
 * (Scout/Observations/Architect/Janitor) - that cost is inappropriate on the
 * synchronous per-entry path for an on-device model. One structured-extraction
 * LLM call writes a minimal event node; richer cross-fact validation/dedup
 * is deferred (see §16.8.2 point 2 - a follow-up, not built here).
 *
 * Without an LLM, predicate/role extraction is skipped entirely rather than
 * guessed - same reasoning as ContradictionResolutionProcessor's no-LLM
 * fallback: a regex heuristic can identify that two entities co-occur
 * (InProcessGraph.wireEntry already does that via 'mentions' edges) but
 * cannot safely infer *which verb relates them* without semantic judgment.
 */
import type { MemoryEntry } from '../../../types'
import { slugify } from '../../graph/InProcessGraph'
import type { CreateableMemoryEntry, IMemoryProcessor, ProcessorContext } from '../IMemoryProcessor'
import { extractJsonObject } from './extractJsonObject'

interface EventExtraction {
	predicate: string
	actor?: string
	target?: string
	context?: string
	confidence: number
}

const CONFIDENCE_THRESHOLD = 0.7

export class EventGraphProcessor implements IMemoryProcessor {
	name = 'event-graph'
	description =
		'Extracts an Actor/Event/Target/Context node from episodic entries (designCognitiveBrain.md §16.8)'

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		return (
			entry.type === 'episodic' &&
			(entry.entities?.length ?? 0) > 0 &&
			!entry.metadata?.eventExtracted
		)
	}

	async process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | CreateableMemoryEntry[] | null> {
		// No graph reference wired in (e.g. a harness that doesn't set it on
		// ProcessorContext) - nothing to attach an event node to. Leave the
		// entry unmarked so a correctly-wired run can still pick it up.
		if (!context.graph) return null

		const llmService = context.llmService
		if (!llmService) {
			await context.memory.update(entry.id, {
				metadata: { ...entry.metadata, eventExtracted: true },
			})
			return null
		}

		let extraction: EventExtraction | null
		try {
			const response = await llmService.complete(this.buildPrompt(entry))
			extraction = this.parseResponse(response, entry.entities ?? [])
		} catch {
			extraction = null
		}

		// An event anchored to neither an actor nor a target has nothing for
		// getEventsForEntity() to traverse to - not worth storing.
		if (
			extraction &&
			extraction.confidence >= CONFIDENCE_THRESHOLD &&
			(extraction.actor || extraction.target)
		) {
			context.graph.createEventNode({
				predicate: extraction.predicate,
				actorId: extraction.actor ? slugify(extraction.actor) : undefined,
				targetId: extraction.target ? slugify(extraction.target) : undefined,
				contextId: extraction.context ? slugify(extraction.context) : undefined,
				occurredAt: entry.createdAt,
				confidence: extraction.confidence,
				sourceEntryId: entry.id,
			})
		}

		await context.memory.update(entry.id, {
			metadata: { ...entry.metadata, eventExtracted: true },
		})
		return null
	}

	// ── LLM extraction ────────────────────────────────────────────────────────

	private buildPrompt(entry: MemoryEntry): string {
		const entities = (entry.entities ?? []).join(', ')
		return `Extract a single Actor-Event-Target-Context fact from this text, using ONLY the listed entities for actor/target/context (or null if none apply).

Text: "${entry.content.slice(0, 400)}"
Known entities: ${entities}

Return JSON only: { "predicate": "<short verb phrase, e.g. 'organized', 'works_at'>", "actor": "<entity name or null>", "target": "<entity name or null>", "context": "<entity name or null>", "confidence": <0-1> }`
	}

	private parseResponse(response: string, knownEntities: string[]): EventExtraction | null {
		const parsed = extractJsonObject<{
			predicate?: unknown
			actor?: unknown
			target?: unknown
			context?: unknown
			confidence?: unknown
		}>(response)
		if (!parsed || typeof parsed.predicate !== 'string' || !parsed.predicate.trim()) return null

		// Only accept actor/target/context values that resolve to an entity this
		// entry actually extracted - refuses to let the LLM invent a node the
		// rest of the graph has no other reference to.
		const knownLower = new Set(knownEntities.map((e) => e.toLowerCase()))
		const resolve = (v: unknown): string | undefined => {
			if (typeof v !== 'string') return undefined
			return knownLower.has(v.toLowerCase()) ? v : undefined
		}

		const confidence =
			typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0

		return {
			predicate: parsed.predicate.trim(),
			actor: resolve(parsed.actor),
			target: resolve(parsed.target),
			context: resolve(parsed.context),
			confidence,
		}
	}
}

export default EventGraphProcessor
