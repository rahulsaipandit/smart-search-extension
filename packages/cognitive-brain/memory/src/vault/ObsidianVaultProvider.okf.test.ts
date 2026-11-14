import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { PageFrontmatter } from '../types'
import { ObsidianVaultProvider } from './ObsidianVaultProvider'

let dir: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'okf-vault-'))
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

async function onlyFile(): Promise<string> {
	const folder = join(dir, 'page-agent')
	const names = await readdir(folder)
	expect(names).toHaveLength(1)
	return readFile(join(folder, names[0]!), 'utf-8')
}

describe('ObsidianVaultProvider writes OKF v0.2 front matter', () => {
	const synthesized: PageFrontmatter = {
		title: 'Executive presence',
		sources: ['m1', 'm2'],
		synthesisQuality: 'T1',
		synthesizedBy: 'memory-engine',
		synthesizedAt: '2026-10-08T09:00:00Z',
		confidence: 0.8,
		provenanceState: 'merged',
		contradictedBy: ['p9'],
		aliases: ['presence'],
		tags: ['career'],
	}

	test('the file has type, a nested generated map, sourceIds and no string sources', async () => {
		const vault = new ObsidianVaultProvider({ vaultDir: dir })
		await vault.updatePage('executive-presence', 'Body text.', synthesized)

		const text = await onlyFile()
		expect(text).toMatch(/^---\n/)
		expect(text).toContain('type: "synthesis"')
		expect(text).toContain(
			'generated:\n  by: "process:memory-engine"\n  at: "2026-10-08T09:00:00Z"'
		)
		expect(text).toContain('timestamp: "2026-10-08T09:00:00Z"')
		expect(text).toContain('sourceIds: ["m1", "m2"]')
		expect(text).not.toMatch(/^sources:/m)
		expect(text).toContain('Body text.')
	})

	test('reading the page back gives generated as an object and keeps the custom fields', async () => {
		const vault = new ObsidianVaultProvider({ vaultDir: dir })
		await vault.updatePage('executive-presence', 'Body text.', synthesized)

		const fresh = new ObsidianVaultProvider({ vaultDir: dir })
		const page = await fresh.readPage('executive-presence')
		expect(page).not.toBeNull()
		expect(page!.frontmatter.generated).toEqual({
			by: 'process:memory-engine',
			at: '2026-10-08T09:00:00Z',
		})
		expect(page!.frontmatter.type).toBe('synthesis')
		expect(page!.frontmatter.sourceIds).toEqual(['m1', 'm2'])
		expect(page!.frontmatter.contradictedBy).toEqual(['p9'])
		expect(page!.frontmatter.aliases).toEqual(['presence'])
		expect(page!.content).toBe('Body text.')
	})

	test('a page written twice does not change on the second write', async () => {
		const vault = new ObsidianVaultProvider({ vaultDir: dir })
		await vault.updatePage('executive-presence', 'Body text.', synthesized)
		const first = await onlyFile()

		const page = await new ObsidianVaultProvider({ vaultDir: dir }).readPage('executive-presence')
		await vault.updatePage(
			'executive-presence',
			page!.content,
			page!.frontmatter as PageFrontmatter
		)
		expect(await onlyFile()).toBe(first)
	})

	test('a title with quotes and a line break survives a write and read', async () => {
		const vault = new ObsidianVaultProvider({ vaultDir: dir })
		await vault.updatePage('odd-title', 'x', { title: 'He said "hi"\nbye' })
		const page = await new ObsidianVaultProvider({ vaultDir: dir }).readPage('odd-title')
		expect(page!.frontmatter.title).toBe('He said "hi"\nbye')
	})

	test('ingestSource writes a type, as OKF requires', async () => {
		const vault = new ObsidianVaultProvider({ vaultDir: dir })
		await vault.ingestSource('Raw text.', { slug: 'raw-note', title: 'Raw note', tags: ['x'] })
		const text = await onlyFile()
		expect(text).toContain('type: "artifact"')
	})
})
