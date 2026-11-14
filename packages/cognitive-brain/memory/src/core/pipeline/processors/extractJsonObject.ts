/**
 * Shared "extract a JSON object from raw LLM text" helper.
 *
 * Was previously duplicated verbatim between ProcedureEvolutionProcessor and
 * ContradictionResolutionProcessor (both `text.match(/\{[\s\S]*\}/)` +
 * `JSON.parse`) - a future fix to the extraction strategy (e.g. handling
 * fenced code blocks or nested braces more carefully) needs one place to land
 * instead of risking one copy getting fixed and the other left brittle.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
	const match = /\{[\s\S]*\}/.exec(text)
	if (!match) return null
	try {
		return JSON.parse(match[0]) as T
	} catch {
		return null
	}
}
