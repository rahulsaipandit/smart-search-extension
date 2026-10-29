# Instructions for Coding Assistants

## Project Overview

This is a **monorepo** with npm workspaces:

- **Extension** (`packages/extension/`) - Browser extension (WXT + React)
- **Website** (`packages/website/`) - React docs and landing page. **When working on website, follow `packages/website/AGENTS.md`**

Internal packages:

- **LLMs** (`packages/llms/`) - LLM client with reflection-before-action mental model
- **UI** (`packages/ui/`) - Panel and i18n
- **Memory** (`packages/memory/`) - Hybrid Cognitive Memory Platform (npm: `@page-agent/memory`). Local-first episodic memory, T0/T1 synthesis pipeline, knowledge graph, MCP vault integration, Nemilia agent archetypes. Architecture defined in `packages/extension/docs/designCognitiveBrain.md`.

## Development Commands

```bash
npm start                      # Start website dev server
npm run build:ext              # Build and zip the extension package
npm run typecheck              # Typecheck all packages
npm run test                   # Run unit tests across all workspaces
npm run lint                   # ESLint
```

## Architecture

### Monorepo Structure

Source-first monorepo: library `package.json` exports point to `src/*.ts` during development.

```
packages/
├── website/                 # @page-agent/website (private)
├── llms/                    # @page-agent/llms
├── extension/               # Browser extension
└── ui/                      # @page-agent/ui
```

`workspaces` in `package.json` must be in topological order.

### Module Boundaries

- **LLMs**: LLM client with MacroToolInput contract. Standalone; the extension uses it for Ask mode
- **UI**: Panel and i18n

## Key Files Reference

### LLMs (`packages/llms/`)

