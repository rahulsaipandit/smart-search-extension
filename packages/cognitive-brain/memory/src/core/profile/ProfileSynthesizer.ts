import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry, ProfileHeader, ProfileSection } from '../../types'
import { profileTag, statementOf } from './ProfileClassifier'

/**
 * ProfileSynthesizer - computes Profile sections (designCognitiveBrain.md
 * §17.2) from durable facts tagged by ProfileClassifier.
 *
 * Deliberately does NOT go through SynthesisEngine (§6.7). SynthesisEngine's
 * compile() requires a configured vault (`if (!this.vault) return 0`) and is
 * built around extracting N concepts from raw sources into N separate vault
 * pages - a different shape than "regenerate one section of one fixed local
 * document," and one that would violate §17.1.1's "persists locally,
 * unconditionally, no vault required" principle.
 *
 * This class only computes a ProfileSection - it has no store access and
 * does not persist anything. The Profile artifact uses a fixed ID
 * (MemoryService.PROFILE_ARTIFACT_ID) that IMemoryService.create() cannot
 * target (it always generates its own ID), so persistence is owned by
 * MemoryService itself, the same way it already owns the fixed-ID graph
 * snapshot artifact via direct store access.
 */

const STATIC_MIN_AGE_DAYS = 14

function isSuperseded(entry: MemoryEntry): boolean {
	return (entry.relations ?? []).some((r) => r.type === 'child')
}

function ageDays(entry: MemoryEntry, now: number): number {
	return (now - new Date(entry.createdAt).getTime()) / 86_400_000
}

/**
 * Static/dynamic split (§17.2.3), applied at read-time over facts already
 * tagged by the existing pipeline - not a new classification pass.
 */
function isStaticFact(entry: MemoryEntry, now: number): boolean {
	if (entry.isDurable !== true || entry.expiresAt || isSuperseded(entry)) return false
	const restatementCount = (entry.metadata?.restatementCount as number | undefined) ?? 0
	return restatementCount > 0 || ageDays(entry, now) > STATIC_MIN_AGE_DAYS
}

/**
 * Mutually exclusive with isStaticFact() by construction: a fact static
 * enough to have earned that classification (confirmed via restatement, or
 * old enough to have stood unchallenged) must never also render into the
 * dynamic section - the two would otherwise silently overlap for a young
 * fact that's already been restated (restatementCount > 0 AND age <= 14
 * days both hold), duplicating the same fact into both parts of the section.
 */
function isDynamicFact(entry: MemoryEntry, now: number): boolean {
	if (isStaticFact(entry, now)) return false
	if (entry.isDurable !== true || isSuperseded(entry)) return false
	if (entry.expiresAt && new Date(entry.expiresAt).getTime() > now) return true
	return ageDays(entry, now) <= STATIC_MIN_AGE_DAYS
}

export class ProfileSynthesizer {
	/** Compute (but do not persist) a single section from its current backing facts. */
	async computeSection(
		header: ProfileHeader,
		memory: IMemoryService,
		llmService?: { complete(prompt: string): Promise<string> }
	): Promise<ProfileSection> {
		const { items } = await memory.list({
			filter: { tags: [profileTag(header)] },
			limit: 200,
		})

		const now = Date.now()
		const staticFacts = items.filter((e) => isStaticFact(e, now))
		const dynamicFacts = items.filter((e) => isDynamicFact(e, now))

		const [staticProse, dynamicProse] = await Promise.all([
			this.compose(header, 'static', staticFacts, llmService),
			this.compose(header, 'dynamic', dynamicFacts, llmService),
		])

		return {
			header,
			static: staticProse,
			dynamic: dynamicProse,
			updatedAt: new Date().toISOString(),
		}
	}

	// ── Private ──────────────────────────────────────────────────────────────

	private async compose(
		header: ProfileHeader,
		kind: 'static' | 'dynamic',
		facts: MemoryEntry[],
		llmService?: { complete(prompt: string): Promise<string> }
	): Promise<string> {
		if (facts.length === 0) return ''

		if (llmService) {
			try {
				const prompt = this.buildPrompt(header, kind, facts)
				const result = await llmService.complete(prompt)
				if (result.trim()) return result.trim()
			} catch {
				// Fall through to the T3 fallback on any failure.
			}
		}

		// T3 fallback: no LLM available - concatenate distinct fact contents,
		// same graceful-degradation pattern used throughout this system
		// (WikiPageProcessor's rule-based fallback, T1SummarizationProcessor.t3Summarize()).
		return facts.map((f) => statementOf(f).slice(0, 200)).join(' ')
	}

	private buildPrompt(
		header: ProfileHeader,
		kind: 'static' | 'dynamic',
		facts: MemoryEntry[]
	): string {
		const label = kind === 'static' ? 'long-term, well-established' : 'recent or time-bound'
		return `Compose a short (1-3 sentence) ${label} summary for the "${header}" section of a personal assistant's profile of its user.

Facts:
${facts.map((f) => `- ${statementOf(f).slice(0, 300)}`).join('\n')}

Return only the summary prose, no preamble.`
	}
}

export default ProfileSynthesizer
