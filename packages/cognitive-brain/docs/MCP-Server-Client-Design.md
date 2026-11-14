# MCP Architecture: Three-Way Comparison & Hybrid Implementation Design

**Status:** Design finalised — hybrid implementation target  
**Date:** 2026-05-26  
**Last revised:** 2026-09-10 (path notes + §10 status correction)  
**Author:** RSP  
**Scope:** What each system does with MCP, pros and cons of each, and how we implement a hybrid approach that serves all clients (website, extension, mobile, npm consumers)

---

## 0. `packages/mcp/` — What It Is and Why It Cannot Hold DATA CONSUMER Code

> **Path note:** every `packages/mcp/` reference in this document (written when this was a standalone monorepo) is now `packages/cognitive-brain/mcp/` inside the GuideAxon repo. The package's internal structure and everything else described below is unchanged — only the outer prefix moved, per the vendoring layout in the repo's root CLAUDE.md.

`packages/mcp/` is published as `page-agent-mcp` on npm. It is the **AGENTIC CONTROL** server — the inverse MCP direction from everything else in this document.

### What it does

External AI clients (Claude Desktop, Cursor, Continue, any MCP-compatible host) install `page-agent-mcp` and it bridges their tool calls into the user's browser:

```
Claude Desktop / Cursor
  ──calls──► packages/mcp/src/index.js   (Node.js stdio MCP server)
               uses @modelcontextprotocol/sdk/server/stdio
               exposes three tools:
                 execute_task(task, config)  → runs a PageAgent task in the browser
                 get_status()               → is the hub connected? is a task running?
                 stop_task()               → cancel the current task
               ──► packages/mcp/src/hub-bridge.js  (HTTP + WebSocket server on localhost:38401)
                     serves launcher.html → triggers Chrome extension to open hub tab
                     WebSocket carries execute/stop commands to the extension
                     ──► chrome.runtime.sendMessage
                           ──► Chrome Extension content script
                                 ──► PageAgent running in the DOM
```

`HubBridge` (`hub-bridge.js`) is an HTTP + WebSocket server (`ws` library, Node.js `http`). It opens `localhost:38401`, serves `launcher.html`, and relays commands via WebSocket to the Chrome extension hub tab. One WebSocket connection at a time — if a second hub connects, it's immediately closed.

### Why DATA CONSUMER code can never go in `packages/mcp/`

| Dimension        | `packages/mcp/` (AGENTIC CONTROL)                                                 | DATA CONSUMER code                                                         |
| ---------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Runtime**      | Node.js process (stdio)                                                           | Browser / React Native                                                     |
| **APIs used**    | `node:fs`, `node:http`, `node:os`, `ws`, `@modelcontextprotocol/sdk/server/stdio` | Browser `fetch`, `AbortSignal.timeout`, `IndexedDB`, browser `EventSource` |
| **Direction**    | **Inbound**: receives calls from external AI clients                              | **Outbound**: makes calls to external MCP data servers                     |
| **Entry point**  | `#!/usr/bin/env node` — spawned as a child process by the AI client               | Imported as a JS module into the browser bundle                            |
| **Transport**    | stdio (`StdioServerTransport`)                                                    | SSE / Streamable HTTP (`fetch` streaming)                                  |
| **Auth storage** | None (stateless bridge)                                                           | IndexedDB (tokens for external MCP servers)                                |

They share only the MCP specification (JSON-RPC 2.0, tool schema format). They have zero code in common and cannot share a package.

### What belongs where

```
packages/mcp/          → AGENTIC CONTROL (inbound from external AI clients)
                          Node.js only. Do not add browser code here.

packages/website/      → DATA CONSUMER (outbound to external data MCP servers)
src/lib/mcp/             Currently: transport.ts, storage.ts, registry.ts, client.ts
                          Works today. Already wired into the agent tools loop.

packages/core/         → DATA CONSUMER (if we want extension/mobile/npm to reuse it)
src/mcp/                 Currently: empty. Would be a promote of website/lib/mcp/
                          with FunctionCallingAdapter + PromptInjectionAdapter added.
```

The DATA CONSUMER code staying in `packages/website/` is fine if the website is the only consumer. It moves to `packages/core/` only when the extension, GuideAxon mobile, or other npm consumers need to reuse the same transport/session/registry logic.

---

---

> **Path note:** `packages/core/` below is now `packages/cognitive-brain/core/` in this repo. `packages/website/` does **not** exist in this repo at all — it was never brought in (confirmed: no `packages/website` directory, no `data/executive/` corpus). Treat every `packages/website/...` reference below as describing a sibling/upstream project's code, not something that ships as part of GuideAxon.

## 1. The Three Systems Being Compared