| File                      | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/index.ts`            | ⭐ LLM class with retry logic                                              |
| `src/types.ts`            | MacroToolInput, AgentBrain, LLMConfig                                      |
| `src/OpenAIClient.ts`     | OpenAI-compatible client — used for `openai`/`anthropic`/`local` providers |
| `src/BrowserLLMClient.ts` | WebLLM-backed client for the `browser` provider — see below                |

#### LLM provider dispatch (`browser` / WebLLM)

`LLMConfig.provider` is one of `'openai' | 'anthropic' | 'local' | 'browser'`. The `LLM` constructor (`src/index.ts`) picks the client based on it:

- `openai` / `anthropic` / `local` → `OpenAIClient` (all three speak the OpenAI-compatible REST shape; local just points `baseURL` at a local server).
- `browser` → `BrowserLLMClient`, which loads the model in-page via `@mlc-ai/web-llm`'s `CreateMLCEngine` (main thread, WebGPU/WASM). **No network request is made or expected for this provider** — `baseURL: 'browser://'` is a sentinel value only, never a real URL. Do not add code that calls `fetch()`/`this.config.baseURL` for the browser provider.
- Engines are cached and refcounted by model id in `BrowserLLMClient` (module-level `engineCache`) — loading a model is a multi-hundred-MB download/compile, and callers like `useScopedLLM` (`packages/extension/src/llm/useScopedLLM.ts`) create/dispose an `LLM` instance on every provider/model change. `dispose()` unloads the engine once the last referencing instance disposes, not on every call.
- `@mlc-ai/web-llm` is an **optional peer dependency** of `@page-agent/llms`, dynamically imported only when `provider === 'browser'` is actually used — consumers that never select it don't need it installed.

## Extension Architecture (`packages/extension/`)

The extension is built with WXT + React. Entry point: `src/entrypoints/sidepanel/App.tsx`.

### Two independent LLM provider settings — `apiProvider` vs. `textLLMProvider`

`UnifiedSettings` (`src/shared/settings.ts`) carries **two separate provider selections** that
must not be conflated:

- `apiProvider` — the **navigation agent's** provider (multimodal: interprets page structure,
  drives clicks/inputs). Set from the main Settings page.
- `textLLMProvider` (+ `textLLMModel`/`textLLMEndpoint`) — an optional override for **text-only**
  features that don't need multimodal/navigation capability: Executive Review Prep and any future
  text-only skill. Set from the shared
  `entrypoints/ai-provider-settings/main.tsx` page. When unset (`'use-global'`), these features
  inherit `apiProvider`.

Never resolve a text-only feature's LLM config from raw `settings.apiProvider` /
`createLLMConfigFromProvider(settings)` directly — that ignores the override and reintroduces the
bug where a provider configured for one text feature silently doesn't apply to another, even though
both are "just text" features. Always go
through `getTextLLMConfig(settings)` (`llm/providers/adapter.ts`) — directly, or via the
`useScopedLLM` hook, which already wraps it and returns `LLM | null` (`null` = blocked, same
demo-provider gate as the navigation agent). See `getTextLLMConfig`'s doc comment for the full
decision table.

The extension **is Folder Search**: on-device semantic search over a folder the user picks. There is no agent chat, no content script and no web-page access. Built with WXT + React; the side panel renders `FolderSearch` only (`src/entrypoints/sidepanel/App.tsx`).

The other workspace packages (`ui`, `memory`, …) are separate libraries. The extension does **not** depend on them; only `@page-agent/llms` is used (for Ask mode).

### Source Map

```
src/
├── smart-search-extension/                  # Everything Folder Search (see below)
├── browser-ml/
│   ├── gemma-embeddings.ts         # EmbeddingGemma 2 via transformers.js (offscreen only)
│   └── offscreen-bridge.ts         # sendToOffscreen(): typed message passing with cold-start retry
├── entrypoints/
│   ├── background.ts               # Only opens the side panel from the toolbar icon
│   ├── offscreen/                  # Runs the model, extractors, indexer, search (WORKERS reason only)
│   ├── sidepanel/                  # App.tsx → components/FolderSearch/*
│   ├── folder-search/              # Same UI as a full tab (wide gallery)
│   ├── folder-search-settings/     # Manage page (models, folders, excludes, storage)
│   ├── ai-provider-settings/       # Private LLM for Ask mode (local server or in-browser)
│   ├── browser-llm-settings/       # Download a WebLLM model for Ask mode
│   └── licenses.html
├── accessListControl/              # Supported, unit-tested tab/host policy engine (not wired in; design §14.7)
├── i18n/                           # I18nProvider + locales (en-US, de-DE, zh-CN, zh-HK); picker on the Manage page
├── llm/                            # getTextLLMConfig() + useScopedLLM() for Ask mode
├── shared/                         # settings.ts (Ask-mode LLM only) + storageAdapter.ts
├── lib/                            # parseHtmlToMarkdown (HTML extractor), theme, utils
└── components/                     # ErrorBoundary + shadcn ui primitives
```

### Permissions and privacy rules

- Manifest permissions are exactly `sidePanel`, `storage`, `offscreen`. No `host_permissions`, no `tabs`/`scripting`/`activeTab`, no content scripts, no `externally_connectable`. Adding any of these changes the Web Store review and the privacy story; justify it in the design doc first.
- The offscreen document is created with the `WORKERS` reason only (reasons are fixed at creation). Do not add `USER_MEDIA`/`AUDIO_PLAYBACK`.
- No analytics, no remote config, no network traffic except the user-approved model download.
- `accessListControl/` is kept and supported: any future feature that reads a web tab or host must call `PolicyEngine.evaluate()` first and treat BLOCK as final (design §14.7).
- UI strings go through `t()` and must exist in all four locales (`i18n/locales.test.ts` enforces parity).
- Ask mode sends file excerpts to its LLM, so only **private providers** exist (`local` server or `browser` WebLLM). Do not add cloud providers or a shared demo endpoint.

### On-device ML — must run in the offscreen document

The embedding model, ONNX Runtime and pdf.js load Workers/WASM that the manifest CSP (`wxt.config.js`) only allows from the packed extension's own origin, in practice the offscreen document. **Never import `gemma-embeddings.ts`, `indexer.ts`, `searchIndex.ts`, `modelManager.ts` or `extractors/{pdf,media,text}.ts` from UI code.** UI code calls `folder-search/bridge.ts`. ONNX Runtime is served locally from `public/ort/` (copied by `copyOrtAssets` in `wxt.config.js`); transformers.js's default CDN/`blob:` loading is blocked by the CSP.

### Folder Search (`src/folder-search/`) — local, read-only visual RAG

Design: `packages/extension/docs/designLocalFolderSearch.md`. User picks a folder via the File System Access API (`mode: 'read'` only), it is indexed on-device with EmbeddingGemma 2 (text/vision/audio in one 768-d space, Matryoshka-truncated to `settings.dim`), and queried through one box. Nothing is uploaded; the only network traffic is the user-approved model download.

- **Folder Search is the whole product.** No agent chat exists; do not add entry points for one. See design doc §14.6.
- **Split by context.** UI/pickers/permission/IndexedDB reads live in the side panel (`entrypoints/sidepanel/components/FolderSearch/`, plus `entrypoints/folder-search/` tab and `folder-search-settings/` Manage page). Everything heavy (embedder, extractors, indexer, vector matrices) runs in the **offscreen document** via `folder-search/engine.ts` (`offscreen:folder:*` messages) and is called from the UI only through `folder-search/bridge.ts`. Never import `browser-ml/gemma-embeddings.ts`, `indexer.ts`, `searchIndex.ts`, `modelManager.ts` or `extractors/{pdf,media,text}.ts` from UI code (CSP + bundle weight). `modelCatalog.ts`, `events.ts`, `types.ts`, `settings.ts`, `db.ts` and the pure helpers are safe for the UI.
- **Handles are never sent through `chrome.runtime`.** The `FileSystemDirectoryHandle` is stored in IndexedDB (`folderSearch` DB, `idb`); the offscreen doc reads it from there. Progress goes the other way as `folder:event` broadcasts (`events.ts`).
- **Pure, tested logic:** `classify.ts` (skip rules, secrets), `chunker.ts`, `diff.ts` (incremental rescan), `keywords.ts` (BM25-style + exact-string detection), `ranking.ts` (vector matrix, per-modality z-score calibration, RRF fusion, grouping), `merge.ts`, `walker.ts`, `ask.ts`, `extractors/pure.ts`. Keep new ranking/skip behaviour in these files with tests.
- **Index validity.** `meta` stores an `IndexSignature` (model id, dtype, dim, schema). A mismatch makes `Indexer.run` throw `REINDEX_REQUIRED`; the UI offers an explicit re-index. Toggling the vision/audio encoders alone does not invalidate vectors.
- **ID conventions** (`db.ts`): chunk ids `${fileId}#${idx}`, page images `${fileId}#p${page}`, filename postings `${fileId}#name`, audio/video units `${fileId}@${startSec}`. File ids may contain `#`/`@`; always split with `lastIndexOf` (see `chunkFileOf`/`unitFileOf` in `searchIndex.ts`).
- **Browse view and glass wall.** With an empty query the panel lists indexed files (`Browse.tsx`, pure logic in `browse.ts`). Images, videos and audio are drawn by a WebGL2 "glass" wall in justified rows (`FolderSearch/glass/`): pure `layout.ts` and `layerPool.ts` (both tested), `shaders.ts`, `GlassRenderer.ts` (GL), `GlassWall.tsx` (sticky canvas plus a button layer), `WallMedia.ts` (videos autoplay into their tiles, audio tiles animate a waveform from `drawWaveform.ts`). Clicking opens the lightbox (images) or `MediaViewer` (video/audio). The older CSS wall (`CssWall` in `Browse.tsx`) is the automatic fallback (no WebGL2, context lost, reduced motion). Thumbnails come from IndexedDB in the panel; no external assets; GPU memory is bounded by the layer pool. Audio/video `duration`, video `width`/`height` and audio `waveform` are stored on `FileRecord`; older records are filled in on first display. Keep layout, pool and media-selection rules in the pure/tested files; see design doc §4B.
- **Ask mode** is optional and resolves its LLM through `getTextLLMConfig()` / `useScopedLLM` (private providers only). Retrieval must keep working with no LLM configured.
- `calibrate` priors in `ranking.ts` (`PRIOR_STATS`, `MIN_CALIBRATED`) are unmeasured starting points; tune them on a labeled sample before trusting thresholds.

