import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../types'
import { ContextBuilder } from './ContextBuilder'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: overrides.id ?? 'e',
		type: 'semantic',
		content: overrides.content ?? 'content',
		createdAt: new Date().toISOString(),
		salience: 0.5,
		...overrides,
	}
}

describe('ContextBuilder - supersession filtering (§16.2)', () => {
	test('buildContext excludes an entry with a child relation (superseded)', () => {
		const superseded = makeEntry({
			id: 'old',
			content: 'Sarah works at Google',
			relations: [{ type: 'child', targetId: 'new' }],
		})
		const latest = makeEntry({ id: 'new', content: 'Sarah works at Stripe' })

		const context = new ContextBuilder().buildContext([superseded, latest])

		expect(context).toContain('Stripe')
		expect(context).not.toContain('Google')
	})

	test('an entry with no child relation is still included', () => {
		const entry = makeEntry({ id: 'e', content: 'Sarah works at Stripe' })
		const context = new ContextBuilder().buildContext([entry])
		expect(context).toContain('Stripe')
	})
})