| System                   | Where it lives                                        | MCP Role                                        | LLM Invocation                                            |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| **PageAgent (current)**  | `packages/core/`, `packages/website/lib/mcp/`         | DATA CONSUMER (stub) + AGENTIC CONTROL SERVER   | OpenAI function-calling API                               |
| **Nemilia**              | External reference (github.com/luislopez1212/Nemilia) | DATA CONSUMER only                              | Remote API (GPT-4 class)                                  |
| **GuideAxon MCP Client** | `packages/extension/docs/mcp-client/`                 | DATA CONSUMER (Tier 1 + Tier 2) + TOOL PROVIDER | Prompt injection (XML/JSON-fence/Hermes) for local models |

---

## 2. What Each System Currently Has

### 2.1 PageAgent (current monorepo state)

**MCP as data consumer (`packages/website/lib/mcp/`):**

The website has a thin stub — a registry with pre-registered servers (github, brave-search, calendar) and a `mcp_call({ server, tool, args })` custom tool. There is no real transport behind it. When the agent calls `mcp_call`, it hits `MCPRegistry.getClient(server)` which returns a stub that throws `"not implemented"`.

**MCP as agentic control (`packages/mcp/`):**

PageAgent exposes itself **as** an MCP server (the inverse direction) so that Claude Desktop, Cursor, and any MCP-compatible AI client can drive the browser via PageAgent. This is a Node.js stdio server with three tools: `execute_task`, `get_status`, `stop_task`. Communication chain: MCP client → stdio → McpServer → HubBridge (localhost:38401 HTTP) → WebSocket → Chrome Extension → content script → PageAgent in-page.

**LLM tool invocation:**

`PageAgentCore` uses the OpenAI function-calling API. The LLM receives a structured `tools` array in the chat completion request and returns structured `tool_calls` in the response. No parsing of raw text required.

**What it lacks:**

- Any real MCP client transport (SSE, StreamableHTTP, or otherwise)
- Auth (OAuth or token storage) for external MCP servers
- Dynamic tool discovery (tools/list + hot-reload)
- Mobile/cross-platform support
- Prompt injection path for local models that don't support function calling

---

### 2.2 Nemilia (external reference)

**MCP approach:** Pure data consumer. Simple HTTP JSON-RPC client — POST `tools/list`, POST `tools/call`. Fixed per-session auth token. No transport auto-detection; user must know if the server is HTTP or SSE. No OAuth. No reconnect. No timeouts.

**Catalog:** Six pre-registered servers: GitHub, Zapier, Exa, Linear, Firecrawl, DeepWiki.

**What it added beyond nothing:**

- Per-run tool cache keyed by stringified server config (correct pattern — avoids `tools/list` latency on every agent turn)
- IndexedDB-only token storage (correct security posture — never localStorage, never URL)
- Three-tier storage fallback: File System API → IndexedDB → localStorage

**What it lacked:**

- Transport auto-detection (Streamable HTTP vs SSE vs plain HTTP)
- Timeouts (`listTools`, `callTool`)
- OAuth 2.0 + PKCE
- Mobile / React Native support
- Any MCP server capability (pure consumer)
- Prompt injection support (designed for GPT-4-class APIs, not local models)

---

### 2.3 GuideAxon MCP Client (`packages/extension/docs/mcp-client/`)

A full layered MCP client library. The most complete of the three.

**Transport layer** (both web and React Native via `fetch` streaming):

- `SSETransport` — GET SSE stream + POST /message, AbortController for clean disconnect
- `StreamableHTTPTransport` — extends SSE with `Mcp-Session-Id`, `Last-Event-ID`, exponential backoff reconnect (1s → 2s → 4s … cap 30s), `onReconnect` callback, `terminateSession()` (MCP 2025-03-26 §3.6)
- `LocalWebSocketTransport.native.ts` — Tier 2 only: TCP port probe (bind port 0, get OS-assigned port, close immediately), deep link handshake, one-time session token, localhost WebSocket

**Auth:**

- Full OAuth 2.0 + PKCE — `code_verifier`/`code_challenge` (SHA-256), CSRF state, token refresh, SecureStore (Keychain/Keystore), 2048-byte JWT size guard
- Tier 2: OS bundle-ID verification (cannot be spoofed) + one-time UUID token

**Protocol (`MCPSession`):**

- JSON-RPC 2.0 `initialize` handshake, `notifications/initialized` ack
- `tools/list`, `resources/list` on connect
- Hot-reload on `notifications/tools/list_changed`
- Per-tool `allowedTools` whitelist
- Result size cap (8KB default) against prompt injection
- `RequestRegistry` — per-request timeouts, `rejectAll` on disconnect

**Tool invocation — PROMPT INJECTION only:**

- `buildToolSystemPrompt` injects tool definitions into system prompt in three formats: `xml` (`<tool_call>…</tool_call>`), `json-fence` (` ```json … ``` `), `hermes` (single-line XML for NousHermes/Functionary)
- `parseToolCall` — format-aware regex, JSON cleanup for LLM whitespace artifacts, `{ name, arguments }` and `{ tool, arguments }` conventions both supported
- `hasPartialToolCall` — streaming suppression: detects incomplete `<tool_call>` opening tag mid-stream, withholds tokens until the block is complete
- `AgenticLoop` — stateless, drives multi-step LLM ↔ tool execution, decoupled from specific LLM via `ILLMInference` interface and from MCPClientService via `IToolExecutor` interface