## Testing

- **Test value**: Do not add redundant tests or directly translate implementation code into assertions. Test meaningful behavior and realistic failure modes.
- **Framework**: Vitest for unit tests; Playwright E2E in `packages/e2e/` (loads the fake-embedder build from `packages/extension/.output/e2e/chrome-mv3-dev`; run `npm run test:build -w @page-agent/e2e` to rebuild and test; the package exposes `test:e2e`, not `test`, so root `npm test` and CI skip it)
- **Location**: co-located, `src/foo.test.ts` next to `src/foo.ts`
- **Coverage today**: `packages/llms` only — other packages will follow incrementally
- **Adding tests to a new package**: create `vitest.config.ts` in the package and add a `"test": "vitest run"` script. Root `npm test` picks it up through npm workspaces.
- **Live tests** (hit real external APIs, slow/costly): name them `*.live.test.ts`, exclude them from the package's `test` script, and expose them via a `test:live` script. Root `npm run test:live` runs all of them; they never run in `npm test` or CI. Template: `packages/llms`.
- **Template**: See @page-agent/llms

```bash
npm test                            # all packages with a test script
npm test -w @page-agent/llms        # single package
cd packages/llms && npx vitest      # watch mode in one package
```

## Code Standards

- Explicit typing for exported/public APIs
- ESLint relaxes some unsafe rules for rapid iteration
- Every change you make should not only implement the desired functionality but also improve the quality of the codebase
- All code and comments must be in English.
- Do not try to hide errors or risks. They are valuable feedbacks for developers and users. Make them visible and actionable.
- Traceability and predictability is more important than success rate.
