/**
 * Dictation: microphone-only speech to text that is typed into a field instead of becoming call turns.
 *
 * Pure logic only. The transcription itself is `SttSession` (mic channel only); the side-panel hook
 * `useDictation` wires it to the UI.
 *
 * Enhancement is a seam, not a feature yet: a `DictationEnhancer` receives the raw dictated text and
 * returns text improved with the user's own knowledge (the planned RAG: names, product terms, spelling).
 * Until one exists, `rawEnhancer` passes the text through unchanged.
 */
import type { SttSegment } from './types'

export interface DictationEnhancer {
	/** Returns the improved text. May reject; the caller then keeps the raw text and shows the failure. */
	enhance(text: string, signal: AbortSignal): Promise<string>
}

/** No knowledge source is connected: the dictated text is used as spoken. */
export const rawEnhancer: DictationEnhancer = { enhance: async (text) => text }

export interface EnhancedText {
	text: string
	/** Set when enhancement failed and `text` is the raw dictation. Never hidden from the user. */
	error: string | null
}

/** Runs the enhancer, and falls back to the raw text, with the reason, when it fails or returns nothing. */
export async function enhanceDictation(
	enhancer: DictationEnhancer,
	raw: string,
	signal: AbortSignal
): Promise<EnhancedText> {
	try {
		const improved = (await enhancer.enhance(raw, signal)).trim()
		if (!improved)
			return { text: raw, error: 'Enhancement returned nothing, so the text is as you spoke it.' }
		return { text: improved, error: null }
	} catch (e) {
		if (signal.aborted) return { text: raw, error: null }
		return {
			text: raw,
			error: `Enhancement failed, so the text is as you spoke it: ${e instanceof Error ? e.message : String(e)}`,
		}
	}
}

/** The spoken text of segments, in order, as one string. */
export function dictatedText(segments: readonly SttSegment[]): string {
	return segments
		.map((s) => s.text.trim())
		.filter(Boolean)
		.join(' ')
}

/** Appends dictated text to what is already in a field, with one space between and no leading space in an empty field. */
export function appendDictated(existing: string, addition: string): string {
	const add = addition.trim()
	if (!add) return existing
	if (!existing || /\s$/.test(existing)) return existing + add
	return `${existing} ${add}`
}