**Mobile Tier 2:**

- `MobileSession.native.ts` — extends MCPSession with bundle-ID verification + ConsentStore + system Alert
- `TinyWebSocketServer.native.ts` — RFC 6455 WebSocket server over `react-native-tcp-socket` (text frames, close, ping/pong, client-to-server unmasking, multiple concurrent clients)
- `MobileToolServer.native.ts` — GuideAxon as MCP provider to other apps (deep link handler → consent → WS server → JSON-RPC dispatch)
- `ConsentStore.ts` — "Always Allow" bundle IDs in SecureStorage; graceful no-op on web

---

## 3. Pros and Cons

### 3.1 PageAgent Current State

| Pros                                                                                       | Cons                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Two-direction MCP is architecturally unique: both data consumer AND agentic control server | Consumer direction (`lib/mcp/`) is a non-functional stub — nothing works       |
| OpenAI function-calling is cleaner and more reliable than prompt injection                 | No transport, no auth, no dynamic tool discovery                               |
| Already has `customTools` API — MCP tools slot straight in                                 | Website-local — not reusable by extension, mobile, or npm consumers            |
| AGENTIC CONTROL server (`packages/mcp/`) is production-quality for its purpose             | Single invocation strategy — no path for local models without function-calling |

### 3.2 Nemilia

| Pros                                                     | Cons                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Per-run tool cache pattern is correct and clean          | No transport auto-detection — users must configure SSE vs HTTP manually |
| IndexedDB-only token storage is correct security posture | No OAuth — tokens are static strings                                    |
| Proved that browser-native MCP client is viable          | No timeouts — `tools/list` and `callTool` can block indefinitely        |
| Three-tier storage fallback pattern is right             | No reconnect — a network drop kills the session permanently             |
|                                                          | No mobile support                                                       |
|                                                          | No prompt injection support — assumes GPT-4-class API                   |
|                                                          | Pure consumer — no MCP server capability                                |

### 3.3 GuideAxon MCP Client

| Pros                                                                                                               | Cons                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Production-grade transport: reconnect, backoff, resumable streams, session management                              | Prompt injection only — no function-calling path                                                 |
| Full OAuth 2.0 + PKCE with SecureStore                                                                             | Mobile Tier 2 is React Native specific — not relevant for pure browser PageAgent website         |
| Dynamic tool discovery with hot-reload                                                                             | `AgenticLoop` tightly coupled to prompt injection; would need rework to support function-calling |
| `ILLMInference` + `IToolExecutor` interfaces — testable and mockable                                               | Lives in extension docs, not in core — not reusable as-is                                        |
| Cross-platform: `SSETransport` and `StreamableHTTPTransport` use `fetch`, work identically on web and React Native | `TinyWebSocketServer` / deep-link Tier 2 is native-only (correctly)                              |
| Tool result size cap (8KB) against prompt injection attacks                                                        |                                                                                                  |
| `allowedTools` whitelist per session                                                                               |                                                                                                  |
| Atomic server+token deletion — no orphaned credential windows                                                      |                                                                                                  |

---

## 4. Key Architectural Insight: Two Separate MCP Directions

This caused confusion during Phase 2 and must be explicit in every file:

```
Direction 1 — DATA CONSUMER (outbound):
  PageAgent/GuideAxon browser/native
    ──calls──► GitHub MCP server
    ──calls──► Brave Search MCP server
    ──calls──► Calendar MCP server
    ──calls──► Any on-device app (Tier 2, native only)

Direction 2 — AGENTIC CONTROL (inbound, PageAgent-specific):
  Claude Desktop / Cursor / any MCP AI client
    ──calls──► packages/mcp/ (Node.js stdio MCP server)
                  ──► HubBridge (localhost:38401 HTTP + WebSocket)
                        ──► Chrome Extension
                              ──► content script
                                    ──► PageAgent in DOM
```

These two directions **share the MCP protocol specification** (JSON-RPC 2.0, tool schema format) but have **zero code in common**. The DATA CONSUMER direction runs in the browser or React Native. The AGENTIC CONTROL direction runs in Node.js via stdio. Neither GuideAxon nor Nemilia has the AGENTIC CONTROL direction — it is PageAgent's unique value proposition.

**File role comments enforce this separation:**

```
packages/core/src/mcp/         → DATA CONSUMER: outbound calls to external MCP servers
packages/mcp/src/index.js      → AGENTIC CONTROL: inbound calls from external AI clients
```

---

## 5. The Hybrid Implementation

The goal: implement the DATA CONSUMER direction in `packages/core/` so it is reusable by the website, extension, GuideAxon mobile, and any npm consumer — while supporting **both** OpenAI function-calling (for models with native tool-use APIs) **and** prompt injection (for local models without it).

### 5.1 Architecture Overview

