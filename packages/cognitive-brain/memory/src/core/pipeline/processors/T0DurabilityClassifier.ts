import type { MemoryEntry } from '../../../types'

/**
 * T0 Durability Classifier - zero LLM cost, pure regex/date heuristics.
 *
 * Computes MemoryEntry.isDurable / expiresAt (designCognitiveBrain.md §16.1).
 * This is the rule-based fallback path; a T1 LLM upgrade can override these
 * fields with higher-confidence judgments the same way ImportanceProcessor
 * layers an LLM score on top of keyword pre-scoring.
 *
 * Two independent signals, not a fact/preference/episode enum:
 *   - isDurable: declarative statements about identity, work, or standing
 *     preferences ("I am...", "I work at...", "I prefer...") persist until
 *     explicitly superseded.
 *   - expiresAt: explicit dates or relative time phrases ("tomorrow", "this
 *     week") mark content as time-bound; it should decay/forget after that point.
 */

const DURABLE_PATTERNS: RegExp[] = [
	/\bi\s*(?:'m|am)\b/i,
	/\bi\s+(work|live|prefer|like|love|hate|always|never|study)\b/i,
	/\bmy\s+(name|job|favorite|favourite)\b/i,
	/\b(works? at|lives? in|prefers?|studies at)\b/i,
]

const RELATIVE_TIME_PATTERNS: { pattern: RegExp; hoursFromNow: number }[] = [
	{ pattern: /\btonight\b/i, hoursFromNow: 12 },
	{ pattern: /\btoday\b/i, hoursFromNow: 24 },
	{ pattern: /\btomorrow\b/i, hoursFromNow: 48 },
	{ pattern: /\bthis (morning|afternoon|evening)\b/i, hoursFromNow: 12 },
	{ pattern: /\bthis week\b/i, hoursFromNow: 24 * 7 },
	{ pattern: /\bnext week\b/i, hoursFromNow: 24 * 14 },
]

const EXPLICIT_DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\b/

export interface DurabilityResult {
	isDurable: boolean
	expiresAt?: string
}

export function computeDurability(entry: Pick<MemoryEntry, 'title' | 'content'>): DurabilityResult {
	const text = `${entry.title ?? ''} ${entry.content}`

	// Explicit future date wins over everything else.
	const explicitDate = EXPLICIT_DATE_PATTERN.exec(text)
	if (explicitDate) {
		const parsed = new Date(explicitDate[1]!)
		if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
			return { isDurable: false, expiresAt: parsed.toISOString() }
		}
	}

	for (const { pattern, hoursFromNow } of RELATIVE_TIME_PATTERNS) {
		if (pattern.test(text)) {
			return {
				isDurable: false,
				expiresAt: new Date(Date.now() + hoursFromNow * 3_600_000).toISOString(),
			}
		}
	}

	if (DURABLE_PATTERNS.some((p) => p.test(text))) {
		return { isDurable: true }
	}

	return { isDurable: false }
}

/**
 * Mutates entry.isDurable / entry.expiresAt in-place, unless already set
 * (e.g. by a T1 LLM pass or explicit caller). Idempotent.
 */
export function applyDurabilityClassification(entry: MemoryEntry): void {
	if (entry.isDurable !== undefined) return
	const result = computeDurability(entry)
	entry.isDurable = result.isDurable
	if (result.expiresAt) entry.expiresAt = result.expiresAt
}
