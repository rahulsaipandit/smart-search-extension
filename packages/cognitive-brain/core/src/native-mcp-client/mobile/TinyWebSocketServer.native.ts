/**
 * TinyWebSocketServer - minimal WebSocket server over react-native-tcp-socket.
 *
 * Implements just enough of RFC 6455 for the Mobile MCP tool-provider use case:
 *   - HTTP Upgrade handshake (Sec-WebSocket-Accept via SHA-1)
 *   - Text frames (opcode 0x1), both sending and receiving
 *   - Close frames (opcode 0x8) - graceful shutdown
 *   - Ping/Pong frames (opcodes 0x9 / 0xA) - keepalive
 *   - Client-to-server masking (unmask incoming frames)
 *   - Multiple concurrent clients
 *
 * Not implemented (not needed for MCP):
 *   - Binary frames
 *   - Continuation frames (fragmented messages)
 *   - Per-message compression (permessage-deflate)
 *   - TLS (mobile MCP is localhost-only)
 *
 * Platforms: React Native only (uses react-native-tcp-socket).
 */
import TcpSocket from 'react-native-tcp-socket'
import type { Server, Socket } from 'react-native-tcp-socket'

import { wsAcceptKey } from './sha1'

// ── WebSocket opcodes ────────────────────────────────────────────────────────

const OP_CONTINUATION = 0x0
const OP_TEXT = 0x1
const OP_BINARY = 0x2
const OP_CLOSE = 0x8
const OP_PING = 0x9
const OP_PONG = 0xa

// ── Frame builder (server → client, no masking) ──────────────────────────────

function buildFrame(opcode: number, payload: Buffer): Buffer {
	const len = payload.length
	let header: Buffer

	if (len < 126) {
		header = Buffer.alloc(2)
		header[0] = 0x80 | opcode // FIN=1
		header[1] = len
	} else if (len < 65536) {
		header = Buffer.alloc(4)
		header[0] = 0x80 | opcode
		header[1] = 126
		header.writeUInt16BE(len, 2)
	} else {
		header = Buffer.alloc(10)
		header[0] = 0x80 | opcode
		header[1] = 127
		// Write as two 32-bit halves (payload > 4GB not realistic here)
		header.writeUInt32BE(0, 2)
		header.writeUInt32BE(len, 6)
	}

	return Buffer.concat([header, payload])
}

// ── Frame parser (client → server, masked) ───────────────────────────────────

interface ParsedFrame {
	fin: boolean
	opcode: number
	payload: Buffer
	/** Total bytes consumed from the buffer including header */
	consumed: number
}

/**
 * Try to parse one WebSocket frame from the front of `buf`.
 * Returns null if buf doesn't yet contain a complete frame.
 */
function parseFrame(buf: Buffer): ParsedFrame | null {
	if (buf.length < 2) return null

	const fin = (buf[0] & 0x80) !== 0
	const opcode = buf[0] & 0x0f
	const masked = (buf[1] & 0x80) !== 0
	let payloadLen = buf[1] & 0x7f
	let offset = 2

	if (payloadLen === 126) {
		if (buf.length < 4) return null
		payloadLen = buf.readUInt16BE(2)
		offset = 4
	} else if (payloadLen === 127) {
		if (buf.length < 10) return null
		// Ignore high 32 bits (payloads > 4 GB won't occur over localhost MCP)
		payloadLen = buf.readUInt32BE(6)
		offset = 10
	}

	let maskKey: Buffer | null = null
	if (masked) {
		if (buf.length < offset + 4) return null
		maskKey = buf.slice(offset, offset + 4)
		offset += 4
	}

	if (buf.length < offset + payloadLen) return null

	let payload = buf.slice(offset, offset + payloadLen)
	if (masked && maskKey) {
		const unmasked = Buffer.alloc(payloadLen)
		for (let i = 0; i < payloadLen; i++) {
			unmasked[i] = payload[i] ^ maskKey[i % 4]
		}
		payload = unmasked
	}

	return { fin, opcode, payload, consumed: offset + payloadLen }
}

// ── HTTP upgrade handshake ────────────────────────────────────────────────────

function parseUpgradeHeaders(raw: string): Record<string, string> {
	const headers: Record<string, string> = {}
	const lines = raw.split('\r\n')
	for (let i = 1; i < lines.length; i++) {
		const idx = lines[i].indexOf(':')
		if (idx === -1) continue
		const key = lines[i].slice(0, idx).trim().toLowerCase()
		const val = lines[i].slice(idx + 1).trim()
		headers[key] = val
	}
	return headers
}

function buildUpgradeResponse(acceptKey: string): string {
	return (
		'HTTP/1.1 101 Switching Protocols\r\n' +
		'Upgrade: websocket\r\n' +
		'Connection: Upgrade\r\n' +
		`Sec-WebSocket-Accept: ${acceptKey}\r\n` +
		'\r\n'
	)
}

// ── WSClientSocket ────────────────────────────────────────────────────────────