```
packages/core/src/mcp/
  ├── types.ts                    ← All shared types (from GuideAxon types/index.ts)
  ├── protocol/
  │   └── jsonrpc.ts              ← JSON-RPC 2.0 helpers + RequestRegistry (from GuideAxon)
  ├── transport/
  │   ├── IMCPTransport.ts        ← Interface (from GuideAxon)
  │   ├── SSETransport.ts         ← Web + Native fetch-streaming (from GuideAxon)
  │   └── StreamableHTTPTransport.ts  ← Reconnect + session + Last-Event-ID (from GuideAxon)
  │   └── LocalWebSocketTransport.ts      ← Web stub (throws, imported on native)
  │   └── LocalWebSocketTransport.native.ts ← Tier 2: TCP probe + deep link + WS client
  ├── auth/
  │   ├── IOAuth2Provider.ts      ← Interface
  │   └── OAuth2PKCEProvider.ts   ← Full PKCE flow (from GuideAxon)
  ├── session/
  │   ├── MCPSession.ts           ← JSON-RPC handshake, tools/list, hot-reload (from GuideAxon)
  │   ├── MobileSession.ts        ← Web stub (re-exports MCPSession)
  │   └── MobileSession.native.ts ← Tier 2: bundle-ID verify + ConsentStore
  ├── mobile/                     ← Native only
  │   ├── sha1.ts
  │   ├── TinyWebSocketServer.native.ts
  │   ├── MobileToolServer.native.ts
  │   └── ConsentStore.ts
  ├── storage.ts                  ← IndexedDB token store (two separate object stores,
  │                                  atomic server+token delete, "securestore:<key>" refs)
  ├── registry.ts                 ← MCPRegistry singleton (from GuideAxon MCPClientService)
  │                                  addServer, addMobileApp, startToolServer, getAllTools, callTool
  ├── invocation/                 ← NEW — decoupled invocation strategies
  │   ├── IInvocationAdapter.ts   ← Interface both adapters implement
  │   ├── FunctionCallingAdapter.ts  ← For OpenAI-compatible models (PageAgent website/core)
  │   └── PromptInjectionAdapter.ts  ← For local models (GuideAxon, WebLLM without tool-calling)
  │       ├── buildToolSystemPrompt.ts  ← xml/json-fence/hermes formats (from GuideAxon)
  │       └── parseToolCall.ts         ← Parser + partial detect + strip (from GuideAxon)
  └── index.ts                    ← Clean barrel export
```

### 5.2 The Invocation Adapter — The Core Hybrid Piece

This is the key design decision that did not exist in any of the three source systems.

```typescript
// packages/core/src/mcp/invocation/IInvocationAdapter.ts

export interface IInvocationAdapter {
    /**
     * Given a list of MCP tools, returns whatever the agent loop needs
     * to make the LLM aware of them.
     *
     * FunctionCallingAdapter: returns Tool[] for the OpenAI `tools` parameter.
     * PromptInjectionAdapter: returns a system prompt addendum string.
     */
    prepareTools(tools: ResolvedTool[]): ToolPreparationResult

    /**
     * Given the raw LLM output, extracts a tool call if present.
     *
     * FunctionCallingAdapter: reads from structured tool_calls in the API response.
     * PromptInjectionAdapter: regex-parses the text for xml/json-fence/hermes blocks.
     */
    extractToolCall(response: LLMResponse): ParsedToolCall | null

    /**
     * Formats a tool result for injection back into the conversation.
     *
     * FunctionCallingAdapter: returns a { role: 'tool', tool_call_id, content } message.
     * PromptInjectionAdapter: returns a { role: 'user', content: '<tool_result>…' } message.
     */
    formatToolResult(call: ParsedToolCall, result: MCPToolResult): ChatMessage
}

export type ToolPreparationResult =
    | { mode: 'function-calling'; tools: OpenAITool[] }
    | { mode: 'prompt-injection'; systemAddendum: string }
```

```typescript
// packages/core/src/mcp/invocation/FunctionCallingAdapter.ts

export class FunctionCallingAdapter implements IInvocationAdapter {
    prepareTools(tools: ResolvedTool[]): ToolPreparationResult {
        return {
            mode: 'function-calling',
            tools: tools.map((t) => ({
                type: 'function' as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                },
            })),
        }
    }

    extractToolCall(response: LLMResponse): ParsedToolCall | null {
        // Reads from response.choices[0].message.tool_calls (OpenAI format)
        const toolCall = response?.choices?.[0]?.message?.tool_calls?.[0]
        if (!toolCall) return null
        return {
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments),
            rawMatch: JSON.stringify(toolCall),
            toolCallId: toolCall.id, // needed for the tool result message
        }
    }

    formatToolResult(call: ParsedToolCall, result: MCPToolResult): ChatMessage {
        const text = result.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as { type: 'text'; text: string }).text)
            .join('\n')
        return {
            role: 'tool',
            tool_call_id: call.toolCallId!,
            content: text,
        }
    }
}
```

