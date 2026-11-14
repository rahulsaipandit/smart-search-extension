import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeRequest, makeSuccess } from '../protocol/jsonrpc'
import { SSETransport } from './SSETransport'
import { StreamableHTTPTransport } from './StreamableHTTPTransport'

/** A response whose body yields the given chunks, then stays open until aborted. */
function sseResponse(chunks: string[], signal?: AbortSignal): Response {
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(encoder.encode(c))
			signal?.addEventListener('abort', () => controller.close())
		},
	})
	return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('SSE-based transports', () => {
	const fetchMock = vi.fn<typeof fetch>()

	beforeEach(() => {
		fetchMock.mockReset()
		vi.stubGlobal('fetch', fetchMock)
	})
	afterEach(() => vi.unstubAllGlobals())

	it('delivers messages split across chunks and skips keep-alives and garbage', async () => {
		const msg = makeSuccess(1, { ok: true })
		const json = JSON.stringify(msg)
		fetchMock.mockImplementation(async (_url, init) =>
			sseResponse(
				[
					': ping\n\n',
					`data: ${json.slice(0, 8)}`,
					`${json.slice(8)}\n\n`,
					'data: [DONE]\n\n',
					'data: {bad\n\n',
				],
				init?.signal ?? undefined
			)
		)
		const transport = new SSETransport({ url: 'https://mcp.test/sse' })
		const received: unknown[] = []
		transport.onMessage((m) => received.push(m))

		await transport.connect()
		await tick()
		await transport.disconnect()

		expect(received).toEqual([msg])
	})

	it('POSTs to the /message endpoint with the bearer token from the auth provider', async () => {
		fetchMock.mockImplementation(async (_url, init) => sseResponse([], init?.signal ?? undefined))
		const transport = new SSETransport({
			url: 'https://mcp.test/sse',
			authProvider: { getAccessToken: async () => 'tok' },
		})
		await transport.connect()
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))

		await transport.send(makeRequest('tools/list'))

		const [url, init] = fetchMock.mock.calls.at(-1)!
		expect(url).toBe('https://mcp.test/message')
		expect(init?.method).toBe('POST')
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
		await transport.disconnect()
	})

	it('surfaces a failed POST instead of swallowing it', async () => {
		fetchMock.mockImplementation(async (_url, init) => sseResponse([], init?.signal ?? undefined))
		const transport = new SSETransport({ url: 'https://mcp.test/sse' })
		await transport.connect()
		fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500, statusText: 'Boom' }))

		await expect(transport.send(makeRequest('x'))).rejects.toThrow(/failed 500/)
		await transport.disconnect()
	})

	it('Streamable HTTP posts to the server URL itself, not a /message sibling', async () => {
		fetchMock.mockImplementation(async (_url, init) => sseResponse([], init?.signal ?? undefined))
		const transport = new StreamableHTTPTransport({ url: 'https://mcp.test/mcp' })
		await transport.connect()
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))

		await transport.send(makeRequest('tools/list'))

		expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://mcp.test/mcp')
		await transport.disconnect()
	})

	it('Streamable HTTP reconnects after an unexpected stream end, and not after disconnect()', async () => {
		vi.useFakeTimers()
		try {
			fetchMock.mockImplementation(async () => sseResponse([]))
			// First stream: the body closes immediately, i.e. an unexpected end.
			fetchMock.mockImplementationOnce(async () => {
				const body = new ReadableStream<Uint8Array>({ start: (c) => c.close() })
				return new Response(body, { status: 200 })
			})
			const onReconnect = vi.fn()
			const transport = new StreamableHTTPTransport({
				url: 'https://mcp.test/mcp',
				initialReconnectDelayMs: 100,
				onReconnect,
			})

			await transport.connect()
			await vi.advanceTimersByTimeAsync(150)
			expect(onReconnect).toHaveBeenCalledTimes(1)

			await transport.disconnect()
			const callsAfterDisconnect = fetchMock.mock.calls.length
			await vi.advanceTimersByTimeAsync(5_000)
			expect(fetchMock.mock.calls.length).toBe(callsAfterDisconnect)
		} finally {
			vi.useRealTimers()
		}
	})
})
