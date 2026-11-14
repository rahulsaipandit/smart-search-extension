# Adopting `cognitive-brain/` and `browser/` in a sibling repo

**For:** engineers (or coding assistants) in a repo that has the same page-agent monorepo shape and will copy `packages/cognitive-brain/` and `packages/browser/` from `page-agent-rp` and wire its own extension to them.
**Source of truth:** `page-agent-rp`, commits `45fa272c` through `ca0d2006` on `main` (the diff against `4d8fb951` shows every change described here). Background and reasoning: `packages/cognitive-brain/docs/ReusablePackagesReview.md`.

> **What was and was not verified.** In `page-agent-rp` the library and extension typechecks pass, the development and production `wxt build` pass, lint is clean, and the unit tests pass except 3 `aeoFixes` tests that were already failing. Nothing was bundled with Metro or run on Android, and the built extension was not loaded in Chrome. "Android-safe" below means "no obvious platform dependency in the code", not "tested on a device".

---

## 0. Notes from adopting it in GuideAxon (the Expo app repository)

This document was written in `page-agent-rp`; this section records what GuideAxon found. GuideAxon received the two folders on 2026-11-01 and differs from it in these
ways. Where the sections below say otherwise, this section wins for GuideAxon.

| Topic                                      | In GuideAxon                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspaces                                 | None. The root `package.json` has no `workspaces` and `node_modules/@page-agent` does not exist. Packages are reached through aliases in `babel.config.js` and `tsconfig.json`: `@/packages/*`, `@page-agent/llms`, `@/packages/storage-suite`, `@page-agent/storage-suite` and `@page-agent/storage-suite/secure-storage`. Vitest has its own alias in `cognitive-brain/core/vitest.config.ts`.                                                                      |
| Base tsconfig                              | `tsconfig.base.json` at the repo root, as in the sibling repo, so each package extends `../../../tsconfig.base.json` (section 4.2). GuideAxon used to keep it at `packages/tsconfig.base.json` (packages extended `../../`); that copy is gone. Without a root file, `tsc` fails with TS5083 and vitest with "Failed to load tsconfig"; an empty one loads but drops `strict` and the other options.                                                                  |
| `extension/`, `companion-app/`, `website/` | Not in GuideAxon. `mcp/` is `packages/mcp`.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Two Metro configs                          | `metro.config.js` is the active one; `metro.config.Web.js` and `metro.config.Native.js` are the flavors. Check both bundles (`CLAUDE.md`, "Checking that both bundles compile").                                                                                                                                                                                                                                                                                      |
| transformers.js                            | `storage-suite/src/embeddings/transformersLoader.ts` replaces the sibling's static `import('@huggingface/transformers')`. The host registers a loader: the extension must register a bundled one (`() => import(...)`, Manifest V3 forbids remote code); GuideAxon registers a CDN one (`app-core/services/LLM/registerTransformersLoader.ts`) because Metro cannot parse transformers' onnxruntime-web build. The shared package must not import the library itself. |
| `storage-suite` version                    | The page-agent-rp copy is reformatted and differs a little from GuideAxon's former copy: `storage.web.ts` no longer wraps values in `String()`, `VectorStore` and `IVectorStore` lost their `<Metadata>` generics, errors carry `cause`, logs go through `utils/logger`, and the old copy's `window.Transformers` caching was dropped (the loader registration restores it).                                                                                          |
| `app.config.js`                            | Uses Node `fs`, so native must never bundle it: `app-core/utils/config.js` reaches it through `appConfigFallback.js` (web) and `appConfigFallback.native.js` (stub).                                                                                                                                                                                                                                                                                                  |
| Skill files                                | Do not run Prettier over `core/skills/**`. It re-indented the frontmatter (skill selection regressed until the committed frontmatter was restored; the cause inside the parser was not traced) and padded tables until a reference section exceeded its chunk size.                                                                                                                                                                                                   |
| Verification                               | `npx jest` (151 suites, 1957 tests), `npx vitest run` in each package, `npx expo export` for web and for Android, Gradle debug and release builds. All passed on 2026-11-01, and the release build launched on an x86_64 emulator.                                                                                                                                                                                                                                    |