```typescript
// packages/core/src/mcp/invocation/PromptInjectionAdapter.ts
import type { ToolCallFormat } from '../types'
import { buildToolSystemPrompt } from './buildToolSystemPrompt'
import { parseToolCall, stripToolCall } from './parseToolCall'

export class PromptInjectionAdapter implements IInvocationAdapter {
    constructor(private format: ToolCallFormat = 'xml') {}

    prepareTools(tools: ResolvedTool[]): ToolPreparationResult {
        return {
            mode: 'prompt-injection',
            systemAddendum: buildToolSystemPrompt(tools, this.format),
        }
    }

    extractToolCall(response: LLMResponse): ParsedToolCall | null {
        const text = response?.choices?.[0]?.message?.content ?? ''
        return parseToolCall(text, this.format)
    }

    formatToolResult(call: ParsedToolCall, result: MCPToolResult): ChatMessage {
        const text = result.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as { type: 'text'; text: string }).text)
            .join('\n')

        switch (this.format) {
            case 'xml':
                return {
                    role: 'user',
                    content: `<tool_result name="${call.name}">\n${text}\n</tool_result>`,
                }
            case 'hermes':
                return {
                    role: 'user',
                    content: `<tool_response name="${call.name}">\n${text}\n</tool_response>`,
                }
            case 'json-fence':
                return {
                    role: 'user',
                    content: `Tool result for \`${call.name}\`:\n\`\`\`\n${text}\n\`\`\``,
                }
        }
    }
}
```

### 5.3 MCPRegistry (unified service, replaces website stub)

The `MCPRegistry` is the `MCPClientService` from GuideAxon, renamed and placed in `packages/core/`:

```typescript
// packages/core/src/mcp/registry.ts
import { OAuth2PKCEProvider } from './auth/OAuth2PKCEProvider'
import { MCPSession } from './session/MCPSession'
import { MobileSession } from './session/MobileSession'
// .native.ts on mobile
import { SSETransport } from './transport/SSETransport'
import { StreamableHTTPTransport } from './transport/StreamableHTTPTransport'
import type { MCPServerConfig, MCPStatusMap, MobileAppConfig, ResolvedTool } from './types'

export class MCPRegistry {
    private _sessions = new Map<string, MCPSession>()
    private _statusListeners: Array<(statuses: MCPStatusMap) => void> = []
    // Module-level tool cache (Nemilia pattern) — keyed by server config hash
    private _toolCache: ResolvedTool[] | null = null
    private _cacheKey = ''

    async initialize(
        serverConfigs: MCPServerConfig[],
        mobileConfigs: MobileAppConfig[] = []
    ): Promise<void> {
        await Promise.allSettled([
            ...serverConfigs.filter((c) => c.enabled).map((c) => this.addServer(c)),
            ...mobileConfigs.filter((c) => c.enabled).map((c) => this.addMobileApp(c)),
        ])
    }

    async addServer(config: MCPServerConfig): Promise<void> {
        const transport =
            config.transport === 'streamable-http'
                ? new StreamableHTTPTransport({
                      url: config.url!,
                      headers: this._resolveHeaders(config.headers),
                      authProvider: config.oauth
                          ? new OAuth2PKCEProvider({
                                ...config.oauth,
                                storageKey: `mcp_oauth_${config.id}`,
                            })
                          : undefined,
                      onReconnect: () => this._invalidateCache(),
                  })
                : new SSETransport({
                      url: config.url!,
                      headers: this._resolveHeaders(config.headers),
                      authProvider: config.oauth
                          ? new OAuth2PKCEProvider({
                                ...config.oauth,
                                storageKey: `mcp_oauth_${config.id}`,
                            })
                          : undefined,
                  })

        const session = new MCPSession(transport, config)
        session.onStatusChange(() => {
            this._invalidateCache()
            this._notifyListeners()
        })
        this._sessions.set(config.id, session)
        await session
            .connect()
            .catch((err) => console.warn(`[MCPRegistry] "${config.label}" failed:`, err))
        this._notifyListeners()
    }

    async addMobileApp(config: MobileAppConfig): Promise<void> {
        // Dynamic import prevents web bundle breakage
        try {
            const { LocalWebSocketTransport } =
                await import('./transport/LocalWebSocketTransport.native')
            const transport = new LocalWebSocketTransport({
                appScheme: config.appScheme,
                appBundleId: config.appBundleId,
                trustedBundleIds: config.trusted ? [config.appBundleId] : [],
            })
            const session = new MobileSession(transport as never, config as never)
            session.onStatusChange(() => {
                this._invalidateCache()
                this._notifyListeners()
            })
            this._sessions.set(config.id, session)
            await session
                .connect()
                .catch((err) =>
                    console.warn(`[MCPRegistry] Mobile pairing failed for "${config.label}":`, err)
                )
            this._notifyListeners()
        } catch {
            console.warn('[MCPRegistry] LocalWebSocketTransport not available on this platform')
        }
    }

