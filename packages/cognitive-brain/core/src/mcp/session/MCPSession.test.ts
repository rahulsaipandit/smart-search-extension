import { describe, expect, it } from 'vitest'

import {
	type JSONRPCMessage,
	type JSONRPCRequest,
	isRequest,
	makeError,
	makeSuccess,
} from '../protocol/jsonrpc'
import type { IMCPTransport } from '../transport/IMCPTransport'
import { MCPSession } from './MCPSession'

/** Answers requests from a method table and records everything the session sends. */
class FakeTransport implements IMCPTransport {
	sent: JSONRPCMessage[] = []
	connected = false
	private handler: ((m: JSONRPCMessage) => void) | null = null

	private readonly replies: Record<string, unknown>

	constructor(replies: Record<string, unknown>) {
		this.replies = replies
	}

	async connect() {
		this.connected = true
	}
	async disconnect() {
		this.connected = false
	}
	async send(message: JSONRPCRequest) {
		this.sent.push(message)
		if (!isRequest(message)) return
		const result = this.replies[message.method]
		queueMicrotask(() =>
			this.handler?.(
				result === undefined
					? makeError(message.id, -32601, `no reply for ${message.method}`)
					: makeSuccess(message.id, result)
			)
		)
	}
	onMessage(handler: (m: JSONRPCMessage) => void) {
		this.handler = handler
	}
	get isConnected() {
		return this.connected
	}
	request(method: string) {
		return this.sent.find((m) => 'method' in m && m.method === method) as JSONRPCRequest
	}
}

const tool = (name: string) => ({
	name,
	description: name,
	inputSchema: { type: 'object' as const },
})
const handshake = {
	initialize: { protocolVersion: '2024-11-05', capabilities: { tools: {} } },
	'tools/list': { tools: [tool('read'), tool('delete')] },
}

describe('MCPSession', () => {
	it('performs the handshake, acknowledges it, then lists tools', async () => {
		const transport = new FakeTransport(handshake)
		const session = new MCPSession(transport, { id: 's1', label: 'Server' })

		await session.connect()

		expect(session.status).toBe('ready')
		expect(session.tools.map((t) => t.name)).toEqual(['read', 'delete'])
		const methods = transport.sent.map((m) => ('method' in m ? m.method : '?'))
		expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
	})

	it('identifies as PageAgent unless the host passes its own client info', async () => {
		const web = new FakeTransport(handshake)
		await new MCPSession(web, { id: 's1', label: 'S' }).connect()
		expect(web.request('initialize').params).toMatchObject({
			clientInfo: { name: 'PageAgent', version: '1.0' },
		})

		const host = new FakeTransport(handshake)
		await new MCPSession(
			host,
			{ id: 's2', label: 'S' },
			{ name: 'MobileHost', version: '2' }
		).connect()
		expect(host.request('initialize').params).toMatchObject({
			clientInfo: { name: 'MobileHost', version: '2' },
		})
	})

	it('only exposes and allows tools on the allowedTools list', async () => {
		const session = new MCPSession(new FakeTransport(handshake), {
			id: 's1',
			label: 'S',
			allowedTools: ['read'],
		})
		await session.connect()

		expect(session.tools.map((t) => t.name)).toEqual(['read'])
		await expect(session.callTool('delete', {})).rejects.toThrow(/not in the allowedTools list/)
	})

	it('truncates oversized text results so a server cannot flood the context', async () => {
		const transport = new FakeTransport({
			...handshake,
			'tools/call': { content: [{ type: 'text', text: 'x'.repeat(100) }] },
		})
		const session = new MCPSession(transport, { id: 's1', label: 'S', maxResultBytes: 10 })
		await session.connect()

		const result = await session.callTool('read', {})
		const first = result.content[0]
		expect(first.type === 'text' && first.text.startsWith('x'.repeat(10) + '\n[...truncated')).toBe(
			true
		)
	})

	it('refuses calls before the session is ready', async () => {
		const session = new MCPSession(new FakeTransport(handshake), { id: 's1', label: 'S' })
		await expect(session.callTool('read', {})).rejects.toThrow()
	})
})
