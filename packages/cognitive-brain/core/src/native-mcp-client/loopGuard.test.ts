import { describe, expect, it } from 'vitest'

import { createLoopGuard } from './loopGuard'

describe('createLoopGuard', () => {
	it('stops on the call that reaches maxRepeats, and a different argument starts the count again', () => {
		const g = createLoopGuard({ maxRepeats: 3 })
		expect(g.record('search', { q: 'a' }).stop).toBe(false)
		expect(g.record('search', { q: 'a' }).stop).toBe(false)
		expect(g.record('search', { q: 'b' }).stop).toBe(false)
		expect(g.record('search', { q: 'b' }).stop).toBe(false)
		expect(g.record('search', { q: 'b' })).toEqual({ stop: true, reason: 'repeated_call' })
	})

	it('treats the same arguments in a different key order as the same call', () => {
		const g = createLoopGuard({ maxRepeats: 2 })
		g.record('t', { a: 1, b: { x: 1, y: 2 } })
		expect(g.record('t', { b: { y: 2, x: 1 }, a: 1 })).toMatchObject({ stop: true })
	})

	it('stops two calls taking turns (A, B, A, B) without needing any single call to repeat', () => {
		const g = createLoopGuard({ maxRepeats: 3 })
		expect(g.record('read', {}).stop).toBe(false)
		expect(g.record('write', {}).stop).toBe(false)
		expect(g.record('read', {}).stop).toBe(false)
		expect(g.record('write', {})).toEqual({ stop: true, reason: 'ping_pong' })
	})

	it('does not call A, B, C, A a loop', () => {
		const g = createLoopGuard({ maxRepeats: 3 })
		for (const n of ['a', 'b', 'c', 'a', 'b', 'c']) expect(g.record(n, {}).stop).toBe(false)
	})

	it('refuses a maxRepeats that would stop every run at its first call', () => {
		expect(() => createLoopGuard({ maxRepeats: 0 })).toThrow(RangeError)
	})
})
