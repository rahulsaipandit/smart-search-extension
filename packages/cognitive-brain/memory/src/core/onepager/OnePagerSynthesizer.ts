import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry } from '../../types'
import { ContextBuilder } from '../context/ContextBuilder'
import type { InProcessGraph } from '../graph/InProcessGraph'
import { type EmbeddingFn, clusterBySimilarity, pickRepresentative } from './dedup'
import {
	collectEntriesLinkedToEntities,
	expandScope,
	topSalienceEntitiesInWindow,
} from './scopeSelection'

/**
 * OnePagerSynthesizer - designCognitiveBrain.md §17.3. "What's going on right
 * now" (active threads, open procedures, upcoming reminders), as distinct
 * from the Profile (§17.2, "who is this person / how to behave").
 *
 * Deliberately does NOT go through SynthesisEngine.compile() - despite §17.3.6
 * asserting compile()'s "existing signature is adequate," compile() is built
 * around extracting N concepts from changed entries into N separate vault/local
 * pages (one page per concept, keyed by concept slug), the same shape
 * ProfileSynthesizer's own top-of-file comment already found unsuitable for
 * "regenerate one fixed local document." The one-pager is one document, not N
 * concept pages, so persistence is owned by MemoryService directly via a
 * fixed-ID artifact (getOnePager()/PROFILE_ARTIFACT_ID's sibling), the same
 * pattern already used for the Profile and the graph snapshot.
 */

const CANDIDATE_LIMIT = 40
const DEDUP_THRESHOLD = 0.92
const CONDENSED_MAX_CANDIDATES = 15

export interface OnePagerLLMService {
	complete(prompt: string): Promise<string>
}

export class OnePagerSynthesizer {
	private contextBuilder = new ContextBuilder()

	/**
	 * Run the full Scope -> Dedup -> Condense pipeline and return the rendered
	 * markdown one-pager (does not persist - callers own that, same division
	 * of labor as ProfileSynthesizer.computeSection()).
	 */
	async regenerate(
		memory: IMemoryService,
		graph: InProcessGraph,
		llmService?: OnePagerLLMService,
		embeddingFn?: EmbeddingFn
	): Promise<string> {
		// ── Stage 1: graph-seeded scope (§17.3.3) ──────────────────────────────
		const seeds = await topSalienceEntitiesInWindow(memory, 7, 5)
		if (seeds.length === 0) return ''

		const scopeEntityIds = expandScope(graph, seeds, 2)
		const candidates = await collectEntriesLinkedToEntities(memory, scopeEntityIds, CANDIDATE_LIMIT)
		if (candidates.length === 0) return ''

		// ── Stage 2: vector dedup (§17.3.4) ────────────────────────────────────
		const clusters = await clusterBySimilarity(candidates, embeddingFn, DEDUP_THRESHOLD)
		const deduped = clusters
			.map(pickRepresentative)
			.sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
			.slice(0, CONDENSED_MAX_CANDIDATES)

		// ── Stage 3: LLM condensation, T3 fallback (§17.3.5) ───────────────────
		return this.condense(deduped, llmService)
	}

	private async condense(entries: MemoryEntry[], llmService?: OnePagerLLMService): Promise<string> {
		if (entries.length === 0) return ''

		if (llmService) {
			try {
				const prompt = this.buildPrompt(entries)
				const result = await llmService.complete(prompt)
				if (result.trim()) return result.trim()
			} catch {
				// Fall through to the T3 fallback on any failure.
			}
		}

		// T3 fallback: concatenated, deduped, salience-sorted formatted entries -
		// same graceful-degradation convention as ProfileSynthesizer.compose()'s
		// T3 path and WikiPageProcessor's rule-based fallback.
		return entries.map((e) => this.contextBuilder.formatEntry(e)).join('\n\n')
	}

	/**
	 * §17.3.6 early invalidation: true if `entry`'s entities intersect the
	 * one-pager's current scope set, meaning a scheduled-only regeneration
	 * cadence would leave the cached one-pager stale about something already
	 * in scope. Callers (MemoryService, via ContradictionResolutionProcessor's
	 * resolution hook) use this to force an immediate regeneration instead of
	 * waiting for the next scheduled run.
	 */
	markStaleIfScoped(entry: MemoryEntry, scopeEntityIds: string[]): boolean {
		if (scopeEntityIds.length === 0) return false
		const scopeSet = new Set(scopeEntityIds)
		return (entry.entities ?? []).some((id) => scopeSet.has(id))
	}

	private buildPrompt(entries: MemoryEntry[]): string {
		const tagged = entries.map((e) => `[${e.type}] ${e.content.slice(0, 400)}`).join('\n')
		return `Summarize what's currently active for this user in 150-250 words, organized as: active threads, open procedures, upcoming reminders.

Source material:
${tagged}

Return only the markdown narrative, no preamble.`
	}
}

export default OnePagerSynthesizer
