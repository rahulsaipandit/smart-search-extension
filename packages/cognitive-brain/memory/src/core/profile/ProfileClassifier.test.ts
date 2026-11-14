import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../types'
import {
	ALL_PROFILE_HEADERS,
	applyProfileClassification,
	classifyForProfile,
	profileTag,
} from './ProfileClassifier'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: 'e1',
		type: 'semantic',
		content: 'placeholder',
		createdAt: new Date().toISOString(),
		...overrides,
	}
}

describe('classifyForProfile', () => {
	test('classifies autonomy-calibration language', () => {
		expect(classifyForProfile({ content: 'Always ask before sending emails on my behalf' })).toBe(
			'autonomy'
		)
	})

	test('classifies communication-style preferences', () => {
		expect(classifyForProfile({ content: 'I prefer concise, direct answers' })).toBe(
			'communication_style'
		)
	})

	test('classifies life-context statements', () => {
		expect(classifyForProfile({ content: 'I work at Stripe as a product manager' })).toBe(
			'life_context'
		)
	})

	test('returns null for routine content with no signal', () => {
		expect(classifyForProfile({ content: 'That sounds interesting, tell me more' })).toBeNull()
	})

	test('autonomy phrasing takes priority over an overlapping life-context pattern', () => {
		// Contains "my team" (a life_context trigger) but is fundamentally an
		// autonomy-calibration statement - autonomy must win.
		expect(
			classifyForProfile({ content: "Don't ask before looping in my team on routine updates" })
		).toBe('autonomy')
	})
})

describe('profileTag', () => {
	test('formats a header as a queryable tag', () => {
		expect(profileTag('life_context')).toBe('profile:life_context')
	})
})

describe('applyProfileClassification', () => {
	test('appends the matching tag to the entry', () => {
		const entry = makeEntry({ content: 'I work at Stripe', tags: ['conversation'] })
		const header = applyProfileClassification(entry)
		expect(header).toBe('life_context')
		expect(entry.tags).toEqual(['conversation', 'profile:life_context'])
	})

	test('is idempotent - does not duplicate the tag on repeated calls', () => {
		const entry = makeEntry({ content: 'I work at Stripe' })
		applyProfileClassification(entry)
		applyProfileClassification(entry)
		expect(entry.tags).toEqual(['profile:life_context'])
	})

	test('returns null and leaves tags unset when nothing matches', () => {
		const entry = makeEntry({ content: 'ok sounds good' })
		const header = applyProfileClassification(entry)
		expect(header).toBeNull()
		expect(entry.tags).toBeUndefined()
	})
})

describe('ALL_PROFILE_HEADERS', () => {
	test('has exactly the three fixed headers in stable order', () => {
		expect(ALL_PROFILE_HEADERS).toEqual(['life_context', 'autonomy', 'communication_style'])
	})
})
