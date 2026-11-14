# @page-agent/memory — Coding Assistant Guide

**Package:** `packages/cognitive-brain/memory/` | **npm:** `@page-agent/memory` v1.12.4  
**Design doc:** `packages/cognitive-brain/docs/designCognitiveBrain.md` (authoritative — read before making structural changes)

---

## What This Package Is

A platform-agnostic **Cognitive Memory Platform** — local-first episodic memory, synthesis pipeline, knowledge graph, MCP vault integration, and agent framework. Used by the Chrome extension, the Expo mobile app, and the future desktop app.

**Not** a RAG wrapper. **Not** a chat history store. A full cognitive substrate.

---

## Three Platform Tiers

| Tier          | Platform            | IBrainEngine impl                   | Status                              |
| ------------- | ------------------- | ----------------------------------- | ----------------------------------- |
| Web/Extension | Browser, Chrome SW  | `MemoryService` (IndexedDB + Orama) | ✅ Production                       |
| Mobile        | React Native / Expo | `MemoryService` + `SQLiteStore`     | ✅ Production                       |
| Desktop       | Node.js             | `DesktopBrainEngine`                | ⚠️ Stub — delegates to web adapters |

---

## Key Interfaces (read before adding methods)

| Interface              | File                                     | Role                                                      |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `IBrainEngine`         | `src/interfaces/IBrainEngine.ts`         | Universal memory interface — all platforms implement this |
| `IMemoryService`       | `src/interfaces/IMemoryService.ts`       | Extended CRUD surface (superset of IBrainEngine)          |
| `IMemoryStore`         | `src/interfaces/IMemoryStore.ts`         | Storage backend contract                                  |
| `IMemoryIndex`         | `src/interfaces/IMemoryIndex.ts`         | Search index contract                                     |
| `IVaultProvider`       | `src/interfaces/IVaultProvider.ts`       | MCP vault contract                                        |
| `IIntelligenceEngine`  | `src/interfaces/IIntelligenceEngine.ts`  | Agent orchestration (web/mobile only)                     |
| `ISkillRegistry`       | `src/interfaces/ISkillRegistry.ts`       | Skill execution                                           |
| `IWorkflowPersistence` | `src/interfaces/IWorkflowPersistence.ts` | Workflow state                                            |

---

## Important File Locations

### Core entry points

- `src/index.ts` — all public exports
- `src/types.ts` — all canonical types (single source of truth)
- `src/orchestration/` — `SmritiOrchestrator`, `ConsolidationManager`, `InferenceAdapter` (subpath `@page-agent/memory/orchestration`). Web-tier: built on the IndexedDB adapters, so never export it from the root. The host calls `configureInferenceAdapter()` once at startup (the extension does it in `extension/src/memory/inferenceWiring.ts`)
- `src/factory.ts` — `createWebBrainEngine()` for browser/extension (exported from `@page-agent/memory/adapters/web`, not the root)
- `src/core/MemoryService.ts` — primary IBrainEngine + IMemoryService implementation

### Processing pipeline

- `src/core/pipeline/Pipeline.ts` — async enrichment, event bus
- `src/core/pipeline/MaintenanceCycle.ts` — 9-phase background maintenance
- `src/core/pipeline/processors/` — T0 (rule-based), T1 (LLM-light), pluggable processors

### Domain logic

- `src/core/working/WorkingMemory.ts` — `WorkingMemoryManager`: salience eviction, 4096t budget, 6 per-type caps
- `src/core/goals/GoalManager.ts` — goals stored as `type='goal'` MemoryEntry
- `src/core/procedural/ProceduralStore.ts` — procedure evolve/patch/merge
- `src/core/wiki/` — WikiIngestionJob (Adamic-Adar edges), WikiPageProcessor, WikiRetriever
- `src/core/context/ContextBuilder.ts` — 6-intent retrieval reranking
- `src/core/retrieval/RetrievalEngine.ts` — SMRITI 6-stage hybrid retrieval (not yet wired into MemoryService)

### Storage adapters

- `src/adapters/web/IndexedDBStore.ts` — IMemoryStore for browser
- `src/adapters/web/OramaIndex.ts` — BM25 + vector hybrid (6-intent), `SemanticSearchBridge`
- `src/adapters/web/IndexedDB*.ts` — SMRITI IDB stores (episodic/semantic/graph/jobs/procedural)
- `src/adapters/mobile/SQLiteStore.ts` — op-sqlite for React Native
- `src/adapters/desktop/DesktopBrainEngine.ts` — STUB: Phase 3 (Postgres/pgvector/Neo4j)
- `src/adapters/desktop/MCPBrainServer.ts` — exposes IBrainEngine as MCP tools

### Agent framework

- `src/agents/WorkflowExecutor.ts` — DAG execution, streaming, ISkillRegistry
- `src/agents/archetypes/definitions.ts` — 8 Nemilia archetypes (SCOUT/LENS/QUILL/FORGE/WEAVE/NEXUS/VISION/TOOLS)
- `src/skills/` — 25 built-in skills, SkillRegistry (Zod-validated, semver, fallbackToLLM)
- `src/persistence/` — InMemory / IndexedDB / Hybrid workflow persistence

### Vault

- `src/vault/NullVaultProvider.ts` — no-op (default in Expo; keeps MCPVaultClient out of bundle)
- `src/vault/MCPVaultClient.ts` — MCP outbound client (Node.js contexts only — has @modelcontextprotocol/sdk dep)
- `src/vault/ObsidianVaultProvider.ts` — Obsidian REST adapter

