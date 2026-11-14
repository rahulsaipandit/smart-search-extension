import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const srcDir = dirname(fileURLToPath(import.meta.url))

// Matches `import ... from 'x'`, `export ... from 'x'`, side-effect `import 'x'` and `import('x')`.
const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g

function resolveRelative(from: string, specifier: string): string | null {
	const base = resolve(dirname(from), specifier)
	for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
		if (existsSync(candidate)) return candidate
	}
	return null
}

/** Walks every static and dynamic import reachable from `entry`, returning source files and bare specifiers. */
function walk(entry: string) {
	const files = new Set<string>()
	const bare = new Set<string>()
	const queue = [entry]
	while (queue.length > 0) {
		const file = queue.pop()!
		if (files.has(file)) continue
		files.add(file)
		// Comments can mention `from '...'`, and `import type` / `export type` are erased at build time,
		// so neither adds a runtime dependency.
		const code = readFileSync(file, 'utf-8')
			.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')
			.replace(/^\s*(?:import|export)\s+type\b[^;]*?from\s*['"][^'"]+['"]/gm, '')
		for (const [, specifier] of code.matchAll(SPECIFIER_RE)) {
			if (specifier.startsWith('.')) {
				const resolved = resolveRelative(file, specifier)
				if (resolved) queue.push(resolved)
			} else {
				bare.add(specifier)
			}
		}
	}
	return { files: [...files].map((f) => relative(srcDir, f).split(sep).join('/')), bare: [...bare] }
}

describe('@page-agent/memory root entry stays platform-neutral', () => {
	const { files, bare } = walk(join(srcDir, 'index.ts'))

	test('does not reach MCPVaultClient, the filesystem vault, or any adapter subpath', () => {
		const forbidden = files.filter(
			(f) =>
				f === 'vault/MCPVaultClient.ts' ||
				f === 'vault/ObsidianVaultProvider.ts' ||
				f.startsWith('adapters/')
		)
		expect(forbidden).toEqual([])
	})

	test('does not reach Node built-ins or the MCP SDK', () => {
		const forbidden = bare.filter(
			(s) => s.startsWith('node:') || s.startsWith('@modelcontextprotocol/')
		)
		expect(forbidden).toEqual([])
	})
})
