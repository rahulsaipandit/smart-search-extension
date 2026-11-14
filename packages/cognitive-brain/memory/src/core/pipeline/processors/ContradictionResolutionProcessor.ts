/**
 * ContradictionResolutionProcessor - write-time fact supersession via version chain.
 *
 * designCognitiveBrain.md §16.2 (Supermemory comparison). Closes a gap named in
 * docs/Memory/designMemory.md V3's own "deferred gaps" list: the `contradicts`
 * relation existed in the schema but no processor acted on it.
 *
 * Reuses the existing `parent`/`child` version-chain relation (the same
 * mechanism ProcedureEvolutionProcessor already uses for procedure versioning)
 * instead of a separate `metadata.supersededBy` flag - one versioning code
 * path shared by facts and procedures, not two.
 *
 * Three possible outcomes when a new durable entry matches an existing one on
 * the same subject (shared entity):
 *   - 'same'    -> near-identical restatement. No new relation; the existing
 *                  entry's metadata.restatementCount is incremented instead
 *                  (feeds the reinforcement_boost salience term, §16.3).
 *   - 'updates' -> the new fact conflicts with and supersedes the old one.
 *                  New entry gets a `parent` relation to the old one; old
 *                  entry gets a `child` relation to the new one and is marked
 *                  deprecated. Never deleted - the chain itself is the audit
 *                  trail (on top of the existing mutation log).
 *   - 'extends' -> the new fact adds detail without conflicting. Both entries
 *                  get an `extends` relation to each other; neither is
 *                  superseded.
 *
 * Classification uses the LLM when available, gated at confidence >= 0.7 (the
 * same threshold ProcedureEvolutionProcessor uses for patch validation). With
 * no LLM, only a high-confidence word-overlap 'same' match is acted on -
 * 'updates'/'extends' without LLM confirmation default to no-op, matching the
 * "don't destructively guess" pattern already used by the wiki system's
 * wikilink validation.
 */
import type { MemoryEntry } from '../../../types'
import type { CreateableMemoryEntry, IMemoryProcessor, ProcessorContext } from '../IMemoryProcessor'
import { extractJsonObject } from './extractJsonObject'

interface Classification {
	kind: 'same' | 'updates' | 'extends' | 'unrelated'
	confidence: number
}

/**
 * Optional typed-decision refinement (docs/Misc/designJEVMisc.md fit #1). Receives `getBaseline`, a
 * memoized function returning the processor's own classification (an LLM call when one is configured), so
 * a refiner that answers confidently never pays for that call; it awaits it only when it needs the baseline
 * (for example to record it in shadow mode). Returns a replacement, or null to keep the baseline. At most
 * `maxRefinedCandidates` (default 3) candidates per new entry are refined; the rest use the baseline, which
 * bounds the extra calls per memory write. A replacement has already
 * passed the refiner's own floors, so CONFIDENCE_THRESHOLD (which calibrates the LLM baseline) does not
 * apply to it. A refined 'updates' (destructive: it deprecates a stored fact) is always handed to
 * `onProposal` for the user to accept and never applied here, whether or not the refiner set
 * `needsProposal`. Failures and null results keep the baseline (old behavior).
 */
export interface ContradictionOptions {
	refine?: (
		entry: MemoryEntry,
		candidate: MemoryEntry,
		getBaseline: () => Promise<Classification>
	) => Promise<(Classification & { needsProposal?: boolean }) | null>
	maxRefinedCandidates?: number
	onProposal?: (
		entry: MemoryEntry,
		candidate: MemoryEntry,
		kind: Classification['kind'],
		confidence: number
	) => void | Promise<void>
}

const CONFIDENCE_THRESHOLD = 0.7
const DEFAULT_MAX_REFINED_CANDIDATES = 3

export class ContradictionResolutionProcessor implements IMemoryProcessor {
	name = 'contradiction-resolution'
	description = 'Write-time fact supersession/enrichment via parent/child version chain (§16.2)'

	// Serializes metadata read-modify-write against the same target entry id.
	// context.memory.update() is an unsynchronized get-then-put, and Pipeline
	// runs up to maxParallel entries concurrently - without this, two near-
	// simultaneous restatements of the same fact could both read
	// restatementCount = N and both write back N+1, losing an increment.
	private readonly pendingUpdates = new Map<string, Promise<unknown>>()

