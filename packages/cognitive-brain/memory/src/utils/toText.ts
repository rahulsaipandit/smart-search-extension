/**
 * Coerce an untyped (e.g. YAML-parsed) value to a string without producing
 * "[object Object]". Strings pass through, nullish becomes `fallback`,
 * objects and arrays are JSON-encoded, other primitives use String().
 */
export function toText(value: unknown, fallback = ''): string {
	if (value == null) return fallback
	if (typeof value === 'string') return value
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value as number | boolean | bigint | symbol)
}
