import { describe, expect, it } from 'vitest'

import { Matcher } from './matcher'
import { KeywordPlugin, PasswordFieldPlugin, SensitiveFieldPlugin } from './plugins'
import { PolicyEngine } from './policy-engine'
import type { DocumentSnapshot, PolicyContext, PolicyPlugin } from './types'

const cleanDom: DocumentSnapshot = {
	hasPasswordFields: false,
	hasLoginForm: false,
	hasSensitiveFields: false,
	textSample: '',
}

const ctx = (host: string, dom: Partial<DocumentSnapshot> = {}): PolicyContext => ({
	url: `https://${host}/`,
	host,
	dom: { ...cleanDom, ...dom },
})

const plugins = (): PolicyPlugin[] => [
	new PasswordFieldPlugin(),
	new SensitiveFieldPlugin(),
	new KeywordPlugin(),
]

describe('Matcher', () => {
	it('lets a wildcard match subdomains and the apex, including a www. variant', () => {
		expect(Matcher.matches('login.bank.com', '*.bank.com')).toBe(true)
		expect(Matcher.matches('bank.com', '*.bank.com')).toBe(true)
		expect(Matcher.matches('www.bank.com', '*.bank.com')).toBe(true)
	})

	it('does not match look-alike hosts', () => {
		expect(Matcher.matches('notbank.com', '*.bank.com')).toBe(false)
		expect(Matcher.matches('bank.com.evil.test', '*.bank.com')).toBe(false)
		expect(Matcher.matches('sub.bank.com', 'bank.com')).toBe(false)
	})
})

describe('PolicyEngine', () => {
	it('blocks a denylisted host before any plugin runs', () => {
		const engine = new PolicyEngine({ denylist: ['*.bank.com'], allowlist: [] }, plugins())
		expect(engine.evaluate(ctx('www.bank.com'))).toEqual({
			decision: 'BLOCK',
			reason: 'Host matches denylist',
		})
	})

	it('lets an explicit allowlist entry carve a host out of a broader denylist wildcard', () => {
		const engine = new PolicyEngine(
			{ denylist: ['*.bank.com'], allowlist: ['docs.bank.com'] },
			plugins()
		)
		expect(engine.evaluate(ctx('docs.bank.com')).decision).toBe('ALLOW')
		expect(engine.evaluate(ctx('login.bank.com')).decision).toBe('BLOCK')
	})

	it('skips plugin heuristics for an allowlisted host', () => {
		const engine = new PolicyEngine({ denylist: [], allowlist: ['archive.example'] }, plugins())
		const page = ctx('archive.example', {
			hasPasswordFields: true,
			textSample: 'ssn and credit card',
		})
		expect(engine.evaluate(page).decision).toBe('ALLOW')
	})

	it('blocks an unlisted host when a plugin detects a password field', () => {
		const engine = new PolicyEngine({ denylist: [], allowlist: [] }, plugins())
		expect(engine.evaluate(ctx('shop.example', { hasPasswordFields: true }))).toEqual({
			decision: 'BLOCK',
			reason: 'Password field detected',
		})
	})

	it('allows a clean unlisted page', () => {
		const engine = new PolicyEngine({ denylist: [], allowlist: [] }, plugins())
		expect(engine.evaluate(ctx('blog.example')).decision).toBe('ALLOW')
	})

	it('requires a user gesture when configured, even on an allowlisted host', () => {
		const engine = new PolicyEngine({ denylist: [], allowlist: ['trusted.example'] }, plugins(), {
			requireUserGesture: true,
		})
		expect(engine.evaluate(ctx('trusted.example')).decision).toBe('BLOCK')
		expect(engine.evaluate({ ...ctx('trusted.example'), userGesture: true }).decision).toBe('ALLOW')
	})
})

describe('KeywordPlugin', () => {
	const evaluate = (textSample: string) =>
		new KeywordPlugin().evaluate(ctx('x.example', { textSample }))

	it('ignores a single incidental sensitive term', () => {
		expect(evaluate('A news piece about credit card debt.')).toBeNull()
	})

	it('blocks once two distinct terms appear', () => {
		const result = evaluate('Enter your SSN and your routing number')
		expect(result?.decision).toBe('BLOCK')
		expect(result?.reason).toContain('ssn')
		expect(result?.reason).toContain('routing number')
	})

	it('does not count the same term twice or match inside ordinary words', () => {
		expect(evaluate('credit card, credit card, credit card')).toBeNull()
		expect(evaluate('hotpot and adoption forms')).toBeNull()
	})
})
