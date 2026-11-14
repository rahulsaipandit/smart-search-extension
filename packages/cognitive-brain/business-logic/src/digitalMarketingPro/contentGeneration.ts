/**
 * Listing content generation (design doc §4.2): LLM-generated title/subtitle/
 * description with a bounded validate-then-retry loop, plus a deterministic
 * (non-LLM) keyword-field packer — both patterns adapted from the
 * `ngo275/app-agent` codebase surveyed in researchDigitalMarketingPro.md §6.1.
 */
import type { LLM, Tool } from '@page-agent/llms'
import { z } from 'zod'

import { STOP_WORDS, toSingular } from './scoring'
import type { AppMarketingContext, KeywordCandidate, StoreId } from './types'

/**
 * Store field limits differ, and Android's "subtitle" is really its short
 * description (80 chars, not iOS's 30) — Google Play has no dedicated
 * keyword field at all, so keyword-field packing (packKeywordField below) is
 * skipped entirely for Android callers.
 */
export const FIELD_LIMITS: Record<
	StoreId,
	{ title: number; subtitle: number; description: number }
> = {
	ios: { title: 30, subtitle: 30, description: 4000 },
	android: { title: 30, subtitle: 80, description: 4000 },
}

const KEYWORD_FIELD_LIMIT = 100
const MAX_RETRIES = 2
const LLM_TIMEOUT_MS = 60_000

interface ListingDraft {
	title: string
	subtitle: string
	description: string
}

function significantWordsOf(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !STOP_WORDS.has(toSingular(w)))
			.map(toSingular)
	)
}

/**
 * Length + cross-field keyword-repetition checks. The repetition check only
 * compares title vs. subtitle (not description, which naturally reuses
 * shorter terms in longer prose) — this makes the "don't repeat keywords
 * across fields" instruction in the system prompt actually enforced by the
 * retry loop, rather than only caught after the fact by policyLint.ts's
 * lint pass (which the user would otherwise see as a surprise warning on a
 * draft that just came back "validated").
 */
function validateListingDraft(draft: ListingDraft, store: StoreId): string[] {
	const limits = FIELD_LIMITS[store]
	const errors: string[] = []
	for (const field of ['title', 'subtitle', 'description'] as const) {
		const value = draft[field]
		if (!value) errors.push(`${field} is empty`)
		else if (value.length > limits[field])
			errors.push(`${field} is ${value.length} chars, must be <= ${limits[field]}`)
	}
	if (draft.title && draft.subtitle) {
		const overlap = [...significantWordsOf(draft.title)].filter((w) =>
			significantWordsOf(draft.subtitle).has(w)
		)
		if (overlap.length > 0) {
			errors.push(
				`title and subtitle repeat the same keyword(s) (${overlap.join(', ')}) — use different terms in each`
			)
		}
	}
	return errors
}

/**
 * Generate title/subtitle/description, retrying up to MAX_RETRIES times with
 * the specific validation failure fed back into the next prompt — replaces a
 * single blind generation attempt (design doc §4.2).
 */
export async function generateListingContent(
	llm: LLM,
	ctx: AppMarketingContext,
	targetKeywords: KeywordCandidate[]
): Promise<{ draft: ListingDraft; assumptions: string[] }> {
	const primary = targetKeywords.filter((k) => k.tier === 'primary').map((k) => k.term)
	const secondary = targetKeywords.filter((k) => k.tier === 'secondary').map((k) => k.term)
	const limits = FIELD_LIMITS[ctx.store]
	const subtitleFieldName = ctx.store === 'ios' ? 'subtitle' : 'short description'
	const storeName = ctx.store === 'ios' ? 'App Store' : 'Google Play'

	const tool: Tool<ListingDraft, ListingDraft> = {
		description: `Generate ${storeName} listing copy for this app.`,
		inputSchema: z.object({
			title: z.string(),
			subtitle: z.string(),
			description: z.string(),
		}),
		execute: async (args) => args,
	}

	let lastErrors: string[] = []
	let lastDraft: ListingDraft = { title: '', subtitle: '', description: '' }

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const system =
			`Write ${storeName} listing copy. The store weights the START of the title highest, then the ` +
			`${subtitleFieldName}, then the description — put the single highest-priority keyword at the ` +
			`very start of the title. Title <= ${limits.title} chars, ${subtitleFieldName} <= ${limits.subtitle} ` +
			`chars, description <= ${limits.description} chars. Weave keywords in naturally — never ` +
			`repeat the same keyword across title, ${subtitleFieldName}, and description; each field should ` +
			'carry different terms.'

		const user = [
			`App: ${ctx.name}`,
			`Category: ${ctx.category}`,
			`Description: ${ctx.description}`,
			`Audience: ${ctx.audience}`,
			`Primary keywords (use in the title first, then the ${subtitleFieldName}): ${primary.join(', ') || '(none selected — use your judgment)'}`,
			`Secondary keywords (weave into the description): ${secondary.join(', ') || '(none selected)'}`,
			lastErrors.length
				? `\nThe previous attempt failed validation:\n${lastErrors.join('\n')}\nFix these specific issues.`
				: '',
		]
			.filter(Boolean)
			.join('\n')

		const result = await llm.invoke(
			[
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			{ generate_listing: tool },
			AbortSignal.timeout(LLM_TIMEOUT_MS),
			{ toolChoiceName: 'generate_listing' }
		)
		lastDraft = result.toolResult as ListingDraft
		const errors = validateListingDraft(lastDraft, ctx.store)
		if (errors.length === 0) return { draft: lastDraft, assumptions: [] }
		lastErrors = errors
	}

	return {
		draft: lastDraft,
		assumptions: [
			`Could not satisfy all length constraints after ${MAX_RETRIES} retries: ${lastErrors.join('; ')}`,
		],
	}
}

function wordsOf(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
}

/**
 * Build the iOS keyword field deterministically, without another LLM call —
 * drop words already used in the title/subtitle (automatic anti-stuffing by
 * construction, not a post-hoc check), strip stop-words/category words/plural
 * duplicates, then greedily pack the highest-scoring words into the
 * character budget (design doc §4.2).
 */
export function packKeywordField(
	candidates: KeywordCandidate[],
	title: string,
	subtitle: string,
	category: string
): string {
	const usedWords = new Set([...wordsOf(title), ...wordsOf(subtitle)].map(toSingular))
	const categoryWords = new Set(wordsOf(category).map(toSingular))

	const seen = new Set<string>()
	const scored: { word: string; score: number }[] = []

	for (const candidate of candidates) {
		for (const raw of wordsOf(candidate.term)) {
			const singular = toSingular(raw)
			if (seen.has(singular) || usedWords.has(singular) || categoryWords.has(singular)) continue
			// Check both forms — STOP_WORDS only lists singulars ("app"), so a plural
			// like "apps" would otherwise slip through un-filtered.
			if (STOP_WORDS.has(raw) || STOP_WORDS.has(singular)) continue
			seen.add(singular)
			scored.push({ word: raw, score: candidate.score.overall })
		}
	}
	scored.sort((a, b) => b.score - a.score)

	let result = ''
	for (const { word } of scored) {
		const next = result ? `${result},${word}` : word
		if (next.length > KEYWORD_FIELD_LIMIT) continue
		result = next
	}
	return result
}
