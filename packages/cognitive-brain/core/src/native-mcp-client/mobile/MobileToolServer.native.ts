/**
 * MobileToolServer (native) - GuideAxon acting as a Tier 2 MCP Tool Provider.
 *
 * Allows other AI host apps on the same device to call GuideAxon's built-in
 * tools (memory search, RAG query, character list) via the Mobile MCP protocol.
 *
 * Flow (GuideAxon as server):
 *   1. GuideAxon registers a deep link handler for guideaxon://mcp-connect
 *   2. A host app fires that deep link with port + one-time token
 *   3. GuideAxon starts a TinyWebSocketServer on the given localhost port
 *   4. GuideAxon shows a consent dialog (unless the host is pre-approved)
 *   5. Host connects to ws://127.0.0.1:{port}; handshake token is verified
 *   6. GuideAxon serves JSON-RPC: initialize → tools/list → tools/call
 *
 * Platforms: Native only. Uses react-native-tcp-socket + TinyWebSocketServer.
 */
import { Linking } from 'react-native'

import {
	type JSONRPCMessage,
	type JSONRPCRequest,
	JSONRPC_ERRORS,
	isRequest,
	makeError,
	makeSuccess,
} from '../../mcp/protocol/jsonrpc'
import type { MCPToolDefinition, MCPToolResult } from '../types'
import { ConsentStore } from './ConsentStore'
import { TinyWebSocketServer, type WSClientSocket } from './TinyWebSocketServer.native'

// ── Public types ─────────────────────────────────────────────────────────────

export type BuiltInToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>

export interface MobileToolServerConfig {
	tools: (MCPToolDefinition & { handler: BuiltInToolHandler })[]
	/**
	 * Override the consent check.
	 * Return true to allow, false to deny.
	 * Default: checks ConsentStore, then shows system Alert.
	 */
	onIncomingRequest?: (callerName: string, callerBundleId: string | null) => Promise<boolean>
}

// ── MobileToolServer ─────────────────────────────────────────────────────────

interface PendingConnection {
	port: number
	token: string
	callerName: string
	callerBundleId: string | null
}

export class MobileToolServer {
	private _running = false
	// react-native types are not installed in this workspace, so the subscription type resolves to `any`.
	// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
	private _linkingSubscription: ReturnType<typeof Linking.addEventListener> | null = null

	/** One WS server per incoming connection attempt (listening on the host's requested port) */
	private _activeServers = new Map<number, TinyWebSocketServer>()

	constructor(private config: MobileToolServerConfig) {}

	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────

	async start(): Promise<void> {
		if (this._running) return
		this._running = true

		// Handle deep links that arrive while the app is already running
		this._linkingSubscription = Linking.addEventListener('url', ({ url }) => {
			this._onDeepLink(url).catch((err) => console.warn('[MobileToolServer] deep link error:', err))
		})

		// Handle cold-launch deep link
		const initialUrl = await Linking.getInitialURL()
		if (initialUrl) {
			this._onDeepLink(initialUrl).catch(() => {})
		}

		console.info('[MobileToolServer] started - accepting guideaxon://mcp-connect deep links')
	}

	async stop(): Promise<void> {
		this._running = false
		this._linkingSubscription?.remove()
		this._linkingSubscription = null

		for (const server of this._activeServers.values()) {
			server.close()
		}
		this._activeServers.clear()
	}

