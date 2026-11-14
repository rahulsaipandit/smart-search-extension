/**
 * LocalWebSocketTransport - Web stub.
 *
 * Mobile MCP (deep link + localhost WebSocket) is only available on native.
 * This stub ensures the web bundle compiles but throws at runtime if
 * accidentally instantiated on web.
 */
import type { JSONRPCMessage, JSONRPCRequest } from '../../mcp/protocol/jsonrpc'
import type { IMCPTransport } from '../../mcp/transport/IMCPTransport'

export interface LocalWebSocketTransportConfig {
	appScheme: string
	appBundleId: string
	trustedBundleIds?: string[]
}

export class LocalWebSocketTransport implements IMCPTransport {
	// Web stub keeps the native constructor signature so call sites compile on both platforms.
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor
	constructor(_config: LocalWebSocketTransportConfig) {}

	async connect(): Promise<void> {
		throw new Error(
			'LocalWebSocketTransport is not available on web. Mobile MCP requires a native device.'
		)
	}

	async disconnect(): Promise<void> {}

	async send(_message: JSONRPCRequest): Promise<void> {
		throw new Error('LocalWebSocketTransport is not available on web.')
	}

	onMessage(_handler: (msg: JSONRPCMessage) => void): void {}

	readonly isConnected = false
}
