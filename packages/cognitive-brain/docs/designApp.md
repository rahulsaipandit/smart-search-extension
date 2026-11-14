# Agentic Brain - Improved integrated version of LLMWiki + GBrain

## Product & Technical Design Document

**Last revised:** 2026-09-10

> **Scope note:** This document describes a separate "executive twin" personal-website project (an `Agentic Brain`/PageAgent showcase site with a `data/executive/*.md` corpus, `packages/website/`, and content specific to that site's owner). **None of this was ever built inside this repo** — `packages/website/` does not exist here, and the `rag.ts`/`memory.ts`/`navigation.ts`/`mcp.ts` tool-file split it describes was never implemented (only a single generic `packages/cognitive-brain/core/src/tools/index.ts` with the 13 built-in PageAgentTools exists, per CLAUDE.md). It has no connection to GuideAxon's actual app (`app/`, `packages/app-core/`). Treat this as reference/aspirational material for a different project that happens to live in this docs folder, not as documentation of GuideAxon's shipped code. `packages/cognitive-brain/mcp/` (referenced below as `mcp_call`'s target) is the vendored `@page-agent/mcp` **agentic control** server (Claude Desktop/Cursor driving a browser) — the opposite MCP direction from what this doc's `mcp_call` tool describes; see `packages/cognitive-brain/docs/MCP-Server-Client-Design.md` for the real distinction.

---

## Project Overview

This is the core Agentic Brain package to be reused across several Expo apps (both Web and Native)

The package combines:

- conversational AI with persistent memory
- local LLM inference via WebGPU for Web platform and app inference via Orchestrator for Native apps. Inference runs entirely in the App for Native and browser for web using WebGPU and WebLLM. No data leaves the device.
- hybrid BM25 + vector RAG for Web
- multi-agent orchestration
- MCP-powered autonomous tasks
- Multi-agent workflows, and MCP tool execution — all built on the same reflection-before-action model.

---

## Agentic Tool Library

These are the custom tools registered with `PageAgentCore` via `customTools`. Each is a standalone module exported from `packages/core/src/tools/` — reusable by any PageAgent consumer.

---

### `search_knowledge_base`

**Purpose:** Hybrid BM25 + vector retrieval from the executive's corpus.

```typescript
// packages/core/src/tools/rag.ts
export const createSearchKnowledgeBaseTool = (store: RAGStore) =>
    tool({
        description: `Search Rahul Pandit's knowledge base (resume, talks, principles,
      architecture notes, blog posts). Call this before answering any factual
      question about his experience, views, or background. Returns grounded
      chunks with source metadata.`,
        inputSchema: z.object({
            query: z.string().describe('Natural language search query'),
            topK: z.number().optional().default(6).describe('Number of chunks to retrieve'),
            source: z
                .enum(['resume', 'principles', 'talks', 'blog', 'architecture', 'github', 'all'])
                .optional()
                .default('all')
                .describe('Narrow search to a specific source file'),
        }),
        execute: async function (input) {
            const chunks = await store.hybridSearch(input.query, input.topK, input.source)
            return JSON.stringify({
                chunks: chunks.map((c) => ({
                    text: c.text,
                    source: c.source,
                    score: c.score,
                })),
            })
        },
    })
```

**Example call trace:**

```json
{
    "tool": "search_knowledge_base",
    "input": {
        "query": "distributed systems scaling Amazon Alexa",
        "topK": 6,
        "source": "resume"
    },
    "output": {
        "chunks": [
            {
                "text": "Directed a cross-discipline organization (30+) responsible for Alexa's real-time LLM inference platform, personalization engine, and autonomous agent systems serving 200M+ customers worldwide.",
                "source": "resume.md#amazon-alexa",
                "score": 0.94
            },
            {
                "text": "Managed platform growth from a greenfield stage through development into global General Availability (GA), supporting Amazon's rapid expansion across diverse device families and international locales.",
                "source": "resume.md#amazon-alexa",
                "score": 0.87
            }
        ]
    }
}
```

---

### `remember`

**Purpose:** Persist a memory to IndexedDB across sessions.