    async removeServer(id: string): Promise<void> {
        const session = this._sessions.get(id)
        if (!session) return
        await session.disconnect().catch(() => {})
        this._sessions.delete(id)
        this._invalidateCache()
        this._notifyListeners()
    }

    /**
     * Returns all available tools from all ready sessions.
     * Uses a per-run cache keyed by server config hash (Nemilia pattern).
     */
    getAllTools(): ResolvedTool[] {
        const key = this._computeCacheKey()
        if (this._toolCache && key === this._cacheKey) return this._toolCache

        const tools: ResolvedTool[] = []
        for (const [, session] of this._sessions) {
            if (session.status !== 'ready') continue
            const tier = session instanceof MobileSession ? 2 : 1
            for (const tool of session.tools) {
                tools.push({ ...tool, serverId: session.id, tier })
            }
        }

        this._toolCache = tools
        this._cacheKey = key
        return tools
    }

    async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
        const session = this._sessions.get(serverId)
        if (!session || session.status !== 'ready') {
            throw new Error(`MCPRegistry: session "${serverId}" is not ready`)
        }
        return session.callTool(toolName, args)
    }

    subscribe(listener: (statuses: MCPStatusMap) => void): () => void {
        this._statusListeners.push(listener)
        return () => {
            this._statusListeners = this._statusListeners.filter((l) => l !== listener)
        }
    }

    getStatuses(): MCPStatusMap {
        /* ... */ return new Map()
    }

    private _invalidateCache(): void {
        this._toolCache = null
    }

    private _computeCacheKey(): string {
        return [...this._sessions.keys()].sort().join(',')
    }

    private _resolveHeaders(headers?: Record<string, string>) {
        return headers
    }
    private _notifyListeners() {
        const s = this.getStatuses()
        for (const l of this._statusListeners) {
            try {
                l(s)
            } catch {}
        }
    }
}

let _instance: MCPRegistry | null = null
export const getMCPRegistry = (): MCPRegistry => (_instance ??= new MCPRegistry())
export const setMCPRegistry = (r: MCPRegistry): void => {
    _instance = r
}
```

### 5.4 Storage — IndexedDB with Separate Stores and Atomic Deletion

Adopted from GuideAxon with the two Nemilia-identified improvements:

```typescript
// packages/core/src/mcp/storage.ts
// DATA CONSUMER: token storage for outbound MCP server connections

// Two separate IndexedDB object stores (GuideAxon addition over Nemilia):
//   "mcp-servers"  — server config (URL, name, transport type). Readable without token access.
//   "mcp-tokens"   — serverId → token. Separate to enforce least-privilege access.
//
// Atomic server+token deletion (GuideAxon addition over Nemilia):
//   deleteServer() uses a single transaction removing both records simultaneously.
//   No orphaned server record without a valid token, no orphaned token without a server.
//
// AES-256-GCM encryption: NOT implemented for Phase 3.
//   Rationale: single-user, IndexedDB is origin-isolated (XSS would need to bypass CSP
//   first, which is a stronger protection than application-layer encryption alone).
//   Hook documented here for Phase 4 if multi-user profiles or enterprise API keys are added.
```

### 5.5 Wire-Up Per Consumer

**Website (PageAgent executive twin) — function-calling:**

```typescript
// packages/website/src/lib/agents/loop.ts
import { FunctionCallingAdapter, getMCPRegistry } from '@page-agent/core/mcp'

const registry = getMCPRegistry()
await registry.initialize(serverConfigs)

const adapter = new FunctionCallingAdapter()
const tools = adapter.prepareTools(registry.getAllTools())
// tools.mode === 'function-calling' → pass to engine.chat.completions.create({ tools })
```

**GuideAxon / WebLLM without function-calling — prompt injection:**

```typescript
import { PromptInjectionAdapter, getMCPRegistry } from '@page-agent/core/mcp'

const registry = getMCPRegistry()
const adapter = new PromptInjectionAdapter('xml') // or 'json-fence' or 'hermes'
const prep = adapter.prepareTools(registry.getAllTools())
// prep.mode === 'prompt-injection' → append prep.systemAddendum to system prompt
// After generation: adapter.extractToolCall(response) → ParsedToolCall | null
```

**PageAgentCore custom tool (backward compatible):**

```typescript
// The existing mcp_call customTool pattern still works for simple consumers
// who don't want the full adapter pattern:
import { createMCPCallTool } from '@page-agent/core/mcp'

const agent = new PageAgent({
    customTools: { mcp_call: createMCPCallTool(getMCPRegistry()) },
})
```

---

## 6. Transport Auto-Detection (from designNemiliaParts.md §2.3)

The executive twin's `lib/mcp/transport.ts` already has working three-tier detection logic that predates GuideAxon's explicit `transport: 'sse' | 'streamable-http'` config field. This is worth keeping as an auto-detect mode alongside explicit configuration:

```
1. Try Streamable HTTP first (POST initialize with Content-Type: application/json)
   - If response has protocolVersion → Streamable HTTP confirmed, cache Mcp-Session-Id