	private readonly options: ContradictionOptions

	constructor(options: ContradictionOptions = {}) {
		this.options = options
	}

	private async serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
		const prior = this.pendingUpdates.get(id) ?? Promise.resolve()
		const run = prior.then(fn, fn)
		const settled = run.then(
			() => undefined,
			() => undefined
		)
		this.pendingUpdates.set(id, settled)
		try {
			return await run
		} finally {
			// Only clean up if nothing else has chained after us for this id.
			if (this.pendingUpdates.get(id) === settled) this.pendingUpdates.delete(id)
		}
	}

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		return (
			entry.isDurable === true &&
			(entry.entities?.length ?? 0) > 0 &&
			!entry.metadata?.contradictionChecked
		)
	}

	async process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | CreateableMemoryEntry[] | null> {
		// Step 4 (store.put/index.index) already persisted `entry` before this
		// pluggable-processor step runs - a returned partial object would only
		// mutate the in-memory object, never get re-saved. Persist explicitly via
		// context.memory.update(), same pattern as DecayProcessor/ImportanceProcessor.
		const candidates = await this.findCandidates(entry, context)
		const maxRefined = this.options.maxRefinedCandidates ?? DEFAULT_MAX_REFINED_CANDIDATES
		let refinedCount = 0

		for (const candidate of candidates) {
			const allowRefine = !!this.options.refine && refinedCount < maxRefined
			if (allowRefine) refinedCount++
			const classification = await this.classify(entry, candidate, context, allowRefine)
			if (!classification.refined && classification.confidence < CONFIDENCE_THRESHOLD) continue

			if (
				(classification.refined || classification.needsProposal) &&
				classification.kind === 'updates'
			) {
				// Queue for the user; do not deprecate anything, keep looking at other candidates.
				await this.options.onProposal?.(
					entry,
					candidate,
					classification.kind,
					classification.confidence
				)
				continue
			}

			if (classification.kind === 'same') {
				await this.serialize(candidate.id, async () => {
					// Re-read under the lock rather than trusting the `candidate` object
					// captured before this async classification step - another
					// concurrent process() call could have updated it in the meantime.
					const fresh = (await context.memory.get(candidate.id)) ?? candidate
					const restatementCount = ((fresh.metadata?.restatementCount as number) ?? 0) + 1
					await context.memory.update(candidate.id, {
						metadata: { ...fresh.metadata, restatementCount },
					})
				})
				await context.memory.update(entry.id, {
					metadata: { ...entry.metadata, contradictionChecked: true, mergedInto: candidate.id },
				})
				return null
			}

			if (classification.kind === 'updates') {
				await context.memory.addRelation(entry.id, {
					type: 'parent',
					targetId: candidate.id,
					metadata: { confidence: classification.confidence },
				})
				await context.memory.addRelation(candidate.id, { type: 'child', targetId: entry.id })
				await context.memory.update(candidate.id, { lifecycleState: 'deprecated' })
				await context.memory.update(entry.id, {
					metadata: { ...entry.metadata, contradictionChecked: true },
				})
				return null
			}

			if (classification.kind === 'extends') {
				await context.memory.addRelation(entry.id, { type: 'extends', targetId: candidate.id })
				await context.memory.addRelation(candidate.id, { type: 'extends', targetId: entry.id })
				await context.memory.update(entry.id, {
					metadata: { ...entry.metadata, contradictionChecked: true },
				})
				return null
			}
		}

		// No qualifying candidate found - mark checked so future pipeline passes
		// over this entry don't re-scan the whole search index for nothing.
		await context.memory.update(entry.id, {
			metadata: { ...entry.metadata, contradictionChecked: true },
		})
		return null
	}

	// ── Candidate search ──────────────────────────────────────────────────────

	private async findCandidates(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<MemoryEntry[]> {
		// No type filter: the promotion pipeline creates 'semantic'/'insight'
		// entries from 'episodic' ones, so a fact restated at one tier must still
		// be matchable against its own promoted form at another tier - filtering
		// by entry.type would make contradiction/enrichment detection blind to
		// exactly the entries most likely to already hold the same fact.
		const page = await context.memory.search(entry.content, { topK: 8 })

		const entrySet = new Set((entry.entities ?? []).map((e) => e.toLowerCase()))

		return page.items
			.map((i) => i.entry)
			.filter(
				(c) =>
					c.id !== entry.id &&
					// Accept undefined (entries written before this field existed) as
					// well as true - only explicit `isDurable: false` disqualifies a
					// candidate. Excluding undefined would make every pre-existing
					// entry permanently ineligible as a supersession/enrichment target.
					c.isDurable !== false &&
					!(c.relations ?? []).some((r) => r.type === 'child') && // already superseded - not a valid target
					(c.entities ?? []).some((e) => entrySet.has(e.toLowerCase()))
			)
	}

	// ── Classification ────────────────────────────────────────────────────────

	private async classify(
		entry: MemoryEntry,
		candidate: MemoryEntry,
		context: ProcessorContext,
		allowRefine = true
	): Promise<Classification & { needsProposal?: boolean; refined?: boolean }> {
		// Memoized: computed at most once, and only if the refiner asks for it or has no answer.
		let baseline: Promise<Classification> | null = null
		const getBaseline = () => (baseline ??= this.classifyBaseline(entry, candidate, context))
		if (!this.options.refine || !allowRefine) return getBaseline()
		try {
			const refined = await this.options.refine(entry, candidate, getBaseline)
			if (refined) return { ...refined, refined: true }
		} catch {
			// Fall through to the baseline.
		}
		return getBaseline()
	}

	private async classifyBaseline(
		entry: MemoryEntry,
		candidate: MemoryEntry,
		context: ProcessorContext
	): Promise<Classification> {
		const llmService = context.llmService
		if (!llmService) return this.classifyWithoutLLM(entry, candidate)

		try {
			const prompt = this.buildPrompt(entry, candidate)
			const response = await llmService.complete(prompt)
			const parsed = this.parseResponse(response)
			if (parsed) return parsed
		} catch {
			// Fall through to the no-LLM heuristic on any failure.
		}
		return this.classifyWithoutLLM(entry, candidate)
	}

	private buildPrompt(entry: MemoryEntry, candidate: MemoryEntry): string {
		return `Two statements about the same subject. Classify their relationship.

Existing statement: "${candidate.content.slice(0, 300)}"
New statement: "${entry.content.slice(0, 300)}"

- "same": the new statement is a near-identical restatement of the existing one
- "updates": the new statement conflicts with and replaces the existing one
- "extends": the new statement adds detail without conflicting
- "unrelated": they are not actually about the same fact

Return JSON only: { "kind": "same" | "updates" | "extends" | "unrelated", "confidence": <0-1> }`
	}

	private parseResponse(response: string): Classification | null {
		const parsed = extractJsonObject<{ kind?: unknown; confidence?: unknown }>(response)
		if (!parsed) return null
		const kind = parsed.kind
		if (kind !== 'same' && kind !== 'updates' && kind !== 'extends' && kind !== 'unrelated')
			return null
		const confidence =
			typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0
		return { kind, confidence }
	}

	/** No-LLM fallback: only a strong word-overlap match is acted on (as 'same'). */
	private classifyWithoutLLM(entry: MemoryEntry, candidate: MemoryEntry): Classification {
		const overlap = this.wordOverlap(entry.content, candidate.content)
		if (overlap > 0.85) return { kind: 'same', confidence: 0.8 }
		// Below the confidence gate on purpose - without an LLM we can't safely
		// distinguish 'updates' from 'extends', so default to a no-op.
		return { kind: 'unrelated', confidence: 0 }
	}

	private wordOverlap(a: string, b: string): number {
		const setA = new Set(a.toLowerCase().match(/\w+/g) ?? [])
		const setB = new Set(b.toLowerCase().match(/\w+/g) ?? [])
		if (setA.size === 0 || setB.size === 0) return 0
		let shared = 0
		for (const w of setA) if (setB.has(w)) shared++
		return shared / Math.max(setA.size, setB.size)
	}
}

export default ContradictionResolutionProcessor
