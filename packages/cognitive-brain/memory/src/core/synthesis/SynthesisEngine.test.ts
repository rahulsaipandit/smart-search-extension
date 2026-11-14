import { describe, expect, test, vi } from 'vitest'

import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { MemoryEntry } from '../../types'
import { SynthesisEngine } from './SynthesisEngine'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: overrides.id ?? 'e1',
		type: 'episodic',
		content: 'Some content about a topic worth synthesizing',
		createdAt: new Date().toISOString(),
		...overrides,
	}
}

function makeFakeStore(): IMemoryStore & { puts: MemoryEntry[] } {
	const puts: MemoryEntry[] = []
	return {
		puts,
		get: vi.fn(async () => null),
		put: vi.fn(async (entry: MemoryEntry) => {
			puts.push(entry)
		}),
	} as unknown as IMemoryStore & { puts: MemoryEntry[] }
}

describe('SynthesisEngine.compile - no-vault behavior (2026-09-23 fix)', () => {
	test('synthesizes and persists locally with no vault configured at all', async () => {
		const store = makeFakeStore()
		const engine = new SynthesisEngine({ store }) // no vault, no llm - T3 fallback path

		const produced = await engine.compile([makeEntry()])

		expect(produced).toBeGreaterThan(0)
		expect(store.puts.length).toBeGreaterThan(0)
		expect(store.puts[0]?.type).toBe('artifact')
	})

	test('returns 0 only when neither a vault nor a local store is configured', async () => {
		const engine = new SynthesisEngine({}) // truly nowhere to persist

		const produced = await engine.compile([makeEntry()])

		expect(produced).toBe(0)
	})

	test('a configured vault does not prevent local persistence', async () => {
		const store = makeFakeStore()
		const vault = { updatePage: vi.fn(async () => {}) } as any

		const engine = new SynthesisEngine({ store, vault })
		await engine.compile([makeEntry()])

		expect(store.puts.length).toBeGreaterThan(0)
		expect(vault.updatePage).toHaveBeenCalled()
	})
})

describe('SynthesisEngine change detection without WebCrypto', () => {
	// React Native's Hermes usually has no crypto.subtle, so the fingerprint fallback is what runs there.
	test('notices an edit that keeps the length and the first 32 characters', async () => {
		vi.stubGlobal('crypto', undefined)
		try {
			const engine = new SynthesisEngine({ store: makeFakeStore() })
			const detect = (entries: MemoryEntry[]) =>
				(
					engine as unknown as { detectChangedEntries(e: MemoryEntry[]): Promise<MemoryEntry[]> }
				).detectChangedEntries(entries)
			const before = makeEntry({ content: 'x'.repeat(40) + 'first draft' })
			const edited = makeEntry({ content: 'x'.repeat(40) + 'final draft' })
			expect(edited.content).toHaveLength(before.content.length)

			await engine.compile([before])

			expect(await detect([before])).toHaveLength(0)
			expect(await detect([edited])).toHaveLength(1)
		} finally {
			vi.unstubAllGlobals()
		}
	})
})
