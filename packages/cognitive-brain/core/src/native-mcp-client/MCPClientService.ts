/**
 * MCPClientService - singleton that manages all MCP sessions across both tiers.
 *
 * Tier 1 (remote):   SSE / StreamableHTTP / stdio sessions
 * Tier 2 (mobile):   on-device deep link + localhost WebSocket sessions (native only)
 * Tool provider:     GuideAxon as an MCP server for other apps (native only)
 *
 * Usage:
 *   const svc = getMCPClientService();
 *   await svc.initialize(serverConfigs, mobileConfigs);
 *   const tools = svc.getAllTools();   // flat list, both tiers
 *
 * Platforms: Web + Native.
 *   - Mobile sessions are silently skipped on web.
 *   - Tool server is silently skipped on web.
 */
import { SSETransport } from '../mcp/transport/SSETransport'
import { StreamableHTTPTransport } from '../mcp/transport/StreamableHTTPTransport'
import type { IToolExecutor } from './AgenticLoop'
import { OAuth2PKCEProvider } from './auth/OAuth2PKCEProvider'
import { MCPSession } from './session/MCPSession'
// ── Platform-conditional imports ─────────────────────────────────────────────
// Metro bundler picks .native.ts over .ts at build time.
// On web, MobileSession is re-exported as MCPSession (a no-op stub) and
// MobileToolServer is undefined.
import { MobileSession } from './session/MobileSession'
import type {
	MCPServerConfig,
	MCPSessionStatus,
	MCPStatusMap,
	MobileAppConfig,
	ResolvedTool,
	SessionStatus,
} from './types'

// MobileToolServer is native-only; dynamic import prevents web bundle breakage.
type MobileToolServerType = import('./mobile/MobileToolServer.native').MobileToolServer

// ─────────────────────────────────────────────────────────────────────────────

type StatusListener = (statuses: MCPStatusMap) => void

export class MCPClientService implements IToolExecutor {
	private _sessions = new Map<string, MCPSession>()
	private _toolServer: MobileToolServerType | null = null
	private _statusListeners: StatusListener[] = []

	// ── Initialization ─────────────────────────────────────────────────────────

	/**
	 * Connect to all configured servers.
	 * Failures are swallowed per-session (graceful degradation).
	 */
	async initialize(
		serverConfigs: MCPServerConfig[] = [],
		mobileConfigs: MobileAppConfig[] = []
	): Promise<void> {
		await Promise.allSettled([
			...serverConfigs.filter((c) => c.enabled).map((c) => this.addServer(c)),
			...mobileConfigs.filter((c) => c.enabled).map((c) => this.addMobileApp(c)),
		])
	}

	// ── Tier 1 ─────────────────────────────────────────────────────────────────

	async addServer(config: MCPServerConfig): Promise<void> {
		const transport = this._createRemoteTransport(config)
		const session = new MCPSession(transport, config)

		session.onStatusChange(() => this._notifyListeners())
		this._sessions.set(config.id, session)
		this._notifyListeners()

		try {
			await session.connect()
		} catch (err) {
			console.warn(`[MCPClientService] failed to connect to "${config.label}":`, err)
		}

		this._notifyListeners()
	}

	async removeServer(id: string): Promise<void> {
		const session = this._sessions.get(id)
		if (!session) return
		await session.disconnect().catch(() => {})
		this._sessions.delete(id)
		this._notifyListeners()
	}

	// ── Tier 2 Host ────────────────────────────────────────────────────────────

	async addMobileApp(config: MobileAppConfig): Promise<void> {
		if (typeof window !== 'undefined' && !('ReactNativeWebView' in window)) {
			// Web - Mobile MCP not available
			return
		}

		let LocalWebSocketTransport: typeof import('./transport/LocalWebSocketTransport.native').LocalWebSocketTransport
		try {
			;({ LocalWebSocketTransport } = await import('./transport/LocalWebSocketTransport.native'))
		} catch {
			console.warn('[MCPClientService] LocalWebSocketTransport not available on this platform')
			return
		}

		const transport = new LocalWebSocketTransport({
			appScheme: config.appScheme,
			appBundleId: config.appBundleId,
			trustedBundleIds: config.trusted ? [config.appBundleId] : [],
		})

		// MobileSession (native) adds bundle-ID verification + consent
		const session = new MobileSession(transport as never, config as never)
		session.onStatusChange(() => this._notifyListeners())
		this._sessions.set(config.id, session)
		this._notifyListeners()

		try {
			await session.connect()
		} catch (err) {
			console.warn(`[MCPClientService] Mobile MCP pairing failed for "${config.label}":`, err)
		}

		this._notifyListeners()
	}

	async removeMobileApp(id: string): Promise<void> {
		await this.removeServer(id) // same logic
	}

