import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../types'
import { CompactionRecap } from './CompactionRecap'

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
	return {
		type: 'episodic',
		content: 'placeholder content',
		createdAt: new Date(0).toISOString(),
		...overrides,
	}
}

describe('CompactionRecap', () => {
	test('renders "" when nothing has been evicted', () => {
		expect(new CompactionRecap().render()).toBe('')
	})

	test('renders a one-line summary per appended entry', () => {
		const recap = new CompactionRecap()
		recap.append(makeEntry({ id: 'e1', content: 'Discussed the Q3 roadmap' }))
		recap.append(makeEntry({ id: 'e2', content: 'Reviewed the budget spreadsheet' }))

		const rendered = recap.render()

		expect(rendered).toContain('Discussed the Q3 roadmap')
		expect(rendered).toContain('Reviewed the budget spreadsheet')
	})

	test('drops oldest lines first once the token budget is exceeded', () => {
		const recap = new CompactionRecap(20) // small budget, forces eviction within the recap itself
		recap.append(
			makeEntry({ id: 'e1', content: 'This is the oldest entry and should be dropped first' })
		)
		recap.append(makeEntry({ id: 'e2', content: 'This is a newer entry that should survive' }))

		const rendered = recap.render()

		expect(rendered).not.toContain('oldest entry and should be dropped')
		expect(rendered).toContain('newer entry that should survive')
	})

	test('clear() empties the buffer', () => {
		const recap = new CompactionRecap()
		recap.append(makeEntry({ id: 'e1', content: 'something' }))
		recap.clear()

		expect(recap.render()).toBe('')
	})
})
