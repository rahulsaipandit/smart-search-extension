import { describe, expect, test } from 'vitest'

import type { Profile } from '../../types'
import { formatProfileForPrompt } from './formatProfileForPrompt'

function makeProfile(overrides: Partial<Profile> = {}): Profile {
	return {
		sections: [],
		updatedAt: new Date(0).toISOString(),
		...overrides,
	}
}

describe('formatProfileForPrompt', () => {
	test('returns empty string for a profile with no sections', () => {
		expect(formatProfileForPrompt(makeProfile())).toBe('')
	})

	test('omits headers with no static or dynamic prose', () => {
		const profile = makeProfile({
			sections: [
				{ header: 'life_context', static: '', dynamic: '', updatedAt: new Date(0).toISOString() },
				{ header: 'autonomy', static: '', dynamic: '', updatedAt: new Date(0).toISOString() },
				{
					header: 'communication_style',
					static: '',
					dynamic: '',
					updatedAt: new Date(0).toISOString(),
				},
			],
		})
		expect(formatProfileForPrompt(profile)).toBe('')
	})

	test('renders a header with only static prose', () => {
		const profile = makeProfile({
			sections: [
				{
					header: 'life_context',
					static: 'Works at Stripe as a product manager.',
					dynamic: '',
					updatedAt: new Date(0).toISOString(),
				},
			],
		})
		expect(formatProfileForPrompt(profile)).toBe(
			'What you know about the user:\nlife_context: Works at Stripe as a product manager.'
		)
	})

	test('joins static and dynamic prose within a header, and lists multiple headers on separate lines', () => {
		const profile = makeProfile({
			sections: [
				{
					header: 'life_context',
					static: 'Works at Stripe.',
					dynamic: 'Just started a new project this week.',
					updatedAt: new Date(0).toISOString(),
				},
				{
					header: 'communication_style',
					static: 'Prefers concise, direct answers.',
					dynamic: '',
					updatedAt: new Date(0).toISOString(),
				},
			],
		})
		expect(formatProfileForPrompt(profile)).toBe(
			'What you know about the user:\n' +
				'life_context: Works at Stripe. Just started a new project this week.\n' +
				'communication_style: Prefers concise, direct answers.'
		)
	})
})
