import { describe, expect, test, vi } from 'vitest'

import type { IMemoryIndex } from '../../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../../interfaces/IMemoryStore'
import type { MemoryEntry } from '../../types'
import { Pipeline } from './Pipeline'

// Only scoreImportance() is exercised, so the store and index are never touched.
const store = {} as IMemoryStore
const index = {} as IMemoryIndex
const entry: MemoryEntry = {
	id: 'e',
	type: 'episodic',
	content: 'short turn',
	createdAt: new Date().toISOString(),
}
const score = (p: Pipeline) =>
	(p as unknown as { scoreImportance(e: MemoryEntry): Promise<number> }).scoreImportance(entry)

describe('Pipeline importance refine hook (designJEVMisc.md fit #4)', () => {
	test('without a hook the T1 score is used (no LLM: length heuristic, 2 for a short turn)', async () => {
		expect(await score(new Pipeline(store, index))).toBe(2)
	})

	test('a confident refiner wins and the T1 score is never computed', async () => {
		const p = new Pipeline(store, index, { importance: { refine: async () => 5 } })
		const t1 = vi.spyOn(
			(p as unknown as { t1: { scoreImportance: () => Promise<number> } }).t1,
			'scoreImportance'
		)
		expect(await score(p)).toBe(5)
		expect(t1).not.toHaveBeenCalled()
	})

	test('null, an out-of-range value or a throw keeps the T1 score, computed once', async () => {
		for (const refine of [
			async () => null,
			async () => 9,
			async () => {
				throw new Error('x')
			},
		]) {
			const p = new Pipeline(store, index, { importance: { refine } })
			const t1 = vi.spyOn(
				(p as unknown as { t1: { scoreImportance: () => Promise<number> } }).t1,
				'scoreImportance'
			)
			expect(await score(p)).toBe(2)
			expect(t1).toHaveBeenCalledTimes(1)
		}
		const p = new Pipeline(store, index, {
			importance: {
				refine: async (_e, getBaseline) => {
					await getBaseline()
					return null
				},
			},
		})
		const t1 = vi.spyOn(
			(p as unknown as { t1: { scoreImportance: () => Promise<number> } }).t1,
			'scoreImportance'
		)
		expect(await score(p)).toBe(2)
		expect(t1).toHaveBeenCalledTimes(1)
	})
})