## 1. Why the layout changed

The old layout let browser-only and extension-only code leak into packages that were meant to be reusable (for example `ui` imported from `extension`, and `memory`'s root export pulled in a Node-only MCP client). The fix is three tiers with imports flowing one way, enforced by folder name:

```
packages/extension          →   packages/browser          →   packages/cognitive-brain
(chrome.* glue, entrypoints)    (needs a DOM, no chrome.*)    (runs anywhere, incl. Android)
```

- A **website** uses `browser/` and `cognitive-brain/` and never needs `extension/`.
- An **Android app** uses `cognitive-brain/` only.
- `extension/` keeps entrypoints, `chrome.*` glue, WXT config and React views. Product logic that does not need `chrome.*` moved out.

Rules that must keep holding (not yet enforced by CI, see section 9):

1. `cognitive-brain` must not import `browser`, `extension`, `chrome.*`, or unguarded DOM globals.
2. `browser` must not import `extension` or `chrome.*`.
3. No package may import another package's `src/` by relative path. Use the package name.
4. Web-only or Node-only code sits behind a subpath (`/adapters/web`, `/dom`, `/vault`) or a `.web.ts` / `.native.ts` file, never on a package root.

## 2. Package map

Package names (`@page-agent/*`) did **not** change, so existing import specifiers keep working. Only folder paths changed.

| Folder                           | Package                       | Publish        | Subpaths                                                                                                                                                                                | Runs on                                                                                                                      |
| -------------------------------- | ----------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `cognitive-brain/llms`           | `@page-agent/llms`            | public         | `.`                                                                                                                                                                                     | web, Node, RN                                                                                                                |
| `cognitive-brain/storage-suite`  | `@page-agent/storage-suite`   | private, 0.1.0 | `.`, `./embeddings`, `./storage`, `./secure-storage`, `./opfs`, `./file-store`                                                                                                          | web + RN (`.web.ts` / `.native.ts` split). `./opfs` is web-only                                                              |
| `cognitive-brain/core`           | `@page-agent/core`            | public         | `.`, `./mcp`, `./skills`                                                                                                                                                                | web, RN. `native-mcp-client/` and `*.native.ts` are RN-only                                                                  |
| `cognitive-brain/memory`         | `@page-agent/memory`          | public         | `.`, `./interfaces`, `./adapters/web`, `./adapters/mobile`, `./adapters/desktop`, `./vault`, `./agents`, `./skills`, `./persistence`, `./procedural`, `./core/cache`, `./orchestration` | root is platform-neutral. `./adapters/web`, `./orchestration` are web-tier. `./vault` and `./adapters/desktop` are Node-only |
| `cognitive-brain/access-policy`  | `@page-agent/access-policy`   | private        | `.`, `./dom`                                                                                                                                                                            | root neutral. `./dom` is browser-only                                                                                        |
| `cognitive-brain/business-logic` | `@page-agent/business-logic`  | private        | `.`, `./chrome-extension-ranking`, `./digital-marketing-pro`                                                                                                                            | web, Node (uses `fetch`)                                                                                                     |
| `cognitive-brain/speech`         | `@page-agent/speech`          | private        | `.`                                                                                                                                                                                     | any (pure logic on `Float32Array`)                                                                                           |
| `browser/page-controller`        | `@page-agent/page-controller` | public         | `.`                                                                                                                                                                                     | DOM only                                                                                                                     |
| `browser/ui`                     | `@page-agent/ui`              | public         | `.`                                                                                                                                                                                     | DOM only                                                                                                                     |
| `browser/page-agent`             | `page-agent`                  | public         | `.`                                                                                                                                                                                     | DOM only                                                                                                                     |
| `browser/speech-web`             | `@page-agent/speech-web`      | private        | `.`                                                                                                                                                                                     | browser only (Worker, WASM/WebGPU, Cache Storage, Web Audio)                                                                 |
| `browser/graph-viewer`           | `@page-agent/graph-viewer`    | private, 1.8.2 | `.`                                                                                                                                                                                     | React DOM only. Nothing imports it yet                                                                                       |

Left outside the tiers: `mcp/` (Node server that drives the extension), `companion-app/`, `website/`.

## 3. What to copy, and what not to

**Copy:** `packages/cognitive-brain/` and `packages/browser/` (without `node_modules/` and `dist/`).

**Do not overwrite blindly.** If the sibling repo already has its own `core`, `llms`, `memory`, `ui`, etc., diff each one against these first. In the one case we checked (`meet-coach`), its copies of the speech-to-text files were _newer_ than ours (channel selection in `SttSession`, an English-only Whisper fix). Port any local changes into the copied packages instead of losing them.

**Also change at the repo root** (these are not inside the two folders):

| File                        | Change                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `package.json` `workspaces` | Replace the old `packages/<name>` entries with the paths below. **Order matters (topological).**       |
| `tsconfig.typecheck.json`   | Update every `include`/`exclude` path (see section 4.2).                                               |
| `eslint.config.js`          | Ignore glob `packages/**/src/components/ui`, plus the extra override block (section 4.3).              |
| `scripts/sync-version.js`   | Read the workspace list instead of scanning `packages/*` one level deep (section 4.4).                 |
| `AGENTS.md` / `CLAUDE.md`   | Update paths and add the tier table. `CLAUDE.md` imports `@packages/cognitive-brain/memory/AGENTS.md`. |

## 4. Wiring steps

### 4.1 Workspaces (exact order)

```json
"workspaces": [
  "packages/browser/page-controller",
  "packages/browser/ui",
  "packages/cognitive-brain/llms",
  "packages/cognitive-brain/storage-suite",
  "packages/cognitive-brain/core",
  "packages/cognitive-brain/memory",
  "packages/cognitive-brain/access-policy",
  "packages/cognitive-brain/business-logic",
  "packages/cognitive-brain/speech",
  "packages/browser/speech-web",
  "packages/browser/page-agent",
  "packages/browser/graph-viewer",
  "packages/mcp",
  "packages/extension"
]
```

Add your other workspaces (website, companion app) after these. Then run `npm install --ignore-scripts` once: it re-creates the `node_modules/@page-agent/*` links (they are junctions on Windows and break when folders move) and refreshes the lock file.

### 4.2 Typecheck config

All moved packages sit one level deeper, so every package's `tsconfig.json` must extend `../../../tsconfig.base.json` (already done in the copied folders) and their publish scripts call `node ../../../scripts/pre-publish.js`. In `tsconfig.typecheck.json`, include `packages/cognitive-brain/*/src/**/*` and `packages/browser/*/src/**/*` for the libraries, and keep the exclusions for files that need React Native types you do not install: `storage-suite/src/**/*.native.ts`, `storage-suite/src/utils/speechPolyfill.ts`, `core/src/native-mcp-client`, `core/src/skills/skill-store.{native,web}.ts`, `memory/src/adapters/mobile`, `memory/src/core/audit/MutationLogStore.native.ts`.

The base config sets `erasableSyntaxOnly`, so **constructor parameter properties are rejected** (`constructor(private readonly x: X)`). Write explicit fields instead.

### 4.3 ESLint

The repo lints with `strictTypeChecked`. Add an override that lints native files and tool configs without type information, because no package tsconfig can resolve them (RN packages are not installed, configs sit outside `src/`):

```js
{
  files: [
    'packages/*/*/vitest.config.ts',
    'packages/*/*/benchmarks/**/*.ts',
    'packages/cognitive-brain/**/*.native.ts',
    'packages/cognitive-brain/memory/src/adapters/mobile/**/*.ts',
    'packages/cognitive-brain/storage-suite/src/utils/speechPolyfill.ts',
  ],
  extends: [tseslint.configs.disableTypeChecked],
}
```

The copied packages are lint-clean. Your own extension code may not be, and a pre-commit hook that runs lint-staged will lint **every renamed file**, so expect existing errors in files you touch to surface at commit time.

### 4.4 `sync-version.js`

Replace the directory scan with the workspace list:

```js
const packages = rootPkg.workspaces
// ... pkgPath = join(rootDir, pkg, 'package.json')
```

Do not run it casually: it rewrites every package version to the root version (it would bump `memory`, `storage-suite`, `graph-viewer`, etc.).

### 4.5 Extension package and config

In `packages/extension/package.json` depend on the packages you use (exact versions, except `storage-suite` which is private at 0.1.0 and uses `*`):

```
@page-agent/core 1.12.4, llms 1.12.4, memory 1.12.4, page-controller 1.12.4, ui 1.12.4,
storage-suite *, access-policy 1.12.4, business-logic 1.12.4, speech 1.12.4, speech-web 1.12.4
```

Path updates in the extension:

- `vitest.config.ts` aliases: `../cognitive-brain/core/src/PageAgentCore.ts`, `../cognitive-brain/llms/src/index.ts`, `../browser/page-controller/src/PageController.ts`.
- `wxt.config.js`: the core version lookup reads `../cognitive-brain/core/package.json`.
- `src/skills/skill-store.ts`: the `import.meta.glob` patterns become `../../../cognitive-brain/core/skills/*/SKILL.md` and `.../references/*.md`.
- Relative imports into sibling packages' `src/` (for example in tests) need the new depth.

## 5. API changes your extension code must absorb

| Before                                                                                                                        | Now                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { MCPVaultClient, ObsidianVaultProvider, … } from '@page-agent/memory'`                                               | from `@page-agent/memory/vault`                                                                                                                                                                                                                                                                   |
| IndexedDB stores, `SemanticSearchBridge`, `OffscreenEmbedder`, `createWebBrainEngine`, `createWebMemoryService` from the root | from `@page-agent/memory/adapters/web`                                                                                                                                                                                                                                                            |
| Own `SmritiOrchestrator`, `ConsolidationManager`, `InferenceAdapter` in the extension                                         | `@page-agent/memory/orchestration` (web-tier). Call `configureInferenceAdapter(factory)` once at startup, before `getInferenceAdapter()` (it throws otherwise). The factory supplies `resolveClient` (which provider is configured) and, for the in-browser model, a `browserInference` transport |
| Own `llm/providers/adapter.ts` logic                                                                                          | `createProviderResolver({ demo: { baseURL, apiKey, model } })` from `@page-agent/llms` returns `createLLMConfigFromProvider`, `getTextLLMConfig`, `getBaseURLForProvider`. `isDemoProvider` and the settings types are exported too. The demo URL stays in your build env, not in `llms`          |
| `accessListControl/`                                                                                                          | `@page-agent/access-policy`. `buildSnapshot`, `detectLoginForm`, `containsSensitiveFields` are in `@page-agent/access-policy/dom` (content-script side)                                                                                                                                           |
| `business-logic/`                                                                                                             | `@page-agent/business-logic/chrome-extension-ranking` and `/digital-marketing-pro`. Storage is injected: build a `TrackedExtensionStore` with `createTrackedExtensionStore(storage)`; `checkOneKeyword` and `runRankingSweep` now take the store as their first argument                          |
| `PageAgentCore` config `pageController: PageController`                                                                       | `pageController: IPageController`, defined in `@page-agent/core` (with `ActionResult` and `BrowserState`). The real `PageController` satisfies it structurally, so no change for the DOM controller. A WebView or accessibility controller on Android implements the same interface               |
| `@page-agent/core/storage` (OPFS)                                                                                             | `@page-agent/storage-suite/opfs` (`getOPFSStorage`, `isOPFSSupported`). Interface: `INamespacedFileStore` from `@page-agent/storage-suite/file-store`. No native implementation exists yet                                                                                                        |
| `@page-agent/ui` widget panels importing extension code                                                                       | `ui` defines `WidgetHost`, `WidgetHostProvider`, `useWidgetHost`. Wrap `ActiveWidgets`, `DebugInspector`, `WidgetGallery` and `WorkflowStepStrip` in `<WidgetHostProvider value={yourHost}>`; the extension's implementation is `src/lib/widgetHost.ts`                                           |
| STT / audio capture in the extension                                                                                          | `@page-agent/speech` (logic) and `@page-agent/speech-web` (`WhisperEngine`, `modelCache`, `offscreenStt`, `DualChannelCapture`). Construct `new DualChannelCapture({ pcmWorkletUrl: chrome.runtime.getURL('pcm-tap-worklet.js') })` in the offscreen document                                     |

Behavior changes worth knowing:

- **`core` MCP.** `core/src/mcp/` is now the only implementation of the protocol layer. `native-mcp-client/` keeps only mobile-specific code and re-exports the shared pieces at the old paths, so the mobile app's deep imports still resolve. Native Streamable HTTP now POSTs to the server URL, reconnects with backoff and supports `terminateSession`, as the web transport does. The two OAuth providers and the config/status types are intentionally still separate.
- **`core` declares `@page-agent/storage-suite` as an optional peer** (native files import it by package name). It is optional because `core` is published and `storage-suite` is private.
- **`memory` and `llms` are aligned at 1.12.4.** `core` no longer lists `pdfjs-dist` (it never imported it).
- **`SynthesisEngine`** no longer falls back to `node:crypto` for hashing; it needs WebCrypto (Node 22, browsers and React Native have it).
- **`memory` root test.** `src/index.noNodeDeps.test.ts` fails if the root can reach `MCPVaultClient`, `adapters/*`, `node:*` or the MCP SDK again. Keep it.

## 6. Extension glue you write yourself

These are the pieces that stay in the extension because they touch `chrome.*` or extension settings. Use `page-agent-rp` as the reference implementation:

| File (in `packages/extension/src`)                                | Job                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `memory/inferenceWiring.ts`, `memory/index.ts`                    | Calls `configureInferenceAdapter` with your settings and `chrome.runtime` transport; re-exports the orchestration                     |
| `llm/providers/adapter.ts`                                        | Thin wrapper that binds the demo constants to `createProviderResolver` and keeps the names your callers import                        |
| `lib/trackedExtensionStore.ts`                                    | `localStorage`-backed `TrackedExtensionStore` instance                                                                                |
| `lib/widgetHost.ts`                                               | `WidgetHost` over your widget runtime and IndexedDB. Read events by key range: the `widget_events` store has no `by-instanceId` index |
| `entrypoints/offscreen/main.ts`, `browser-ml/offscreen-bridge.ts` | Handlers and caller functions for `offscreen:stt:status                                                                               | download | remove | poll`, `offscreen:audio:start | stop | snapshot`, `offscreen:dictation:start` |
| `audio/captureErrors.ts`                                          | Recognises Chrome's `activeTab` grant error                                                                                           |
| `public/pcm-tap-worklet.js`                                       | AudioWorklet module, loaded by URL so it must be a plain file                                                                         |
| `entrypoints/content.ts`                                          | Imports `buildSnapshot` from `@page-agent/access-policy/dom`                                                                          |

Not restored in `page-agent-rp`, because the code lives only in `meet-coach`: the side-panel hook that obtains the `tabCapture` stream id after a user gesture and starts audio capture, and the `background.ts` toolbar-click handling that grants `activeTab`. If your sibling repo is `meet-coach`, you already have those.

## 7. Using it on Android / React Native

Safe to import from `cognitive-brain` (code-level, untested on device): `llms`, `core` (including `native-mcp-client`), `memory` root plus `/adapters/mobile`, `storage-suite`, `access-policy` root, `business-logic`, `speech` root.

Never reachable from an RN entry point:

- `memory` `./vault`, `./adapters/desktop` (Node-only, pull in `@modelcontextprotocol/sdk`) and `./adapters/web`, `./orchestration` (IndexedDB).
- `access-policy/dom`, everything in `browser/`, `storage-suite/opfs`.

Metro resolves every `import()` statically, so a dynamic import does not hide a Node-only file. Keep to the subpath rule. `memory/orchestration` is web-tier only because it builds on the IndexedDB stores; Android needs the same classes wired to the SQLite store (`SQLiteStore`), which does not exist yet. There is also no native `INamespacedFileStore`; it needs an expo-file-system implementation. `llms`' `browser` provider (WebLLM) is web-only, so Android needs a native provider such as `llama.rn` behind the same client contract.

## 8. Verification checklist

Run from the repo root after wiring:

1. `npm install --ignore-scripts` (relinks workspaces)
2. `npx tsc --noEmit -p tsconfig.typecheck.json`
3. `npx tsc --noEmit -p packages/extension/tsconfig.json`
4. `npx eslint --quiet packages/browser packages/cognitive-brain` (expect no output)
5. Tests: `cd packages/cognitive-brain/<pkg> && npx vitest run` for `core`, `memory`, `access-policy`, `speech`; `cd packages/cognitive-brain/llms && npx vitest run --project llms`; `cd packages/browser/speech-web && npx vitest run`; then the extension.
6. `cd packages/extension && npx wxt build --mode production`, and check `.output/prod/chrome-mv3/pcm-tap-worklet.js` exists.
7. Grep that no real import crosses a boundary: `grep -rnE "from ['\"][^'\"]*(extension/src|storage-suite/src)" packages/browser packages/cognitive-brain` should print nothing.

Expected in `page-agent-rp`: 3 failing `aeoFixes` tests (pre-existing, unrelated).

## 9. Known open items

- No CI rule yet for the import boundaries in section 1 (`no-restricted-imports` or `dependency-cruiser`).
- `graph-viewer` has no consumer. Its React DOM components are web-only; only its layout code might be reusable.
- Orchestration has no SQLite wiring; no native file store; OAuth providers and MCP config types are not unified.
- `core` still has browser-specific files behind `.web.ts` names (`skill-store.web.ts`, `skill-assets.web.ts`); that is by design but means `core` is not "pure".
- Orphaned but compiling: `extension/src/welcome/welcomeState.ts` and `walkthrough.ts` (install-flow rules, unused).
- Prettier runs in the pre-commit hook and reformats every moved file, so the first commit's diff is noisy. `git show -M` still follows renames.

## 10. Pitfalls we hit

- **Moving folders breaks the workspace links.** Always re-run `npm install` after a move.
- **`git add -A packages` stages untracked files you did not mean to commit.** Stage explicit paths.
- **Partially staged files break lint-staged.** If a tool already staged a rename (`git mv`) and you then edit the file, lint-staged's restore step fails and the commit is reverted. Run `git reset` (index only) and re-add before committing.
- **A published package cannot depend on a private one.** That is why `core` lists `storage-suite` as an optional peer instead of a dependency.
- **Do not run `scripts/sync-version.js` to "test" it.** It rewrites package versions.

## 11. A third folder you may meet: `ui-kit`

`packages/ui-kit/` (React Native / Expo UI, about 22.5k lines, untracked, no `package.json`, depends on a missing `app-core`) is **not** part of the two folders to copy and is not wired into the workspaces. If the sibling repo has one too, treat it separately: see section 11 of `ReusablePackagesReview.md` for its status, its duplication, and the suggested `packages/mobile/` placement. Do not point it at `packages/storage-suite` or `packages/memory/src`; those paths moved to `packages/cognitive-brain/`.