2. If step 1 fails → try SSE (GET with Accept: text/event-stream)
   - Parse endpoint event from SSE stream to get POST URL
3. If step 2 fails → plain HTTP fallback (simple POST/GET, no session)
```

Detection is cached per URL in a module-level Map. `MCPServerConfig.transport` can be:

- `'auto'` — run detection sequence above
- `'streamable-http'` — skip detection, use StreamableHTTPTransport directly
- `'sse'` — skip detection, use SSETransport directly

The `'auto'` mode is the right default for user-configured servers. The explicit modes are for curated catalog servers where the transport is known.

---

## 7. What We Are NOT Taking

| Feature                                             | Source                               | Why not                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier 2 LocalWebSocketTransport                      | GuideAxon                            | Native-only, correctly gated with .native.ts — included in file structure but web stub throws. Extension and website don't need it. Mobile consumers (GuideAxon) get it automatically via Metro bundler. |
| TinyWebSocketServer / MobileToolServer              | GuideAxon                            | Native-only tool provider — gated with .native.ts. Not relevant to browser PageAgent.                                                                                                                    |
| Visual flow builder                                 | Nemilia (not present)                | No user value for curated workflows                                                                                                                                                                      |
| File System API as primary storage                  | Nemilia                              | Visitor-alarming UX, not needed at this data scale                                                                                                                                                       |
| AES-256-GCM token encryption                        | Nemilia roadmap / GuideAxon deferred | Single-user, origin-isolated IndexedDB. Documented Phase 4 upgrade path.                                                                                                                                 |
| Chrome AI (Gemini Nano)                             | Nemilia                              | Experimental API, no tool-calling support, non-deterministic availability                                                                                                                                |
| `MEMORY[tag]: value` output syntax                  | Nemilia                              | Fragile with quantized local models; replaced by tool calls                                                                                                                                              |
| AgenticLoop as monolith                             | GuideAxon                            | Split into IInvocationAdapter + MCPRegistry + the agent's own step loop — better separation of concerns                                                                                                  |
| Zapier, Linear, Firecrawl, DeepWiki catalog servers | Nemilia                              | Wrong audience for an executive profile; operator tools, not visitor-facing data                                                                                                                         |

---

## 8. Cross-Platform Matrix

| Component                                | Web                  | React Native               | Node.js         |
| ---------------------------------------- | -------------------- | -------------------------- | --------------- |
| `SSETransport`                           | ✅ fetch streaming   | ✅ fetch streaming         | ✅              |
| `StreamableHTTPTransport`                | ✅                   | ✅                         | ✅              |
| `LocalWebSocketTransport`                | ❌ stub throws       | ✅ .native.ts              | ❌              |
| `MCPSession`                             | ✅                   | ✅                         | ✅              |
| `MobileSession`                          | ✅ stub = MCPSession | ✅ .native.ts              | ❌              |
| `TinyWebSocketServer`                    | ❌                   | ✅ react-native-tcp-socket | ❌              |
| `MobileToolServer`                       | ❌                   | ✅                         | ❌              |
| `ConsentStore`                           | ✅ no-op             | ✅ SecureStorage           | ❌              |
| `OAuth2PKCEProvider`                     | ✅ browser redirect  | ✅ expo-linking            | ❌              |
| `FunctionCallingAdapter`                 | ✅                   | ✅ (if model supports)     | ✅              |
| `PromptInjectionAdapter`                 | ✅                   | ✅                         | ✅              |
| `MCPRegistry`                            | ✅                   | ✅                         | ✅              |
| Token storage                            | IndexedDB            | MMKV / SecureStore         | Keychain / file |
| `packages/mcp/` (AGENTIC CONTROL server) | ❌                   | ❌                         | ✅ stdio only   |

---

## 9. Security

### Tier 1 (Remote servers)

1. `allowedTools` whitelist per session — callable tool restriction
2. SSRF prevention — user must explicitly add each server URL; no auto-discovery
3. 8KB result size cap — truncates tool results before context injection to prevent prompt injection via oversized payloads
4. No plaintext credentials — headers use `"securestore:<key>"` indirection; OAuth tokens in Keychain/Keystore/IndexedDB depending on platform
5. OAuth 2.0 + PKCE — no implicit flow; PKCE prevents authorization code interception; `state` parameter prevents CSRF
6. Atomic server+token deletion — no credential orphan window

### Tier 2 (Mobile, native only)

1. OS-verified identity — iOS Universal Links / Android App Links guarantee bundle ID; cannot be spoofed
2. One-time session token — `crypto.randomUUID()` per connection; echoed and verified before any JSON-RPC proceeds
3. Localhost-only binding — `TinyWebSocketServer` binds to `127.0.0.1` only; no external interface exposed
4. Mandatory consent — every new pairing requires explicit user approval; ConsentStore for "Always Allow"

---

## 10. Implementation Status

### ✅ Already done — `packages/mcp/` (AGENTIC CONTROL server)

**Do not modify this for DATA CONSUMER work.**

- `src/index.js` — Node.js stdio MCP server, exposes `execute_task`, `get_status`, `stop_task`
- `src/hub-bridge.js` — HTTP (localhost:38401) + WebSocket bridge to Chrome extension hub tab
- `src/launcher.html` — Opens the extension hub tab in the browser
- Published as `page-agent-mcp` on npm. Production quality.

### ✅ Already done — `packages/website/src/lib/mcp/` (DATA CONSUMER, website-only)

All four files are fully implemented and wired into the agent tool loop:

- `transport.ts` — Three-tier transport detection (Streamable HTTP → SSE → plain HTTP), `Mcp-Session-Id` session caching, 8s/60s timeouts. **Working.**
- `storage.ts` — IndexedDB with separate `servers`/`tokens` stores, atomic deletion via single transaction, `idb` library. **Working.**
- `registry.ts` — Catalog (GitHub, Brave Search, Exa, Perplexity, Calendar), resolver, `formatMCPToolsForPrompt`. **Working.**
- `client.ts` — `MCPClient` singleton with `getServers`, `connectCatalogServer`, `addCustomServer`, `removeServer`, `updateToken`, `getAllTools`, `callTool`, `testConnection`. **Working.**
- `tools.ts` — `mcp_call` tool wired to `mcpClient.callTool()`, graceful error fallback. `navigate_section` tool with `agent-highlight` CSS class + DOM scroll + `twin:navigate` event. **Working.**

### ✅ Already done — `packages/extension/docs/mcp-client/` (GuideAxon reference implementation)

Full layered implementation used as reference for the hybrid design. Not in production — reference only.

### 🔲 Missing from Phase 3 (website features, build in `packages/website/`)

- **Settings UI** — `src/pages/home-v2/MCPSettings.tsx` — Add/remove MCP servers, connect catalog servers with token, test connection, show status (ready/error/connecting)
- **ValidatorAgent** — `src/lib/agents/validator.ts` — Buffer first synthesis, score 1–10, retry once if score < 7, then stream validated response
- **"See Page Agent in action" trigger** — chip in chat UI that pre-seeds a PageAgent demo workflow

### ✅ Done, ahead of this doc's own schedule — `packages/cognitive-brain/core/src/mcp/` (this doc previously marked it "Phase 4 — Future")

This section is stale. The promotion described below as a future step already happened: `packages/cognitive-brain/core/src/mcp/invocation/IInvocationAdapter.ts`, `FunctionCallingAdapter.ts`, and `PromptInjectionAdapter.ts` (with `buildToolSystemPrompt.ts`/`parseToolCall.ts`) all exist and are non-trivial implementations, not stubs. `registry.ts`, `storage.ts`, and `catalog.ts` are also present there.

Note this means there are now **two parallel MCP client stacks** under `packages/cognitive-brain/core/src/`:

- `mcp/` — vendored web-path DATA CONSUMER (this section), with the invocation-adapter hybrid described in §5
- `native-mcp-client/` — GuideAxon-authored native-path DATA CONSUMER (see `docs/Misc/MCP-Client-Design.md`), which does **not** have the invocation-adapter split — it is prompt-injection only, wired directly into `packages/app-core/hooks/ChatModeOrchestrator.native.ts`'s `handleAgenticMessage`

These have not been unified. If you're adding a capability to one (e.g. transport auto-detection, a new auth provider), check whether the other needs the same change — they currently drift independently.

Originally-planned promotion triggers, still relevant if the two stacks are ever merged:

- The Chrome extension needs to make outbound MCP calls, OR
- We publish `@page-agent/mcp-client` as a standalone npm package
- Transport auto-detect `'auto'` mode in `MCPServerConfig` — still not implemented in either stack as of this writing; verify before relying on it

---

## 11. What We Would Do Differently if Starting Again (from designNemiliaParts.md §6)

**IInvocationAdapter from day one.** The function-calling vs prompt-injection split should have been the first design decision, not the last. Both GuideAxon (prompt injection only) and PageAgent (function calling only) painted themselves into a corner. The adapter pattern is the fix.

**MCPRegistry as a standalone `@page-agent/mcp-client` npm package.** The transport + session + registry layer has zero dependency on LLM invocation strategy, DOM manipulation, or any specific app. It could be published independently and used by any MCP client application. Phase 4 target.

**Transport cache key includes `protocolVersion`.** Current cache key is stringified server config. If a server changes its MCP protocol version during a rolling update, the cached transport type goes stale. Smarter key: hash of `config.id + config.url + initialize_response.protocolVersion`.

**ValidatorAgent score prompt should be domain-specific.** The generic "rate this 1-10" judge prompt misses domain-specific quality failures. A domain-specific prompt — "Rate this response about an executive's career, where 10 means specific company names, role titles, metric values, and dates are present" — catches the failures that matter.