type MessageHandler = (data: string) => void
type CloseHandler = () => void

class WSClientSocket {
	private _buffer = Buffer.alloc(0)
	private _upgraded = false
	private _httpBuffer = ''
	private _messageHandlers: MessageHandler[] = []
	private _closeHandlers: CloseHandler[] = []
	readonly id: string

	constructor(private tcp: Socket) {
		this.id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

		tcp.on('data', (chunk: Buffer | string) => {
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'binary')
			this._onData(data)
		})

		tcp.on('close', () => {
			this._closeHandlers.forEach((h) => h())
		})

		tcp.on('error', () => {
			this._closeHandlers.forEach((h) => h())
		})
	}

	onMessage(handler: MessageHandler): void {
		this._messageHandlers.push(handler)
	}

	onClose(handler: CloseHandler): void {
		this._closeHandlers.push(handler)
	}

	send(text: string): void {
		if (!this._upgraded) return
		const frame = buildFrame(OP_TEXT, Buffer.from(text, 'utf8'))
		this.tcp.write(frame)
	}

	close(): void {
		try {
			const frame = buildFrame(OP_CLOSE, Buffer.alloc(0))
			this.tcp.write(frame)
		} catch {
			/* ignore */
		}
		this.tcp.destroy()
	}

	// ── Private ────────────────────────────────────────────────────────────────

	private _onData(chunk: Buffer): void {
		if (!this._upgraded) {
			this._httpBuffer += chunk.toString('binary')
			// Wait for the end of HTTP headers (double CRLF)
			if (!this._httpBuffer.includes('\r\n\r\n')) return

			const headers = parseUpgradeHeaders(this._httpBuffer)
			const clientKey = headers['sec-websocket-key']

			if (!clientKey || headers.upgrade?.toLowerCase() !== 'websocket') {
				this.tcp.destroy()
				return
			}

			const accept = wsAcceptKey(clientKey)
			this.tcp.write(buildUpgradeResponse(accept))
			this._upgraded = true

			// Any bytes after the HTTP headers are the start of WS frames
			const headerEnd = this._httpBuffer.indexOf('\r\n\r\n') + 4
			const remaining = this._httpBuffer.slice(headerEnd)
			if (remaining.length > 0) {
				this._buffer = Buffer.concat([this._buffer, Buffer.from(remaining, 'binary')])
				this._processFrames()
			}
			return
		}

		this._buffer = Buffer.concat([this._buffer, chunk])
		this._processFrames()
	}

	private _processFrames(): void {
		while (true) {
			const frame = parseFrame(this._buffer)
			if (!frame) break

			// Advance the buffer past the consumed frame
			this._buffer = this._buffer.slice(frame.consumed)

			switch (frame.opcode) {
				case OP_TEXT:
					this._messageHandlers.forEach((h) => h(frame.payload.toString('utf8')))
					break

				case OP_PING:
					// Respond with Pong
					this.tcp.write(buildFrame(OP_PONG, frame.payload))
					break

				case OP_CLOSE:
					// Echo the close frame and destroy
					this.tcp.write(buildFrame(OP_CLOSE, frame.payload))
					this.tcp.destroy()
					return

				case OP_CONTINUATION:
				case OP_BINARY:
					// Not needed for MCP - ignore
					break

				default:
					break
			}
		}
	}
}

// ── TinyWebSocketServer ──────────────────────────────────────────────────────

export type WSConnectionHandler = (socket: WSClientSocket) => void

export class TinyWebSocketServer {
	// react-native-tcp-socket types are not installed in this workspace, so `Server` resolves to an error type.
	// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
	private _server: Server | null = null
	private _port: number | null = null
	private _clients = new Map<string, WSClientSocket>()

	async listen(port: number, host = '127.0.0.1'): Promise<number> {
		if (this._server) throw new Error('TinyWebSocketServer: already listening')

		return new Promise<number>((resolve, reject) => {
			const server = TcpSocket.createServer((socket: Socket) => {
				const wsSocket = new WSClientSocket(socket)
				this._clients.set(wsSocket.id, wsSocket)
				wsSocket.onClose(() => this._clients.delete(wsSocket.id))
				this._connectionHandler?.(wsSocket)
			})

			server.on('error', (err: Error) => reject(err))

			server.listen({ port, host }, () => {
				const addr = server.address() as { port: number }
				this._port = addr.port
				this._server = server
				resolve(addr.port)
			})
		})
	}

	/**
	 * Register a handler for new WebSocket connections.
	 * Must be set before calling listen().
	 */
	private _connectionHandler: WSConnectionHandler | null = null
	onConnection(handler: WSConnectionHandler): void {
		this._connectionHandler = handler
	}

	close(): void {
		for (const client of this._clients.values()) {
			client.close()
		}
		this._clients.clear()
		this._server?.close()
		this._server = null
		this._port = null
	}

	get port(): number | null {
		return this._port
	}

	get clientCount(): number {
		return this._clients.size
	}
}

export { WSClientSocket }