```typescript
// packages/core/src/tools/memory.ts
export const createRememberTool = (memoryStore: MemoryStore) =>
    tool({
        description: `Store an important fact about this visitor or conversation for
      future reference. Use when you learn something meaningful: their role,
      interests, the company they're recruiting for, or a question pattern.
      Stored memories persist across page visits.`,
        inputSchema: z.object({
            key: z.string().describe('Short unique identifier, e.g. "visitor_role"'),
            value: z.string().describe('The fact to remember'),
            category: z
                .enum(['visitor', 'context', 'preference', 'fact'])
                .describe(
                    'visitor=who they are, context=session context, preference=how they like answers, fact=corpus fact'
                ),
            ttl: z
                .number()
                .optional()
                .describe('Time-to-live in days. Omit for permanent storage.'),
        }),
        execute: async function (input) {
            await memoryStore.write(input)
            return `Remembered: ${input.key} = "${input.value}" [${input.category}]`
        },
    })
```

**Example call trace:**

```json
{
    "tool": "remember",
    "input": {
        "key": "visitor_likely_role",
        "value": "Likely a startup CTO or technical investor based on questions about cost reduction and team scaling",
        "category": "visitor",
        "ttl": 30
    },
    "output": "Remembered: visitor_likely_role = \"Likely a startup CTO...\" [visitor]"
}
```

---

### `recall`

**Purpose:** Retrieve relevant memories to personalise the current response.

```typescript
// packages/core/src/tools/memory.ts
export const createRecallTool = (memoryStore: MemoryStore) =>
    tool({
        description: `Retrieve stored memories about this visitor. Call at the start
      of a conversation to personalise the response. Also call mid-conversation
      when a question seems to build on prior sessions.`,
        inputSchema: z.object({
            query: z.string().optional().describe('Semantic search over stored memories'),
            category: z
                .enum(['visitor', 'context', 'preference', 'fact'])
                .optional()
                .describe('Filter by category'),
            limit: z.number().optional().default(5),
        }),
        execute: async function (input) {
            const memories = await memoryStore.read(input)
            if (memories.length === 0) return 'No relevant memories found.'
            return JSON.stringify(memories)
        },
    })
```

**Example call trace (returning visitor):**

```json
{
    "tool": "recall",
    "input": { "category": "visitor", "limit": 5 },
    "output": [
        {
            "key": "visitor_likely_role",
            "value": "Likely a startup CTO or technical investor",
            "category": "visitor",
            "createdAt": "2026-05-20T14:32:00Z"
        },
        {
            "key": "interest",
            "value": "distributed systems and cost reduction",
            "category": "visitor",
            "createdAt": "2026-05-20T14:33:00Z"
        }
    ]
}
```

The agent uses this output to open with:
_"Welcome back — last time we discussed distributed systems and startup cost strategy. Want to continue from there, or explore something new?"_

---

### `navigate_section`

**Purpose:** Scroll the page to a named section and optionally highlight an element. This is the tool that turns the executive twin into a live PageAgent demo.

```typescript
// packages/core/src/tools/navigation.ts
export const createNavigateSectionTool = () =>
    tool({
        description: `Scroll the executive twin page to a specific section and
      optionally highlight content within it. Use when answering a question
      that has a visible counterpart on the page (timeline entry, principle card,
      metric, talk card). Creates a visual connection between the answer and
      the page content.`,
        inputSchema: z.object({
            sectionId: z
                .enum([
                    'hero',
                    'chat',
                    'snapshot',
                    'leadership-principles',
                    'career-timeline',
                    'systems-architecture',
                    'talks-writing',
                    'contact',
                ])
                .describe('Section to scroll to'),
            highlightSelector: z
                .string()
                .optional()
                .describe('CSS selector or data-id of element to highlight within the section'),
            narration: z
                .string()
                .optional()
                .describe('Short text to display as a tooltip on the highlighted element'),
        }),
        execute: async function (input) {
            const el = document.getElementById(input.sectionId)
            if (!el) return `Section "${input.sectionId}" not found on page.`
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            if (input.highlightSelector) {
                const target = el.querySelector(input.highlightSelector)
                if (target) {
                    target.classList.add('agent-highlight')
                    if (input.narration) {
                        target.setAttribute('data-agent-narration', input.narration)
                    }
                    setTimeout(() => target.classList.remove('agent-highlight'), 4000)
                }
            }
            return `Navigated to ${input.sectionId}${input.highlightSelector ? `, highlighted ${input.highlightSelector}` : ''}`
        },
    })
```