---

## Critical Rules

### 1. Never import MCPVaultClient from factory.ts, the package root, or any Expo entry point

`MCPVaultClient.ts` imports `@modelcontextprotocol/sdk`, which is not in the Expo app's `node_modules`. Metro resolves ALL `import()` calls statically — dynamic imports do NOT save you. The file graph must never reach `MCPVaultClient.ts` from an Expo entry point. Use `NullVaultProvider` in the factory; let Node.js callers construct `MCPVaultClient` directly from `@page-agent/memory/vault`. The package root (`src/index.ts`) only re-exports `NullVaultProvider`, and also must not export `adapters/web/*`, `factory.ts` (it dynamically imports them) or reach `node:*`. `src/index.noNodeDeps.test.ts` walks the root's import graph and fails if any of those become reachable.

### 2. All types live in types.ts

Do not define new types in implementation files or `core/types/`. The `core/types/ProcedureRecord.ts` is a known stale duplicate that should be deleted. Add to `types.ts` and export from `index.ts`.

### 3. IBrainEngine does not know about agents

`IBrainEngine` has no concept of workflows, archetypes, or skill execution. Keep memory and intelligence layers separated. `MemoryService` is the memory layer. `WorkflowExecutor` + `IntelligenceEngine` are the intelligence layer.

### 4. Writes are non-blocking

`MemoryService.store()` returns the new ID immediately. The pipeline enriches asynchronously. Do not await pipeline completion in the store path.

### 5. Desktop-only code must never reach mobile/web bundles

Files in `adapters/desktop/` that import Node.js built-ins or `@modelcontextprotocol/sdk` must never appear in an import chain reachable from an Expo or browser entry point. This includes `DesktopBrainEngine`, `MCPBrainServer`, `PostgresJobQueue`, and all ingestors.

---

## Known Gaps (do not re-implement without checking first)

1. **DesktopBrainEngine** — delegates to web adapters. Phase 3 (Postgres+pgvector+Neo4j) not started.
2. **RetrievalEngine** — ported from SMRITI, exported, but NOT wired into MemoryService.search(). The primary search path still uses OramaIndex directly.
3. **`core/types/ProcedureRecord.ts`** — stale duplicate; should be deleted.
4. **Vault in getContextPack()** — SmritiOrchestrator returns empty artifacts. Factory always uses NullVaultProvider.
5. **Phase 7: LLM adapter** — WorkflowExecutor needs a bridge from GA's streaming LLM API to its structured tool-call contract.
6. **Phase 8: SynthesisEngine → WikiPageProcessor** — wiki extraction still uses single-pass LLM call.
7. ~~**`ModelTier` alias**~~ — cleaned up. `InferenceRequest.model` and `InferenceResult.model` now use `InferenceTier` directly. The alias and its export are removed.
8. **Thin test coverage** — about 41 test files exist (vitest, `npx vitest run` in this package), mostly around `MemoryService`, the pipeline processors and vault/OKF helpers. Web adapters and the mobile `SQLiteStore` have little coverage; WebGPU/embedding paths have none.

---

## Testing browser code that uses WebGPU (embeddings, on-device models)

The web adapters (`OramaIndex`, embedding services) and any onnxruntime-web / Transformers.js model run in
the browser. Test them with Playwright using **real-GPU WebGPU in headless or headed Chrome**; do not drop to
WASM just because the run is headless.

```js
const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome', // installed Chrome, or 'chromium' for Playwright's bundled build
    headless: true, // new headless mode works with WebGPU; false = visible window
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
})
```

- **Never add `--use-angle=swiftshader`, `--enable-unsafe-swiftshader` or `--use-webgpu-adapter=swiftshader`**
  on a machine with a GPU. They override the real GPU and, without a software Vulkan driver, leave Chrome with
  no adapter (`No available adapters`). Reserve them for GPU-less CI, where WASM is the supported fallback.
- **Detect an adapter explicitly:** `!!(navigator.gpu && await navigator.gpu.requestAdapter())`. With no
  adapter, pass `executionProviders: ['wasm']` only; leaving `webgpu` in the list can make a library apply GPU
  session options to a CPU run and return garbage.
- **Use a persistent profile folder** (git-ignored) so Cache Storage keeps multi-hundred-MB models between runs.
- **Assert the provider:** fail the test when WebGPU was expected but not active, so a silent WASM fallback
  does not pass as a WebGPU result.
- Working example and env switches (`KEV_HEADED`, `KEV_CHANNEL`, `KEV_EXPECT_GPU`, `KEV_SOFTWARE_GPU`):
  `tests/kev-web/` at the repo root, documented under "Browser tests that need WebGPU" in the root `CLAUDE.md`.

---

## Subpath exports

```
@page-agent/memory              → src/index.ts (platform-agnostic core)
@page-agent/memory/interfaces   → src/interfaces/index.ts
@page-agent/memory/adapters/web → src/adapters/web/index.ts
@page-agent/memory/adapters/mobile → src/adapters/mobile/index.ts
@page-agent/memory/adapters/desktop → src/adapters/desktop/index.ts (Node.js only)
@page-agent/memory/vault        → src/vault/index.ts
@page-agent/memory/agents       → src/agents/index.ts
@page-agent/memory/skills       → src/skills/index.ts
@page-agent/memory/persistence  → src/persistence/index.ts
```