	// ── Tier 2 Tool Provider ───────────────────────────────────────────────────

	async startToolServer(
		builtInTools: import('./mobile/MobileToolServer.native').MobileToolServerConfig['tools']
	): Promise<void> {
		let MobileToolServer: typeof import('./mobile/MobileToolServer.native').MobileToolServer
		try {
			;({ MobileToolServer } = await import('./mobile/MobileToolServer.native'))
		} catch {
			console.warn('[MCPClientService] MobileToolServer not available on web')
			return
		}

		if (this._toolServer) {
			await this._toolServer.stop()
		}

		this._toolServer = new MobileToolServer({ tools: builtInTools })
		await this._toolServer.start()
	}

	async stopToolServer(): Promise<void> {
		await this._toolServer?.stop()
		this._toolServer = null
	}

	// ── Unified tool access ────────────────────────────────────────────────────

	/**
	 * Returns all available tools from all ready sessions (both tiers).
	 * The AgenticLoop consumes this list.
	 */
	getAllTools(): ResolvedTool[] {
		const tools: ResolvedTool[] = []

		for (const [, session] of this._sessions) {
			if (session.status !== 'ready') continue
			const tier = session instanceof MobileSession ? 2 : 1
			for (const tool of session.tools) {
				tools.push({ ...tool, serverId: session.id, tier })
			}
		}

		return tools
	}

	/** IToolExecutor implementation - called by AgenticLoop */
	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>
	): Promise<import('./types').MCPToolResult> {
		const session = this._sessions.get(serverId)
		if (!session || session.status !== 'ready') {
			throw new Error(
				`MCPClientService: session "${serverId}" is not ready (status: ${session?.status ?? 'not found'})`
			)
		}
		return session.callTool(toolName, args)
	}

	// ── Status ─────────────────────────────────────────────────────────────────

	getStatuses(): MCPStatusMap {
		const map: MCPStatusMap = new Map()

		for (const [id, session] of this._sessions) {
			const config = this._getConfig(id)
			map.set(id, {
				id,
				label: config?.label ?? id,
				status: session.status,
				errorMessage: session.errorMessage,
				toolCount: session.tools.length,
				resourceCount: session.resources.length,
				tier: session instanceof MobileSession ? 2 : 1,
			} satisfies MCPSessionStatus)
		}

		return map
	}

	subscribe(listener: StatusListener): () => void {
		this._statusListeners.push(listener)
		return () => {
			this._statusListeners = this._statusListeners.filter((l) => l !== listener)
		}
	}

	get hasTools(): boolean {
		return this.getAllTools().length > 0
	}

	// ── Private ────────────────────────────────────────────────────────────────

	private _createRemoteTransport(config: MCPServerConfig) {
		const authProvider = config.oauth
			? new OAuth2PKCEProvider({
					...config.oauth,
					storageKey: `mcp_oauth_${config.id}`,
				})
			: undefined

		const resolvedHeaders = this._resolveHeaders(config.headers)

		switch (config.transport) {
			case 'streamable-http':
				return new StreamableHTTPTransport({
					url: config.url!,
					headers: resolvedHeaders,
					authProvider,
					onReconnect: () => {
						// After reconnect, session will auto-reload tools via
						// notifications/tools/list_changed or explicit refresh
					},
				})

			case 'sse':
			default:
				return new SSETransport({
					url: config.url!,
					headers: resolvedHeaders,
					authProvider,
				})
		}
	}

	/**
	 * Resolves header values that reference SecureStorage keys.
	 * Format: "securestore:<key>" → resolved synchronously from a pre-loaded cache.
	 *
	 * Note: For simplicity, this synchronous resolution only works for headers
	 * that were pre-loaded at initialization. The async variant (for OAuth) is
	 * handled by OAuth2PKCEProvider in the transport.
	 */
	private _resolveHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
		if (!headers) return undefined

		const resolved: Record<string, string> = {}
		for (const [k, v] of Object.entries(headers)) {
			// Securestore references are resolved at transport build time via
			// the auth provider; leave them as-is here (transport handles it)
			resolved[k] = v
		}
		return resolved
	}

	private _getConfig(id: string): { label: string } | undefined {
		// Configs are embedded in the session object via MCPSession constructor
		// Access via the session's protected config field is not ideal;
		// in practice the main app passes configs through its Zustand store
		return { label: id }
	}

	private _notifyListeners(): void {
		const statuses = this.getStatuses()
		for (const listener of this._statusListeners) {
			try {
				listener(statuses)
			} catch {
				/* ignore */
			}
		}
	}
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: MCPClientService | null = null

export function getMCPClientService(): MCPClientService {
	if (!_instance) _instance = new MCPClientService()
	return _instance
}

/** For testing - replace the singleton */
export function setMCPClientService(instance: MCPClientService): void {
	_instance = instance
}