**Example call trace:**

```json
{
    "tool": "navigate_section",
    "input": {
        "sectionId": "career-timeline",
        "highlightSelector": "[data-company='amazon-alexa']",
        "narration": "200M+ customers, real-time LLM inference at global scale"
    },
    "output": "Navigated to career-timeline, highlighted [data-company='amazon-alexa']"
}
```

---

### `mcp_call`

**Purpose:** Execute a tool on a configured MCP server for live external data.

```typescript
// packages/core/src/tools/mcp.ts
export const createMCPCallTool = (mcpRegistry: MCPRegistry) =>
    tool({
        description: `Call an external tool via a configured MCP server. Available
      servers are listed in the registry. Use for live data that the corpus
      cannot provide: recent GitHub activity, web search for press/talks,
      calendar events. Only call if the query genuinely benefits from
      real-time data.`,
        inputSchema: z.object({
            server: z.string().describe('MCP server name from the registry'),
            tool: z.string().describe('Tool name on that server'),
            args: z.record(z.unknown()).describe('Tool arguments as key-value pairs'),
        }),
        execute: async function (input) {
            const client = await mcpRegistry.getClient(input.server)
            if (!client) return `MCP server "${input.server}" not configured.`
            const result = await client.call(input.tool, input.args)
            return JSON.stringify(result)
        },
    })
```

**Example call trace (GitHub MCP):**

```json
{
    "tool": "mcp_call",
    "input": {
        "server": "github",
        "tool": "list_repos",
        "args": { "username": "rahulpandit", "sort": "updated", "limit": 5 }
    },
    "output": {
        "repos": [
            {
                "name": "page-agent",
                "description": "AI Agent in your webpage",
                "stars": 412,
                "updatedAt": "2026-05-22"
            },
            {
                "name": "augment-me-platform",
                "description": "...",
                "stars": 18,
                "updatedAt": "2026-05-20"
            }
        ]
    }
}
```

**Example call trace (web search MCP):**

```json
{
    "tool": "mcp_call",
    "input": {
        "server": "brave-search",
        "tool": "search",
        "args": { "query": "Rahul Pandit VP Engineering TechCrunch Disrupt 2024", "count": 3 }
    },
    "output": {
        "results": [
            {
                "title": "TechCrunch Disrupt 2024 — AI Health Startups",
                "url": "https://techcrunch.com/...",
                "snippet": "Augment Me, led by VP of Engineering Rahul Pandit, demonstrated..."
            }
        ]
    }
}
```

---

### MacroToolInput — The Reflection Loop in Action

Every agent step produces a `MacroToolInput` before calling any tool.
This is the reflection-before-action model unique to PageAgent.
Below is a real step trace from Scenario A (engineering culture query):

```json
{
    "evaluation_previous_goal": "I called search_knowledge_base with 'engineering culture'. Got 6 chunks from principles.md and the Amazon Alexa resume section. Coverage looks solid for leadership philosophy.",
    "memory": "Visitor is asking about culture-building. Likely evaluating Rahul as a leader to work with or hire. Should personalise the answer to feel like a peer conversation, not a resume recitation.",
    "next_goal": "Synthesise the retrieved chunks into a coherent answer. Navigate to leadership-principles section while streaming. Store visitor interest as 'engineering culture'.",
    "action": {
        "navigate_section": {
            "sectionId": "leadership-principles",
            "narration": "Rahul's guiding principles"
        }
    }
}
```

```json
{
    "evaluation_previous_goal": "Page scrolled to leadership-principles section. Now synthesising the answer.",
    "memory": "The 'strong teams over heroic individuals' principle resonates most with culture questions. Lead with that.",
    "next_goal": "Emit the final answer. Store memory about visitor interest.",
    "action": {
        "done": {
            "text": "Rahul builds engineering cultures around three pillars..."
        }
    }
}
```

This reflection loop is visible in the Page Agent panel when the meta-demo is active. Visitors can see the agent thinking — which is itself a demonstration of the PageAgent library's core design.

