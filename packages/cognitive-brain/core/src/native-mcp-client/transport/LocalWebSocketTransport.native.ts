/**
 * LocalWebSocketTransport (native) - Tier 2 Mobile MCP host transport.
 *
 * Two-phase connection protocol (mmcp / Mobile MCP spec):
 *
 * Phase 1 - Handshake via Deep Links:
 *   1. GuideAxon (host) probes for a free port using react-native-tcp-socket.
 *   2. GuideAxon fires a deep link to the tool app containing the port and
 *      a one-time session token.
 *   3. The tool app validates, shows a consent dialog, then starts its own
 *      WebSocket server on the given localhost port.
 *   4. GuideAxon connects to ws://127.0.0.1:{port} using React Native's
 *      built-in WebSocket client.
 *   5. Both sides exchange the token on the first message for mutual verification.
 *
 * Phase 2 - JSON-RPC 2.0 over localhost WebSocket:
 *   - All communication is on-device; no network required.
 *   - GuideAxon is the JSON-RPC *client* (calls tools/list, tools/call, etc.).
 *   - The tool app is the JSON-RPC *server*.
 *
 * Platforms: React Native only.
 *   Uses react-native-tcp-socket for reliable free-port probing.
 *   Uses React Native's built-in WebSocket for the actual JSON-RPC session.
 */
import { Linking } from 'react-native'
import TcpSocket from 'react-native-tcp-socket'

import { type JSONRPCMessage, type JSONRPCRequest, parseMessage } from '../../mcp/protocol/jsonrpc'

export interface LocalWebSocketTransportConfig {
	/** Deep link scheme registered by the tool app, e.g. "notes-mcp" */
	appScheme: string
	/** iOS Bundle ID or Android package name - used for identity verification */
	appBundleId: string
	/** Pre-approved bundle IDs that skip consent in the tool app */
	trustedBundleIds?: string[]
	/**
	 * Milliseconds to wait for the tool app to start its WS server after
	 * receiving the deep link. Default: 15000ms
	 */
	connectionTimeoutMs?: number
	/**
	 * Interval between WS connection retry attempts in ms. Default: 400ms
	 */
	retryIntervalMs?: number
	/** GuideAxon's own deep link scheme. Default: "guideaxon" */
	callerScheme?: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_MS = 400
const GUIDEAXON_SCHEME = 'guideaxon'

export class LocalWebSocketTransport {
	private _ws: WebSocket | null = null
	private _connected = false
	private _messageHandler: ((msg: JSONRPCMessage) => void) | null = null
	private _sessionToken: string | null = null
	private _port: number | null = null

	constructor(private config: LocalWebSocketTransportConfig) {}

	async connect(): Promise<void> {
		if (this._connected) return

		// 1. Probe for a genuinely free port using TCP bind-then-close
		this._port = await this._probeFreePort()
		this._sessionToken = this._generateToken()

		// 2. Fire deep link to tool app
		await this._fireHandshakeDeepLink(this._port, this._sessionToken)

		// 3. Wait for tool app to start its WS server, then connect and verify
		this._ws = await this._connectWithVerification(
			this._port,
			this._sessionToken,
			this.config.connectionTimeoutMs ?? DEFAULT_TIMEOUT_MS,
			this.config.retryIntervalMs ?? DEFAULT_RETRY_MS
		)

		this._connected = true

		this._ws.addEventListener('close', () => {
			this._connected = false
		})
	}

	async disconnect(): Promise<void> {
		this._ws?.close()
		this._ws = null
		this._connected = false
		this._sessionToken = null
		this._port = null
	}

	async send(message: JSONRPCRequest): Promise<void> {
		if (!this._ws || !this._connected) {
			throw new Error('LocalWebSocketTransport: not connected')
		}
		this._ws.send(JSON.stringify(message))
	}

	onMessage(handler: (msg: JSONRPCMessage) => void): void {
		this._messageHandler = handler
	}

