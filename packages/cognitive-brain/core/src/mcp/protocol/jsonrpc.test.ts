import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	RequestRegistry,
	isErrorResponse,
	isNotification,
	isRequest,
	isResponse,
	isSuccessResponse,
	makeError,
	makeNotification,
	makeRequest,
	makeSuccess,
	parseMessage,
} from './jsonrpc'

describe('message builders and guards', () => {
	it('classifies every message kind exactly one way', () => {
		const req = makeRequest('tools/list')
		const note = makeNotification('notifications/initialized')
		const ok = makeSuccess(7, { tools: [] })
		const err = makeError(7, -32601, 'Method not found')

		expect([isRequest(req), isNotification(req), isResponse(req)]).toEqual([true, false, false])
		expect([isRequest(note), isNotification(note), isResponse(note)]).toEqual([false, true, false])
		expect([isSuccessResponse(ok), isErrorResponse(ok)]).toEqual([true, false])
		expect([isSuccessResponse(err), isErrorResponse(err)]).toEqual([false, true])
	})

	it('gives each request a fresh id so responses can be matched', () => {
		expect(makeRequest('a').id).not.toBe(makeRequest('a').id)
	})
})

describe('parseMessage', () => {
	it('round-trips a serialized message', () => {
		const msg = makeSuccess(3, { ok: true })
		expect(parseMessage(JSON.stringify(msg))).toEqual(msg)
	})

	it('rejects non-JSON and JSON that is not JSON-RPC', () => {
		expect(() => parseMessage('not json')).toThrow(/parse error/)
		expect(() => parseMessage('{"hello":1}')).toThrow(/valid JSON-RPC/)
		expect(() => parseMessage('null')).toThrow(/valid JSON-RPC/)
	})
})

describe('RequestRegistry', () => {
	afterEach(() => vi.useRealTimers())

	it('resolves with the result and rejects with code and message on error responses', async () => {
		const reg = new RequestRegistry()
		const resolved = new Promise((resolve, reject) => reg.register(1, resolve, reject))
		const rejected = new Promise((resolve, reject) => reg.register(2, resolve, reject))

		reg.settle(makeSuccess(1, { n: 1 }))
		reg.settle(makeError(2, -32602, 'Invalid params'))

		await expect(resolved).resolves.toEqual({ n: 1 })
		await expect(rejected).rejects.toThrow('JSON-RPC error -32602: Invalid params')
		expect(reg.size).toBe(0)
	})

	it('ignores responses it never asked for', () => {
		const reg = new RequestRegistry()
		expect(() => reg.settle(makeSuccess(99, {}))).not.toThrow()
	})

	it('times a request out and frees its slot', async () => {
		vi.useFakeTimers()
		const reg = new RequestRegistry()
		const p = new Promise((resolve, reject) => reg.register(1, resolve, reject, 50))
		const assertion = expect(p).rejects.toThrow('timed out after 50ms')
		await vi.advanceTimersByTimeAsync(50)
		await assertion
		expect(reg.size).toBe(0)
	})

	it('rejectAll fails every pending request with the given reason', async () => {
		const reg = new RequestRegistry()
		const a = new Promise((resolve, reject) => reg.register(1, resolve, reject))
		const b = new Promise((resolve, reject) => reg.register(2, resolve, reject))
		reg.rejectAll('Session disconnected')
		await expect(a).rejects.toThrow('Session disconnected')
		await expect(b).rejects.toThrow('Session disconnected')
		expect(reg.size).toBe(0)
	})
})
