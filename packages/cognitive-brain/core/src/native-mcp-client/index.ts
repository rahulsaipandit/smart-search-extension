/**
 * MCP Client (native / mobile layer) - public API barrel.
 *
 * Layering: the shared MCP protocol layer (JSON-RPC, MCPSession, SSE and Streamable HTTP
 * transports, tool-prompt build/parse, PKCE, protocol types) is implemented ONCE in ../mcp and
 * imported from there directly; this directory has no copies or re-export files of it, so the old
 * deep paths (native-mcp-client/protocol/..., transport/{SSE,StreamableHTTP}Transport,
 * toolPrompt/...) no longer exist. Import those from '@page-agent/core/mcp'.
 * What lives only in this directory is mobile-specific: MCPClientService, AgenticLoop, the
 * on-device tool server and local WebSocket transport (mobile/, *.native.ts), MobileSession,
 * ConsentStore, the SecureStorage-backed OAuth2PKCEProvider (its contract differs from the
 * in-memory one in ../mcp/auth), and the mobile config types in types/.
 *
 * Import from the package path (@page-agent/core/native-mcp-client) rather than deep paths.
 *
 * Example:
 *   import { getMCPClientService, AgenticLoop } from '@page-agent/core/native-mcp-client';
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type {
	// Protocol primitives
	MCPToolDefinition,
	MCPResourceDefinition,
	MCPPromptDefinition,
	MCPContentItem,
	MCPToolResult,
	MCPResourceContent,
	MCPCapabilities,

	// Config
	MCPServerConfig,
	MobileAppConfig,
	RemoteTransportType,

	// Runtime
	SessionStatus,
	MCPSessionStatus,
	MCPStatusMap,
	ResolvedTool,

	// Prompt injection
	ToolCallFormat,

	// Agentic loop
	ChatMessage,
	ParsedToolCall,
	AgenticToolEvent,
	AgenticLoopResult,
	AgenticLoopOptions,
	ILLMInference,

	// JSON Schema
	JSONSchema,
} from './types'

// ── Auth ─────────────────────────────────────────────────────────────────────
export type { IOAuth2Provider, OAuth2TokenSet } from './auth/IOAuth2Provider'
export { OAuth2PKCEProvider } from './auth/OAuth2PKCEProvider'

// ── Transport ─────────────────────────────────────────────────────────────────
export type { IMCPTransport } from '../mcp/transport/IMCPTransport'
export { SSETransport } from '../mcp/transport/SSETransport'
export { StreamableHTTPTransport } from '../mcp/transport/StreamableHTTPTransport'
// LocalWebSocketTransport is platform-split; import directly if needed:
//   import { LocalWebSocketTransport } from '@page-agent/core/native-mcp-client/transport/LocalWebSocketTransport'

// ── Protocol ──────────────────────────────────────────────────────────────────
export {
	makeRequest,
	makeNotification,
	makeSuccess,
	makeError,
	parseMessage,
	RequestRegistry,
	isRequest,
	isNotification,
	isResponse,
	isSuccessResponse,
	isErrorResponse,
	JSONRPC_ERRORS,
} from '../mcp/protocol/jsonrpc'
export type {
	JSONRPCRequest,
	JSONRPCNotification,
	JSONRPCResponse,
	JSONRPCMessage,
} from '../mcp/protocol/jsonrpc'

// ── Sessions ──────────────────────────────────────────────────────────────────
export { MCPSession } from './session/MCPSession'
// MobileSession is platform-split; import directly:
//   import { MobileSession } from '@page-agent/core/native-mcp-client/session/MobileSession'

// ── Mobile ────────────────────────────────────────────────────────────────────
export { ConsentStore } from './mobile/ConsentStore'
// MobileToolServer is native-only; import directly:
//   import { MobileToolServer } from '@page-agent/core/native-mcp-client/mobile/MobileToolServer.native'

// ── Tool Prompt ───────────────────────────────────────────────────────────────
export { buildToolSystemPrompt } from '../mcp/invocation/buildToolSystemPrompt'
export { parseToolCall, hasPartialToolCall, stripToolCall } from '../mcp/invocation/parseToolCall'

// ── Core services ─────────────────────────────────────────────────────────────
export { AgenticLoop } from './AgenticLoop'
export type { IToolExecutor } from './AgenticLoop'
export { MCPClientService, getMCPClientService, setMCPClientService } from './MCPClientService'
