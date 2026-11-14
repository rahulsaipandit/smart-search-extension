/**
 * MCP Client - native/mobile types.
 *
 * Protocol primitives (tools, resources, content, capabilities, ParsedToolCall, ...) are defined
 * once in ../../mcp/types and re-exported here. What stays defined in this file are the shapes
 * that genuinely differ on mobile and so cannot be the web ones: MCPServerConfig (optional url,
 * stdio fields), RemoteTransportType ('stdio', no 'auto'), MCPSessionStatus (tier, resourceCount),
 * ResolvedTool (tier instead of serverLabel), ChatMessage (no tool role) and MobileAppConfig.
 *
 * Covers both tiers:
 *   Tier 1 - Remote MCP servers (SSE / StreamableHTTP / stdio)
 *   Tier 2 - Mobile MCP (on-device app-to-app via deep link + localhost WebSocket)
 */
import type {
	MCPToolDefinition,
	MCPToolResult,
	ParsedToolCall,
	SessionStatus,
} from '../../mcp/types'

// ─────────────────────────────────────────────────────────────────────────────
// Protocol primitives - single definition in ../../mcp/types
// ─────────────────────────────────────────────────────────────────────────────

export type {
	JSONSchema,
	JSONSchemaType,
	MCPToolDefinition,
	MCPResourceDefinition,
	MCPPromptDefinition,
	MCPContentItem,
	MCPToolResult,
	MCPResourceContent,
	MCPServerInfo,
	MCPCapabilities,
	SessionStatus,
	ToolCallFormat,
	ParsedToolCall,
} from '../../mcp/types'

// ─────────────────────────────────────────────────────────────────────────────
// Session Status
// ─────────────────────────────────────────────────────────────────────────────

export interface MCPSessionStatus {
	id: string
	label: string
	status: SessionStatus
	errorMessage?: string
	toolCount: number
	resourceCount: number
	lastConnectedAt?: string // ISO timestamp
	tier: 1 | 2
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1 - Remote Server Config
// ─────────────────────────────────────────────────────────────────────────────

export type RemoteTransportType = 'sse' | 'streamable-http' | 'stdio'

export interface MCPServerConfig {
	/** Unique identifier used as session key */
	id: string
	label: string
	transport: RemoteTransportType

	// ── SSE / StreamableHTTP ──────────────────────────────────────────────────
	url?: string
	/**
	 * Additional HTTP headers (e.g. API keys).
	 * Values are stored as references to SecureStorage keys, not plaintext.
	 * Format: { "Authorization": "securestore:brave_api_key" }
	 * The transport resolves "securestore:<key>" before sending.
	 */
	headers?: Record<string, string>

	// ── OAuth2 ────────────────────────────────────────────────────────────────
	oauth?: {
		authorizationEndpoint: string
		tokenEndpoint: string
		clientId: string
		scopes: string[]
		redirectUri: string
	}

	// ── Stdio (native only) ───────────────────────────────────────────────────
	command?: string
	args?: string[]
	env?: Record<string, string>

	// ── Feature flags ─────────────────────────────────────────────────────────
	enabled: boolean
	/** If set, only these tool names are callable. Omit to allow all. */
	allowedTools?: string[]
	/** Max bytes of tool result injected into context. Default: 8192 */
	maxResultBytes?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 - Mobile App Config
// ─────────────────────────────────────────────────────────────────────────────

export interface MobileAppConfig {
	/** Unique identifier - typically the bundle ID / package name */
	id: string
	label: string
	/** Deep link scheme of the tool app, e.g. "notes-mcp" */
	appScheme: string
	/** iOS Bundle ID or Android package name - used for OS identity verification */
	appBundleId: string
	/** If true, skip consent dialog for this app (user has "Always Allow"'d it) */
	trusted: boolean
	/** If set, only these tool names are callable */
	allowedTools?: string[]
	enabled: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified tool entry (both tiers)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedTool extends MCPToolDefinition {
	serverId: string
	tier: 1 | 2
}

// ─────────────────────────────────────────────────────────────────────────────
// Agentic Loop
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant'
	content: string
}

export interface AgenticToolEvent {
	call: ParsedToolCall
	result: MCPToolResult
	durationMs: number
}

export interface AgenticLoopResult {
	answer: string
	toolEvents: AgenticToolEvent[]
	iterations: number
	/**
	 * GuideAxon change (TA-6): why the loop stopped early, when it did. Absent for a normal final answer.
	 *  'aborted'        the caller's signal fired; `answer` is whatever had been produced ('' if nothing)
	 *  'repeated_call'  the model called the same tool with the same arguments again and again
	 *  'ping_pong'      the model alternated between two calls
	 *  'max_iterations' the iteration budget ran out (as before, the model is then asked to summarise)
	 */
	stoppedBy?: 'aborted' | 'repeated_call' | 'ping_pong' | 'max_iterations'
}

export interface AgenticLoopOptions {
	/** Maximum tool-call iterations before forcing a final answer. Default: 5 */
	maxIterations?: number
	streamCallback?: (token: string) => void
	onToolCallStart?: (call: ParsedToolCall) => void
	onToolCallEnd?: (event: AgenticToolEvent) => void
	/**
	 * GuideAxon change (TA-6): stops the loop between steps. `generateCompletion()` itself has no abort support, so a
	 * generation already running finishes and its output is discarded; no further tool is called.
	 */
	signal?: AbortSignal
	/** GuideAxon change (TA-6): the same call this many times in a row stops the loop. Default 3; 0 turns it off. */
	maxRepeats?: number
}

/**
 * Minimal LLM inference interface the AgenticLoop requires.
 * The main app's LLMInference must satisfy this contract.
 */
export interface ILLMInference {
	generateCompletion(
		messages: ChatMessage[],
		options?: Record<string, unknown>,
		streamCallback?: (token: string) => void
	): Promise<string>
}

// ─────────────────────────────────────────────────────────────────────────────
// MCPClientService status map
// ─────────────────────────────────────────────────────────────────────────────

export type MCPStatusMap = Map<string, MCPSessionStatus>