---

## Knowledge Corpus

It can point to a set of Markdown files in the `data/` directory like data/executive/*.md.

```

### Corpus Build Pipeline

```

data/executive/*.md
→ chunk (512 tokens, 128 overlap)
→ embed (all-MiniLM-L6-v2 via Transformers.js, build-time Node.js)
→ BM25 index (build-time)
→ public/corpus.json (chunks + embeddings + BM25 stats)

```

`corpus.json` is gitignored and regenerated on each deploy. Running
`node scripts/embed.mjs` locally regenerates it from current data files.

---

## Retrieval Architecture: Hybrid BM25 + Vector

Pure vector search misses names, acronyms, and specific numbers.
Pure BM25 misses semantic intent. The hybrid approach is mandatory for
a knowledge base that includes "SageMaker", "Alexa", "200M customers",
and "FDA clearance pathway".

```

Query
├── BM25 score (keyword match, built in-memory from corpus.json)
└── Cosine sim (query embedded via Transformers.js, lazy-loaded)
↓
Reciprocal Rank Fusion (RRF merge)
↓
Top-k chunks (k=6 default, configurable)
↓
Context assembly with source metadata
↓
Injected into agent system prompt + MacroToolInput

````

Retrieval is exposed as a `search_knowledge_base` custom tool so the
agent can re-query the corpus mid-conversation with refined terms.

---

## Memory System

### Design (Nemilia-inspired, PageAgent-native)

Persistent memory lives in IndexedDB keyed by visitor session.
The agent writes memories proactively using custom tools — no special output syntax required, unlike Nemilia's `MEMORY[key]: value` approach.

MacroToolInput already has a `memory` field in every step. We extend it: the agent decides during reflection whether a memory is worth
persisting across sessions.

### Memory Tools

```typescript
remember({ key, value, category, ttl? })
  → IndexedDB write
  → category: 'visitor' | 'context' | 'preference' | 'fact'

recall({ query, category? })
  → IndexedDB semantic scan + category filter
  → Returns ranked memories as injection context

forget({ key })
  → Hard delete (GDPR compliance, user-triggered)
````

### Memory Categories

| Category     | Example                                                  | Persistence             |
| ------------ | -------------------------------------------------------- | ----------------------- |
| `visitor`    | "Asked about distributed systems, likely SRE background" | Session + cross-visit   |
| `context`    | "User is at Amazon, recruiter for senior staff role"     | Session only            |
| `preference` | "Prefers concise answers, no bullet lists"               | Cross-visit             |
| `fact`       | "Rahul spoke at re:Invent 2019"                          | Permanent (from corpus) |

### Storage Architecture

Three-tier with automatic fallback (same pattern as Nemilia):

1. **File System API** (Chrome/Edge with folder permission) — no size limit
2. **IndexedDB** — default, cross-session, practical no-limit
3. **localStorage** — emergency fallback only, ~5MB

Auth tokens (MCP servers) stored exclusively in IndexedDB, never localStorage.

---

## Multi-Agent Workflow Architecture

PageAgent is single-agent by design. Multi-agent workflows are built
via the `customTools` + `onAfterTask` hooks — no changes to core packages.

### Orchestration Pattern

```
OrchestratorAgent
  → classify query: simple | research | workflow | navigation
      ↓ simple
  SinglePassAgent (RAG + answer, one step)
      ↓ research
  ResearchAgent (multi-step corpus search + synthesis)
      ↓ workflow
  WorkflowEngine:
    Stage 1 (parallel): ResearchAgent + ContextAgent
    Stage 2: SynthesisAgent
    Stage 3 (optional): ValidatorAgent (score ≥ 7/10 or retry)
      ↓ navigation
  NavigatorAgent (DOM scroll + highlight + narrate)
```

### Agent Specialisations

| Agent               | Model              | Tools                       | Purpose               |
| ------------------- | ------------------ | --------------------------- | --------------------- |
| `OrchestratorAgent` | Default (4B)       | classify, dispatch          | Routes queries        |
| `ResearchAgent`     | Default (4B)       | search_kb, recall           | Deep corpus search    |
| `NavigatorAgent`    | Lightweight (1.5B) | navigate_section, highlight | Page interaction      |
| `SynthesisAgent`    | Default (4B)       | search_kb, remember         | Final answer assembly |
| `ValidatorAgent`    | Lightweight (1.5B) | score                       | Quality gating        |

All agents share the same WebLLM engine instance — no additional model downloads per agent.

### Validation + Retry

```typescript
const result = await agent.execute(task)
const score = await validator.score(result) // 1–10
if (score < 7) {
    await agent.execute(`Improve this response: ${result.text}. Score was ${score}/10.`)
}
```

---

## WebLLM ↔ PageAgent Integration

PageAgent's `LLMConfig.customFetch` is the bridge. WebLLM exposes an
OpenAI-compatible interface (`engine.chat.completions.create()`).
No changes to `packages/core` or `packages/llms` required for the bridge.

```
packages/llms/src/WebLLMClient.ts   ← new file
  implements same interface as OpenAIClient
  wraps @mlc-ai/web-llm engine
  exposes as fake HTTP endpoint via customFetch
```

```typescript
// Wire-up (packages/website/src/lib/webllm/adapter.ts)
const engine = await CreateMLCEngine('gemma-3-4b-instruct-q4f16_1')

const webllmFetch: typeof fetch = async (input, init) => {
    const body = JSON.parse(init?.body as string)
    const response = await engine.chat.completions.create(body)
    return new Response(JSON.stringify(response))
}

const agent = new PageAgent({
    baseURL: 'http://webllm.local/v1',
    model: 'gemma-3-4b-instruct-q4f16_1',
    customFetch: webllmFetch,
    customTools: { search_knowledge_base, remember, recall, navigate_section, mcp_call },
    instructions: { system: EXECUTIVE_TWIN_SYSTEM_PROMPT },
})
```

This pattern is fully additive — the same PageAgent config works
unchanged with a remote API (Anthropic, OpenAI, Ollama) by swapping
`customFetch` back to the default and providing a real `baseURL`.

---

## MCP Integration

Model Context Protocol tools are registered as PageAgent custom tools.
Auth tokens stored in IndexedDB only.

### MCP Tool

```typescript
mcp_call({ server, tool, args })
  → transport: streamable HTTP | SSE (auto-detected)
  → token: retrieved from IndexedDB at call time
  → returns structured result injected into agent context
```

### Curated MCP Catalog (for executive twin)

| Server                        | Use case                                           |
| ----------------------------- | -------------------------------------------------- |
| GitHub MCP                    | Live repo activity, recent commits, project status |
| Web Search MCP (Brave/Tavily) | Recent press, conference mentions                  |
| Calendar MCP (optional)       | Upcoming speaking engagements                      |
| Custom MCP                    | Any user-configured endpoint                       |

MCP is opt-in. The page works fully without any MCP connections configured.

---

## PageAgent Meta-Demo

The most distinctive feature: PageAgent (the library) navigates its own
executive twin showcase page. The library demonstrates itself on the
page built to showcase it.

### Trigger

A subtle `"See Page Agent in action"` chip in the chat interface or
hero section. When activated:

```
PageAgent loads with the executive twin as its target
Pre-seeded prompt: "Navigate to Rahul's career timeline and
  summarise his Amazon work. Then scroll to leadership principles."
Agent visibly scrolls, highlights, and narrates sections
Panel shows the reflection-before-action steps live
```

### What it demonstrates

- DOM interaction and navigation
- Semantic understanding of page content
- The `MacroToolInput` reflection loop (visible in Panel)
- That PageAgent works on complex React SPAs

---

### AI Stack

| Layer             | Technology                                            |
| ----------------- | ----------------------------------------------------- |
| LLM inference     | `@mlc-ai/web-llm` + WebGPU                            |
| LLM orchestration | `@page-agent/core` (MacroToolInput loop)              |
| Embeddings        | `@xenova/transformers` (lazy-loaded, query-time only) |
| BM25 index        | `wink-bm25-text-search` or custom implementation      |
| Vector similarity | Cosine similarity (pure JS, no library needed)        |
| Memory store      | IndexedDB via `idb` wrapper                           |
| MCP transport     | Fetch-based SSE/HTTP client                           |

### Model Registry

| Model                           | Size    | Target hardware          | Role                 |
| ------------------------------- | ------- | ------------------------ | -------------------- |
| `gemma-3-4b-instruct-q4f16_1`   | ~2.5 GB | Desktop GPU (≥6 GB VRAM) | Default              |
| `qwen2.5-1.5b-instruct-q4f16_1` | ~1 GB   | Laptop GPU, integrated   | Lightweight fallback |
| `llama-3.2-3b-instruct-q4f16_1` | ~2 GB   | Mid-range                | Alternative          |
| Remote API (user-provided)      | n/a     | Any device, no WebGPU    | No-GPU fallback      |

Model selection: auto-detect GPU capability on first load, suggest appropriate model, user can override.

### Build Scripts

```
scripts/embed.mjs     ← Chunk + embed corpus at build time (Node.js)
scripts/bm25.mjs      ← Build BM25 index from chunks
```

Both output into `public/corpus.json`. Run by `npm run build:corpus`
before `npm run build:website`.

---

## New Files & Packages

### Source files in `packages/website/` (as built)

```
data/executive/                ✅ Phase 1
├── resume.md
├── principles.md
├── talks.md
├── blog.md
├── architecture.md
└── github.md

scripts/                       ✅ Phase 1
└── embed.mjs                  ← chunk + embed + BM25 index (bm25.mjs merged in)

public/
└── corpus.json                ← gitignored, generated by embed.mjs  ✅ Phase 1

src/
├── pages/home-v2/             ✅ Phase 1 + 2 (self-contained page, no shared Header/Footer)
│   ├── index.tsx              ← Main page: voice, chat, skills, agentic run panel
│   └── PixelOrb.tsx           ← Animated state indicator
├── hooks/                     ✅ Phase 1
│   ├── useVoiceInput.ts       ← STT via Web Speech API
│   └── useVoiceOutput.ts      ← TTS via SpeechSynthesis API
└── lib/
    ├── webllm/                ✅ Phase 1 + 2
    │   ├── engine.ts          ← Singleton engine; load, stream, invokeWithTools()
    │   └── models.ts          ← GPU detection, model registry, 6 quantized options
    ├── rag/                   ✅ Phase 1 + 2
    │   ├── store.ts           ← Corpus loader, in-memory BM25 + cosine + RRF
    │   └── pipeline.ts        ← retrieve(), formatContext(), formatCitations()
    ├── memory/                ✅ Phase 2
    │   ├── store.ts           ← IndexedDB read/write with idb, TTL, session isolation
    │   └── types.ts           ← Memory, MemoryCategory, MemoryWriteInput, MemoryReadInput
    ├── agents/                ✅ Phase 2
    │   ├── tools.ts           ← search_knowledge_base, recall, remember,
    │   │                         navigate_section, mcp_call — all agent-callable
    │   └── loop.ts            ← ReAct loop (invokeWithTools → execute → stream),
    │                             streamChatV2, AgentStepEvent, Phase 1 fallback
    ├── mcp/                   ✅ Phase 2 (stub — transport in Phase 3)
    │   └── client.ts          ← MCPRegistry, pre-registered github/brave-search/calendar
    └── twin/
        └── chat.ts            ← Re-exports streamChatV2, AgentStepEvent; Phase 1 streamChat kept
```

**Design vs actual deviations:**

- `lib/webllm/adapter.ts` — not needed; `customFetch` bridge is only required when wiring `PageAgentCore`; direct `invokeWithTools()` on the engine is cleaner for Phase 2
- `lib/rag/bm25.ts` + `vector.ts` — merged inline into `store.ts` (simpler, same logic)
- `lib/memory/tools.ts` — merged into `lib/agents/tools.ts` (tools live with the loop, not with the store)
- `lib/agents/orchestrator.ts`, `specialist.ts`, `validator.ts` — Phase 3; current loop handles up to 3 tool rounds without explicit agent specialisation
- `lib/mcp/registry.ts`, `storage.ts` — merged into `client.ts` for Phase 2 stub; will split in Phase 3
- `packages/llms/WebLLMClient.ts` + `packages/core/tools/memory.ts` etc. — Phase 3; these become the published npm exports once the pattern is proven

### Planned new files in `packages/llms/` (Phase 3)

```
src/
└── WebLLMClient.ts    ← WebLLM engine wrapped as LLM-compatible client (customFetch bridge)
```

### Planned new files in `packages/core/` (Phase 3)

```
src/tools/
├── memory.ts     ← Exported remember/recall/forget tool factories
├── rag.ts        ← Exported search_knowledge_base tool factory
└── mcp.ts        ← Exported mcp_call tool factory
```

These become reusable building blocks any PageAgent consumer can import.

---

## System Prompt Design

```
You are an AI assistant.

You have access to:
- search_knowledge_base: retrieve grounded context from Rahul's corpus
- remember: persist important context across this conversation
- recall: retrieve memories from previous conversations
- navigate_section: scroll to and highlight sections on this page
- mcp_call: run external tools if configured

Guidelines:
- Always call search_knowledge_base before answering factual questions
- Never fabricate experience, roles, or metrics
- Maintain a professional, direct executive tone
- Cite the source chunk when referencing specific facts
- If information is not in the corpus, say so clearly
- Use recall at conversation start to surface returning visitor context
- Use remember when you learn something meaningful about the visitor
```

---

## Non-Functional Requirements

### Performance

| Target                   | Metric                                      |
| ------------------------ | ------------------------------------------- |
| Model load (cached)      | < 3 seconds                                 |
| Model load (first visit) | Progress bar showing MB/total; non-blocking |
| Token streaming          | 20–40 tok/s on WebGPU desktop               |
| RAG retrieval            | < 50ms (in-memory BM25 + vector)            |
| Corpus JSON load         | < 200ms (gzip compressed, < 2MB)            |

### Privacy

The site prominently states:

> "Runs entirely in your browser using WebGPU. No conversation data leaves your device."

- No analytics by default
- MCP tokens: IndexedDB only, never transmitted
- Memory: local device only
- `transformPageContent` hook masks any sensitive DOM content before LLM sees it

### Responsiveness

- Desktop: full experience
- Tablet: full experience, condensed layout
- Mobile: static read-only executive profile (no LLM — WebGPU not supported on mobile browsers); agent panel hidden, corpus search over API if user provides key

### Accessibility

- Keyboard navigable
- Screen reader compatible (ARIA live regions for streaming responses)
- WCAG-compliant contrast
- Reduced motion support (`prefers-reduced-motion`)

---

## Visual Design Direction

### Design Language

- executive
- technical
- premium
- restrained

---

## Comparison: What We Took from Nemilia

| Nemilia feature                 | Our adaptation                         | Notes                                |
| ------------------------------- | -------------------------------------- | ------------------------------------ |
| Hybrid BM25 + vector RAG        | ✅ Same approach                       | Build-time index                     |
| Memory system                   | ✅ Custom tools, IndexedDB             | More structured (categories, TTL)    |
| Multi-agent DAG                 | ✅ Via hooks + custom tools            | No visual builder needed             |
| MCP integration                 | ✅ `mcp_call` custom tool              | HTTP/SSE transport                   |
| 3-tier storage                  | ✅ File API → IndexedDB → localStorage | Same fallback order                  |
| Token security (IndexedDB only) | ✅ Same                                |                                      |
| Validation + retry              | ✅ ValidatorAgent                      |                                      |
| Single HTML = no server         | ✅ Static SPA build                    | Vite output = functionally identical |

| What Nemilia cannot do         | Our advantage                           |
| ------------------------------ | --------------------------------------- |
| DOM interaction and navigation | ✅ PageAgent core capability            |
| Navigate its own page          | ✅ Meta-demo                            |
| TypeScript + testing           | ✅ Monorepo                             |
| Evolve as a library            | ✅ Publishable tools (memory, RAG, MCP) |
| BSL 1.1 license                | ✅ MIT                                  |

---

## Security Considerations

- Sanitize markdown rendering (DOMPurify already recommended by PageAgent)
- Limit prompt injection via `transformPageContent` hook
- MCP tokens in IndexedDB only, never in URL or localStorage
- No arbitrary HTML rendering in citation cards
- `experimentalScriptExecutionTool` disabled unless explicitly needed

---

## Success Criteria
