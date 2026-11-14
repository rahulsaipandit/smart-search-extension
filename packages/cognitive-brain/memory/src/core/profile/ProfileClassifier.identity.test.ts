import { describe, expect, test } from 'vitest'

import { classifyForProfile, isProfileFact, statementOf } from './ProfileClassifier'

describe('life_context: how people really say who they are', () => {
	test.each([
		"I'm a VP of Sales at a logistics company. I lead 40 people.",
		'I am the head of data at a bank',
		"I'm a nurse on a night shift",
		"I'm currently a product manager",
		'I lead a team of 12 engineers',
		'I manage a sales organization',
		'I run a small consulting business',
		'I work as an accountant',
		'My title is Director of Operations',
		'My department is finance',
		"I'm CEO of a small startup", // no article
		'I am VP of Engineering at Stripe',
		"I'm a senior software engineer",
		"I'm also a founder of a nonprofit",
		'I lead 40 people',
		'I run a small consulting business',
	])('%s', (text) => {
		expect(classifyForProfile({ content: text })).toBe('life_context')
	})

	// The role word must follow "I'm" directly, or an article and at most two plain words, and no preposition may bridge the gap.
	// Eight of these (all but "I'm the one who broke the build" and the dog and cat one, which are extra guards) matched the earlier
	// patterns: a role word somewhere later in the same sentence was enough.
	test.each([
		"I'm at the doctor", // 'doctor' after a preposition: a visit, not a job
		"I'm so glad to lead the way",
		"I'm a fan of the director's cut",
		"I'm a big fan of the writer",
		'I am not the owner of that decision',
		"I'm the one who broke the build",
		"I'm going to see the director tomorrow",
		'I run every morning with the team', // 'run ... team' bridged by a preposition
		'I lead you through the steps of the company handbook',
		'I own a dog and a cat, the family loves them', // 'family' later in the sentence, not "my family"
	])('is not a statement about who the user is: %s', (text) => {
		expect(classifyForProfile({ content: text })).toBeNull()
	})

	test.each([
		"I'm tired",
		"I'm hungry, what is for lunch?",
		'I am happy to help',
		"I'm not sure about that",
		'What is the lead time on a delivery?',
		'Can you manage my calendar?', // a request, not "I manage"
		'I run every morning',
	])('is not a statement about who the user is: %s', (text) => {
		expect(classifyForProfile({ content: text })).toBeNull()
	})
})

describe('statementOf: only the user half of a stored turn', () => {
	test('reads the user text out of "User: ...\\nAssistant: ..."', () => {
		expect(
			statementOf({
				content: 'User: I work at Stripe\nAssistant: Nice, tell me more about my team.',
			})
		).toBe('I work at Stripe')
	})

	test('any other entry is its own statement', () => {
		expect(statementOf({ content: 'I prefer concise answers' })).toBe('I prefer concise answers')
		expect(statementOf({ content: 'User: no assistant half here' })).toBe(
			'User: no assistant half here'
		)
	})

	test('words in the reply neither classify a turn nor are read', () => {
		const turn = {
			content: 'User: What is 2 plus 2?\nAssistant: I work at being brief. My team says four.',
		}
		expect(classifyForProfile(turn)).toBeNull()
	})

	test('a fact stated by the user in a turn is classified from their words', () => {
		expect(
			classifyForProfile({ content: "User: I'm a VP of Sales\nAssistant: Great to meet you." })
		).toBe('life_context')
	})
})

describe('isProfileFact', () => {
	test('is true for an entry carrying a profile tag', () => {
		expect(isProfileFact({ tags: ['conversation', 'profile:life_context'] })).toBe(true)
		expect(isProfileFact({ tags: ['conversation'] })).toBe(false)
		expect(isProfileFact({})).toBe(false)
	})
})