	get isConnected(): boolean {
		return this._connected
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Free port probing
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Bind a TCP server on port 0 (OS assigns a free port), record the port,
	 * then immediately close the server.
	 *
	 * There is a brief TOCTOU window, but on a sandboxed mobile device this
	 * is extremely unlikely to cause a collision.
	 */
	private _probeFreePort(): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			const probe = TcpSocket.createServer(() => {
				// No-op: we close before any connection arrives
			})

			probe.on('error', (err: Error) => reject(err))

			probe.listen({ port: 0, host: '127.0.0.1' }, () => {
				const addr = probe.address() as { port: number }
				probe.close(() => resolve(addr.port))
			})
		})
	}

	/**
   * Pick a random port in the IANA ephemeral range (49152–65535).
   * On a sandboxed mobile device the collision probability is negligible.
   
  private _probeFreePort(): Promise<number> {
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152 + 1));
    return Promise.resolve(port);
  } */

	// ─────────────────────────────────────────────────────────────────────────
	// Deep link
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Fire a deep link to the tool app.
	 *
	 * Deep link format:
	 *   {appScheme}://mcp-connect
	 *     ?port=<number>          ← localhost port GuideAxon will connect to
	 *     &token=<uuid>           ← one-time session token
	 *     &callerScheme=guideaxon ← GuideAxon's scheme for the ACK deep link
	 *     &callerName=GuideAxon
	 */
	private async _fireHandshakeDeepLink(port: number, token: string): Promise<void> {
		const params = new URLSearchParams({
			port: String(port),
			token,
			callerScheme: this.config.callerScheme ?? GUIDEAXON_SCHEME,
			callerName: 'GuideAxon',
		})

		const url = `${this.config.appScheme}://mcp-connect?${params.toString()}`

		const canOpen = await Linking.canOpenURL(url)
		if (!canOpen) {
			throw new Error(
				`LocalWebSocketTransport: cannot open deep link for scheme "${this.config.appScheme}". ` +
					'Is the target app installed and does it support Mobile MCP?'
			)
		}

		await Linking.openURL(url)
	}

	// ─────────────────────────────────────────────────────────────────────────
	// WebSocket connection + token verification
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Retry connecting to ws://127.0.0.1:{port} until the tool app has started
	 * its server (or the timeout expires), then verify the session token on
	 * the first message.
	 */
	private _connectWithVerification(
		port: number,
		token: string,
		timeoutMs: number,
		retryMs: number
	): Promise<WebSocket> {
		return new Promise<WebSocket>((resolve, reject) => {
			const deadline = Date.now() + timeoutMs
			let settled = false

			const done = (result: WebSocket | Error) => {
				if (settled) return
				settled = true
				if (result instanceof Error) reject(result)
				else resolve(result)
			}

			const tryConnect = () => {
				if (Date.now() > deadline) {
					done(
						new Error(
							`LocalWebSocketTransport: timed out waiting for "${this.config.appScheme}" ` +
								`to start WS server on port ${port}. ` +
								'Did the user approve the connection in the tool app?'
						)
					)
					return
				}

				const ws = new WebSocket(`ws://127.0.0.1:${port}`)
				let tokenVerified = false

				ws.onopen = () => {
					// Send our session token so the tool app can verify our identity
					ws.send(JSON.stringify({ type: 'mcp-handshake', token }))
				}

				ws.onmessage = (event) => {
					if (!tokenVerified) {
						// First message must be the token acknowledgement
						try {
							const data = JSON.parse(event.data as string)
							if (data?.type === 'mcp-handshake-ack' && data?.token === token) {
								tokenVerified = true

								// Now wire up the real JSON-RPC message handler
								ws.onmessage = (e) => {
									try {
										const msg = parseMessage(e.data as string)
										this._messageHandler?.(msg)
									} catch (err) {
										console.warn('[LocalWebSocketTransport] unparseable message:', err)
									}
								}

								done(ws)
							} else {
								ws.close()
								done(
									new Error(
										'LocalWebSocketTransport: handshake token mismatch - ' +
											'possible spoofing or wrong app responded'
									)
								)
							}
						} catch {
							ws.close()
							done(new Error('LocalWebSocketTransport: invalid handshake response'))
						}
						return
					}
				}

				ws.onerror = () => {
					// Tool app not ready yet - close and retry after retryMs
					ws.close()
					if (!settled) setTimeout(tryConnect, retryMs)
				}
			}

			tryConnect()
		})
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────

	private _generateToken(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID()
		}
		// Fallback for older Hermes versions
		return (
			Math.random().toString(36).slice(2) +
			Math.random().toString(36).slice(2) +
			Date.now().toString(36)
		)
	}
}
