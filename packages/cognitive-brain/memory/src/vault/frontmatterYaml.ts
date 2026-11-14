/**
 * GuideAxon change (2026-10-08): a small YAML front-matter reader and writer for vault pages.
 *
 * Why it exists: Open Knowledge Format v0.2 (OKF) puts a nested map in the front matter (`generated: { by, at }`).
 * The earlier reader in ObsidianVaultProvider was line based: it turned a nested map into a stray top-level key
 * and a string, and the earlier writer did not escape quotes or line breaks in strings. This module handles the
 * shapes the vault writes:
 *   - scalars (string, number, boolean), written as JSON so quotes and line breaks are escaped;
 *   - arrays, written as a JSON flow sequence;
 *   - a one-level map of scalars, written as an indented block map;
 *   - anything deeper (a map holding a list, a list of maps), written as a JSON flow mapping or sequence.
 * It also reads hand-edited files: unquoted scalars, `[a, b]` flow lists, one-level block maps, and simple
 * `- item` block lists. It is deliberately NOT a full YAML parser; code that must read arbitrary YAML (for
 * example nested maps that hold lists) needs a real YAML library.
 */

type Scalar = string | number | boolean

function isScalar(value: unknown): value is Scalar {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Writes the lines of a front-matter block (without the surrounding `---` lines). */
export function serialiseFrontmatterYaml(frontmatter: Record<string, unknown>): string[] {
	const lines: string[] = []

	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === null) continue

		if (Array.isArray(value)) {
			lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`)
			continue
		}

		if (isPlainObject(value)) {
			const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null)
			if (entries.length > 0 && entries.every(([, v]) => isScalar(v))) {
				lines.push(`${key}:`)
				for (const [childKey, childValue] of entries) {
					lines.push(`  ${childKey}: ${JSON.stringify(childValue)}`)
				}
			} else {
				lines.push(`${key}: ${JSON.stringify(value)}`)
			}
			continue
		}

		lines.push(`${key}: ${JSON.stringify(value)}`)
	}

	return lines
}

function parseScalar(rawValue: string): unknown {
	if (rawValue === 'true') return true
	if (rawValue === 'false') return false

	const num = Number(rawValue)
	if (!isNaN(num) && rawValue !== '') return num

	// A JSON string, as written by serialiseFrontmatterYaml (escapes are decoded).
	if (rawValue.startsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(rawValue)
			if (typeof parsed === 'string') return parsed
		} catch {
			// fall through to the lenient path below
		}
	}

	// A flow sequence or flow mapping. Valid JSON is read exactly.
	const isFlowList = rawValue.startsWith('[') && rawValue.endsWith(']')
	const isFlowMap = rawValue.startsWith('{') && rawValue.endsWith('}')
	if (isFlowList || isFlowMap) {
		try {
			return JSON.parse(rawValue)
		} catch {
			// not JSON: for a list, fall back to the lenient comma split used by hand-edited files
		}
		if (isFlowList) {
			return rawValue
				.slice(1, -1)
				.split(',')
				.map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
				.filter(Boolean)
		}
	}

	return rawValue.replace(/^['"]|['"]$/g, '')
}

/** Reads the text between the `---` lines of a front-matter block. */
export function parseFrontmatterYaml(yamlBlock: string): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	const lines = yamlBlock.split('\n')

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ''
		// Indented lines belong to the key above them and are consumed there.
		if (/^\s/.test(line)) continue

		const colonIdx = line.indexOf(':')
		if (colonIdx === -1) continue
		const key = line.slice(0, colonIdx).trim()
		const rawValue = line.slice(colonIdx + 1).trim()

		if (rawValue !== '') {
			result[key] = parseScalar(rawValue)
			continue
		}

		// Empty value: a one-level block map, a block list, or genuinely empty.
		let j = i + 1
		const children: string[] = []
		while (j < lines.length && /^\s+\S/.test(lines[j] ?? '')) {
			children.push((lines[j] ?? '').trim())
			j++
		}

		if (children.length === 0) {
			result[key] = ''
			continue
		}

		if (children.every((c) => c.startsWith('- ') || c === '-')) {
			result[key] = children.map((c) => parseScalar(c.slice(1).trim()))
		} else {
			const map: Record<string, unknown> = {}
			for (const child of children) {
				const ci = child.indexOf(':')
				if (ci === -1) continue
				map[child.slice(0, ci).trim()] = parseScalar(child.slice(ci + 1).trim())
			}
			result[key] = map
		}
		i = j - 1
	}

	return result
}