	get isRunning(): boolean {
		return this._running
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Deep link handler
	// ─────────────────────────────────────────────────────────────────────────

	private async _onDeepLink(url: string): Promise<void> {
		if (!this._running) return
		if (!url.startsWith('guideaxon://mcp-connect')) return

		let parsed: URL
		try {
			parsed = new URL(url)
		} catch {
			return
		}

		const portStr = parsed.searchParams.get('port')
		const token = parsed.searchParams.get('token')
		const callerName =
			parsed.searchParams.get('callerName') ??
			parsed.searchParams.get('callerScheme') ??
			'Unknown App'
		const callerBundleId = parsed.searchParams.get('callerBundleId') ?? null

		const port = parseInt(portStr ?? '', 10)
		if (!port || !token) {
			console.warn('[MobileToolServer] malformed deep link - missing port or token:', url)
			return
		}

		const pending: PendingConnection = { port, token, callerName, callerBundleId }

		console.info(`[MobileToolServer] incoming request from "${callerName}" (port ${port})`)

		await this._handleIncomingConnection(pending)
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Connection handling
	// ─────────────────────────────────────────────────────────────────────────

	private async _handleIncomingConnection(pending: PendingConnection): Promise<void> {
		const { port, token, callerName, callerBundleId } = pending

		// 1. Get consent
		const allowed = await this._requestConsent(callerName, callerBundleId)
		if (!allowed) {
			console.info(`[MobileToolServer] denied connection from "${callerName}"`)
			return
		}

		// 2. Start WebSocket server on the port the host expects
		if (this._activeServers.has(port)) {
			console.warn(`[MobileToolServer] port ${port} already in use, refusing duplicate`)
			return
		}

		const wsServer = new TinyWebSocketServer()

		wsServer.onConnection((socket) => {
			this._handleWSConnection(socket, token, callerName, port)
		})

		try {
			await wsServer.listen(port)
			this._activeServers.set(port, wsServer)
			console.info(
				`[MobileToolServer] WebSocket server listening on port ${port} for "${callerName}"`
			)
		} catch (err) {
			console.warn(`[MobileToolServer] failed to start WS server on port ${port}:`, err)
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Per-connection session
	// ─────────────────────────────────────────────────────────────────────────

	private _handleWSConnection(
		socket: WSClientSocket,
		expectedToken: string,
		callerName: string,
		port: number
	): void {
		let tokenVerified = false

		socket.onClose(() => {
			// Shut down the single-use server when the connection closes
			const server = this._activeServers.get(port)
			if (server) {
				server.close()
				this._activeServers.delete(port)
				console.info(`[MobileToolServer] "${callerName}" disconnected`)
			}
		})

		socket.onMessage(async (raw) => {
			// ── Token verification on first message ──────────────────────────
			if (!tokenVerified) {
				try {
					const msg = JSON.parse(raw)
					if (msg?.type === 'mcp-handshake' && msg?.token === expectedToken) {
						tokenVerified = true
						socket.send(JSON.stringify({ type: 'mcp-handshake-ack', token: expectedToken }))
						console.info(`[MobileToolServer] "${callerName}" verified ✓`)
					} else {
						console.warn('[MobileToolServer] token mismatch, closing connection')
						socket.close()
					}
				} catch {
					socket.close()
				}
				return
			}

			// ── JSON-RPC dispatch ────────────────────────────────────────────
			let msg: JSONRPCMessage
			try {
				msg = JSON.parse(raw)
			} catch {
				return
			}

			if (!isRequest(msg)) return
			const req = msg as JSONRPCRequest

			try {
				const result = await this._dispatch(
					req.method,
					(req.params as Record<string, unknown>) ?? {}
				)
				socket.send(JSON.stringify(makeSuccess(req.id, result)))
			} catch (err) {
				socket.send(
					JSON.stringify(makeError(req.id, JSONRPC_ERRORS.INTERNAL_ERROR.code, String(err)))
				)
			}
		})
	}

	// ─────────────────────────────────────────────────────────────────────────
	// JSON-RPC dispatch
	// ─────────────────────────────────────────────────────────────────────────

	private async _dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
		switch (method) {
			case 'initialize':
				return {
					protocolVersion: '2024-11-05',
					capabilities: { tools: {} },
					serverInfo: { name: 'GuideAxon', version: '1.0' },
				}

			case 'notifications/initialized':
				return {}

			case 'tools/list':
				return {
					tools: this.config.tools.map(({ handler: _h, ...def }) => def),
				}

			case 'tools/call': {
				const { name, arguments: args = {} } = params as {
					name: string
					arguments?: Record<string, unknown>
				}
				const tool = this.config.tools.find((t) => t.name === name)
				if (!tool) {
					throw new Error(`Unknown tool: "${name}"`)
				}
				return tool.handler(args)
			}

			default:
				throw new Error(`Method not found: "${method}"`)
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Consent
	// ─────────────────────────────────────────────────────────────────────────

	private async _requestConsent(
		callerName: string,
		callerBundleId: string | null
	): Promise<boolean> {
		// Custom handler takes priority
		if (this.config.onIncomingRequest) {
			return this.config.onIncomingRequest(callerName, callerBundleId)
		}

		// Check pre-approved list
		if (callerBundleId && (await ConsentStore.isTrusted(callerBundleId))) {
			return true
		}

		// Show system Alert
		const { Alert } = await import('react-native')
		return new Promise<boolean>((resolve) => {
			Alert.alert(
				`"${callerName}" wants to use your AI`,
				`This app wants to access your memories and documents.\n\n${
					callerBundleId ? `App ID: ${callerBundleId}` : 'App identity could not be verified.'
				}`,
				[
					{
						text: 'Always Allow',
						onPress: async () => {
							if (callerBundleId) await ConsentStore.setTrusted(callerBundleId, true)
							resolve(true)
						},
					},
					{ text: 'Allow Once', onPress: () => resolve(true) },
					{ text: 'Deny', style: 'cancel', onPress: () => resolve(false) },
				],
				{ cancelable: false }
			)
		})
	}
}
