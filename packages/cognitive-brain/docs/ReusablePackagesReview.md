# Review: Can `packages/extension` be "just the browser extension" while the other packages are reusable on Android?

**Date:** 2026-11-01 · **Scope:** `extension`, `core`, `llms`, `memory`, `mcp`, `graph-viewer`, `ui`, `page-controller`, `storage-suite`, `companion-app`
**Method:** static review (package manifests, import graphs, grep for platform globals, LOC counts). Nothing was built or run, and the Android/Expo app is not in this repo, so mobile bundling claims are inferred from code and comments, not tested.

> **Update 2026-11-01:** this review was written before the folder move. Paths below such as `packages/core` or `packages/ui` are now `packages/cognitive-brain/core` and `packages/browser/ui`. See section 8 for the decision.

> **GuideAxon status (2026-11-01).** GuideAxon received `cognitive-brain/` and `browser/` from `page-agent-rp`. It is not an npm
> workspace and has no `packages/extension`; see `AdoptingCognitiveBrainAndBrowser.md`, section 0, for the differences (aliases
> instead of workspace links, the root `tsconfig.base.json`, the transformers loader seam, two Metro configs). The boundary
> fixes below (3.1 to 3.5) arrived with the sync; the web and Android bundles, the release build and all test suites pass here.
> Still open: `graph-viewer` has no consumer, the OAuth providers and MCP config types are not unified, orchestration has no
> SQLite wiring, there is no native `INamespacedFileStore`, and the CI import-boundary rule is not written.

## 1. Verdict

**Yes, it is feasible, and the repo is about 60% of the way there.** Two packages (`llms`, `memory`) are already close to platform-neutral. The remaining work is a few specific boundary violations plus a larger move of extension code into packages.

Your goal has two halves, and they are in different states:

| Goal                                 | State                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reusable packages usable on Android  | Partly true. `llms` is clean. `memory` is close. `core` mixes web, extension and RN code. `graph-viewer` and `mcp` are not Android-reusable as built (see 3.4, 3.5). |
| `extension` is mostly extension code | Not true today. Of about 70k LOC in `extension/src`, a large share is product logic with no `chrome.*` dependency (see section 4).                                   |

## 2. Package-by-package readiness for Android (React Native / Expo)

| Package                 | Portable today?          | Evidence                                                                                                                                                    | Blockers                                                                                                                                                               |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llms`                  | **Yes**                  | No DOM or `chrome` use. Only deps are `chalk` and `zod`. Browser LLM is an optional peer, dynamically imported.                                             | `chalk` in a RN bundle is untested. The `browser` provider (WebLLM) is web-only and needs a native equivalent such as `llama.rn`, which `storage-suite` already lists. |
| `memory`                | **Mostly**               | Layered as interfaces, `core`, `adapters/{web,mobile,desktop}`. Has an `SQLiteStore` for op-sqlite. 41 test files.                                          | See 3.1 (root entry reaches the Node-only MCP client). `actions/impl/browser.ts` and `page.ts` use `document`/`window` behind `typeof` guards.                         |
| `core`                  | **Partly**               | `PageAgentCore` type-imports `PageController`, so it is DOM-oriented. `native-mcp-client/` is RN-aware (`.native.ts`, `react-native-tcp-socket`, `expo-*`). | See 3.2 and 3.3.                                                                                                                                                       |
| `storage-suite`         | **Yes, by design**       | Peers are RN/Expo modules, with `.web.ts` / `.native.ts` splits.                                                                                            | Not imported by name by anyone (see 3.3). Untested in this review.                                                                                                     |
| `page-controller`, `ui` | **No, and shouldn't be** | They exist to operate on a live DOM. Android would use accessibility or WebView control instead.                                                            | `ui` imports from `extension` (3.1).                                                                                                                                   |
| `mcp`                   | **No**                   | Node CLI/bridge (`ws`, `@modelcontextprotocol/sdk`) for driving the extension. A server for desktop, not a client library.                                  | Expected. It should stay out of the "reusable on Android" set.                                                                                                         |
| `graph-viewer`          | **Not as built**         | `react >= 19` peer, no other deps.                                                                                                                          | See 3.4.                                                                                                                                                               |

## 3. Boundary violations (fix these first)

### 3.1 `ui` imports from `extension` (inverts the dependency direction)

`ui/src/panel/{ActiveWidgets,DebugInspector,WidgetGallery,WorkflowStepStrip}.tsx` import `../../../extension/src/lib/widgetRuntime` and `.../lib/db` through relative paths, and `WidgetGallery.tsx:14` calls `chrome.runtime.sendMessage`.

- The package is supposed to be "decoupled from PageAgent" and sits below the extension, but it cannot be built or used without the extension's source tree.
- **Fix:** define a `WidgetHost` interface in `ui` (list, create, stop, delete instances, inspect events). Have the extension inject an implementation through props or context. The `WidgetInstance` and `WidgetEvent` types move into `ui` or a shared types package.

### 3.2 `memory` root entry ships the Node-only MCP client, against its own rule

`memory/AGENTS.md` Critical Rule #1 says the file graph must never reach `MCPVaultClient.ts` from an Expo entry point. But `memory/src/index.ts:178` re-exports `MCPVaultClient`, and `MCPVaultClient.ts:1-2` imports `@modelcontextprotocol/sdk` at top level. Importing `@page-agent/memory` from the Expo app therefore pulls in the SDK, which Metro resolves statically.

- `factory.ts` has the same intent (it avoids the import) but the package root defeats it.
- Lines 133 and 294-303 also export IndexedDB/Orama web adapters from the root, so a mobile consumer of the root entry reaches web-only code.
- **Fix:** keep `index.ts` to interfaces, `MemoryService`, pipeline, types and `NullVaultProvider`. `MCPVaultClient` and `ObsidianVaultProvider` move to `./vault` only. The IndexedDB and Orama exports move to `./adapters/web` only (the subpath already exists). This is a breaking change for the extension's 20 `@page-agent/memory` import sites, so grep and migrate them in the same commit.

### 3.3 `core` reaches into `storage-suite` by relative path, with no declared dependency

`core/src/native-mcp-client/auth/OAuth2PKCEProvider.ts:15`, `.../mobile/ConsentStore.ts:11` and `core/src/skills/skill-store.native.ts:17` import `../../../../storage-suite/src/...`. `core/package.json` does not list `@page-agent/storage-suite`, and `storage-suite` appears after `core` in the root `workspaces` order, which AGENTS.md says must be topological.

- This works in the monorepo and breaks as soon as `core` is published or consumed from outside.
- **Fix:** declare the dependency, reorder `workspaces`, and import by package name. Better, make `core` depend on small interfaces (`ISecureStorage`, `IDatabase`) that the app injects, so `core` has no storage-suite dependency at all.

### 3.4 `graph-viewer` is orphaned

It is listed in root `workspaces` but nothing imports it: no `extension`, `companion-app` or other package references `@page-agent/graph-viewer`. Its `react >= 19` peer also means it is web React, not React Native. If Android needs a graph view, it needs a separate renderer. The reusable part is the layout code (`graph-viewer/src/layout/`) plus `types.ts`, which could be split from the DOM components. I did not check whether the layout code is DOM-free.

### 3.5 `core` has two parallel MCP implementations

`core/src/mcp/` (about 2,556 LOC) and `core/src/native-mcp-client/` (about 3,524 LOC) have the same file layout and names (`MCPSession`, `SSETransport`, `StreamableHTTPTransport`, `OAuth2PKCEProvider`, `jsonrpc`, `buildToolSystemPrompt`, `parseToolCall`). `core/package.json` exports only `./mcp`. A comment in `native-mcp-client` points at `@/packages/app-core/mcp`, a path from another repo, which suggests it was copied in from the mobile app. Two copies will drift.

- **Fix:** pick one, make the other a thin platform layer (`*.native.ts` only), and delete the duplicate generic files. Not verified: which copy is newer or has more fixes.

### 3.6 Smaller drifts

- `memory` pins `@page-agent/llms` at `1.8.2` while `llms` is `1.12.4`. The monorepo resolves it locally but a published `memory` would pull a stale `llms`.
- `core` depends on `pdfjs-dist` `6.4.299` while the extension uses `^5.7.284`. Two majors in one bundle.
- `core/src/storage/opfs.ts` (OPFS) is browser-only but exported from `core` as `./storage`. It should live in a web adapter, as `memory` does.
- `memory/AGENTS.md` says "Zero tests", but there are 41 test files. Update the doc so it stops misleading agents.
- `core` has `mcp/auth/OAuth2PKCEProvider.ts` calling `window.open`, with an Expo fallback. Fine, but it is a platform check inside shared code and would be cleaner as an injected `IOAuth2Provider`, which the interface file already defines.

## 4. What is in `extension/src` that should not be

Measured by lines of TS/TSX, and by how many files in each folder reference `chrome.*` or `wxt`:

| Folder                                                                         | LOC               | Files using `chrome`/`wxt` | Assessment                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoints/`                                                                 | 35,059            | 58 of 104                  | Legitimately extension code, but 20+ feature UIs (dinner, financial-monitor, news-digest, etc.) hold feature logic inline.                                                                                                                  |
| `lib/`                                                                         | 16,477            | 31 of 109                  | **Mixed.** About 78 files have no `chrome.*` (resume parsing, ATS score, field mapper, autofill, job search, metrics). The widget framework (`widgetRuntime`, `widgetScheduler`, `db`) is a reusable engine tied to Dexie/chrome messaging. |
| `components/`                                                                  | 4,174             | 3 of 30                    | React DOM UI. Reusable across web surfaces, not Android.                                                                                                                                                                                    |
| `business-logic/`                                                              | 3,050             | 0 of 18                    | **Move out.** Ranking and marketing logic with no `chrome` use.                                                                                                                                                                             |
| `browser-ml/`                                                                  | 2,862             | 2 of 13                    | Web-only by design (Workers, WASM, WebGPU). Extension or a web package, not Android.                                                                                                                                                        |
| `actions/`                                                                     | 2,066             | 2 of 22                    | Agent actions. Mostly portable.                                                                                                                                                                                                             |
| `agent/`                                                                       | 1,914             | 8 of 11                    | Correctly extension-specific (`MultiPageAgent`, `TabsController`, `RemotePageController`).                                                                                                                                                  |
| `stt/`                                                                         | 1,426             | 0 of 14                    | Speech to text. Check `window` use (6 files), then likely movable.                                                                                                                                                                          |
| `memory/`                                                                      | 1,152             | 1 of 5                     | **Move out.** `orchestrator.ts` (439 LOC) and `consolidation.ts` (397 LOC) are memory-layer logic. They sit in the extension as a "bridge" and would have to be rewritten for Android.                                                      |
| `totalRecall/`, `aeo/`, `seo/`, `email-cleaner/`, `accessListControl/`, `llm/` | about 3,500 total | 0 to 1 each                | `accessListControl` (policy engine) and `llm/providers/adapter.ts` are pure logic and directly reusable.                                                                                                                                    |

Two specific coupling points matter most:

- `llm/providers/adapter.ts` imports `DEMO_*` constants from `agent/constants` and `UnifiedSettings` from `shared/settings`. The provider-resolution logic (`createLLMConfigFromProvider`, `getTextLLMConfig`) is exactly what Android needs, but it is wired to the extension's settings shape. Move it into `llms` and have the extension supply the settings.
- `lib/db.ts` uses IndexedDB (`idb`) for sessions and widget instances. Android needs the same session model on SQLite. `memory` already has the `IMemoryStore` pattern for this. Sessions and widgets need an equivalent interface.

## 5. Recommended target structure

```
packages/
  llms/              provider config + adapter (move adapter.ts here), no platform code
  memory/            root entry = platform-neutral only; adapters via subpaths
  core/              agent loop + ONE MCP client; storage/OAuth via injected interfaces
  agent-skills/ (new, optional)   resume/ATS/field-mapping/ranking/marketing logic from lib/ and business-logic/
  widget-runtime/ (new, optional) widgetRuntime/scheduler/db behind a storage interface; ui depends on this, not on extension
  storage-suite/     platform storage (already split web/native)
  ui, page-controller, graph-viewer   web-only; documented as such
  extension/         entrypoints, chrome.* glue, WXT config, React views
  mcp/, companion-app/   desktop-side; out of scope for Android
```

Rule to enforce in CI: a package may not import `chrome`, `wxt`, `../extension/`, or a sibling's `src/` path. A simple ESLint `no-restricted-imports` rule or a `depcruise` config would catch every violation in section 3.

## 6. Suggested order of work

1. **Fix 3.1 and 3.3** (boundary violations). Small, mechanical, and they unblock publishing.
2. **Fix 3.2** (`memory` root exports). Breaking, but a grep-and-replace across the extension.
3. **Resolve 3.5** (duplicate MCP client) before more features land in either copy.
4. **Add the CI import rule** from section 5 so regressions fail the build.
5. **Move `memory/orchestrator.ts`, `llm/providers/adapter.ts`, `business-logic/`, `accessListControl/`** out of the extension. These are the cheapest, highest-value moves.
6. **Extract the widget runtime and session store behind interfaces**, then move the `lib/` product logic. This is the large step, and the only one that needs design work.
7. Decide how Android drives pages. `page-controller` and `PageAgentCore` assume a DOM, so Android needs either a WebView adapter implementing the `PageController` interface or a separate accessibility-based controller. This is a product decision, not a refactor, and is the biggest open question for "agent on Android".

## 7. Limits of this review

- I did not run `npm run build`, `typecheck` or the tests, and did not bundle anything with Metro. "Portable" means no obvious platform dependency in the code, not a verified Android build.
- I counted `chrome.*` references per file, not per function. A file that mentions `chrome` once may still be mostly portable.
- I did not read the Expo app (not in this repo), `companion-app`, `website`, or `docs/designCognitiveBrain.md`. The design doc may already document some of these decisions.
- `packages/cognitive-brain/` is an empty directory. `AGENTS.md` mentions it as the design reference, which may be stale.

## 8. Decision: three tiers on disk

The review shows that the dependency rules were only conventions, and several were already broken (3.1, 3.2, 3.3). Folder names that state the rule make a violation visible in the import path itself, for example `cognitive-brain/` importing from `browser/` or `../../../extension/`.

| Tier                        | Packages                                              | Why                                                                                                                                              |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cognitive-brain/` | `llms`, `memory`, `core`, `storage-suite`             | The code Android must be able to run. `storage-suite` already has `.native.ts` / `.web.ts` splits, and `core` already holds `native-mcp-client`. |
| `packages/browser/`         | `page-controller`, `ui`, `graph-viewer`, `page-agent` | Needs a DOM but not `chrome.*`. A plain website can use these. `page-agent` is the npm entry that composes the UI with the agent.                |
| `packages/extension/`       | (unchanged)                                           | Entry points and `chrome.*` glue only.                                                                                                           |

Left outside the tiers: `mcp` and `companion-app` (desktop side), `website`.

What the move changed: only paths. All `@page-agent/*` package names are unchanged, so no import specifiers changed. Updated: root `workspaces` (same topological order), `tsconfig.typecheck.json`, each package's `extends` and publish script paths, `scripts/sync-version.js` (now reads the workspace list because it used to scan one directory level), the extension's vitest alias, WXT core-version lookup and `import.meta.glob` for skill files, the eslint ignore glob, and `AGENTS.md` / `CLAUDE.md`.

What it did not change, and is still open (sections 3 and 4):

- `core/storage/opfs.ts`, `core/skills/skill-store.web.ts` and `core`'s type import of `PageController` still tie `core` to the browser.
- `ui` still imports from `extension` by relative path (only the number of `../` changed).
- `memory`'s root entry still exports `MCPVaultClient` and the web adapters.
- Historical design docs under `docs/` still use the old paths.

Verification after the move: `npm install` relinked the workspaces, the library typecheck passes, and the library tests pass. The extension typecheck reports 10 errors and 6 test files fail, but all are about modules that do not exist in the tree (`../meet/types`, `../audio/channelActivity`, `../lib/callStore`, and so on) or about `aeoFixes` assertions. None involve a moved path.

## 9. Boundary fixes applied (follow-up commit)

| Item                                                   | Status    | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 `ui` imports `extension`                           | **Fixed** | `ui` defines `WidgetHost` (`WidgetHostProvider`, `useWidgetHost`, its own widget types). The extension implements it in `src/lib/widgetHost.ts`. No `extension/` path or `chrome.` remains under `browser/ui/src`. None of the four panel components is mounted anywhere yet, so whoever mounts them must wrap them in `<WidgetHostProvider value={extensionWidgetHost}>`.                                                                                                       |
| 3.2 `memory` root exports                              | **Fixed** | `MCPVaultClient`, `ObsidianVaultProvider` and the web adapters are off the root and live on `/vault` and `/adapters/web`. `createWebBrainEngine` / `createWebMemoryService` moved to `/adapters/web` because `factory.ts` dynamically imports the web adapters, which Metro resolves statically. `index.noNodeDeps.test.ts` fails if the root can reach them again. `SynthesisEngine` lost a Node-only `node:crypto` fallback, which only matters on runtimes without WebCrypto. |
| 3.3 `core` imports `storage-suite` by path             | **Fixed** | Imports use `@page-agent/storage-suite` and a new `./secure-storage` subpath. `core` declares it as an _optional peer_ dependency, because `core` is published and `storage-suite` is private, so a normal dependency would break `npm publish`.                                                                                                                                                                                                                                 |
| 3.4 `graph-viewer` orphaned                            | Open      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3.5 duplicate MCP client in `core`                     | Open      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3.6 version and `pdfjs-dist` drift, `opfs.ts` location | Open      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `core` type-imports `PageController`                   | Open      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Update: `core` no longer depends on the browser

| Tie                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageAgentCore` type-imported the DOM `PageController` | `core` now owns `IPageController` (plus `ActionResult` and `BrowserState`) in `src/IPageController.ts`. `PageController` satisfies it structurally, so `page-controller` is unchanged and a WebView or accessibility controller can implement it on Android. `@page-agent/page-controller` is no longer a dependency of `core`. Both typechecks pass, so every call site that builds an agent already proves the contract holds. |
| `core/storage/opfs.ts` (OPFS, browser-only)            | Moved to `storage-suite` as `OPFSStorage.web.ts`, implementing a new `INamespacedFileStore` interface (`./file-store`). The extension imports `@page-agent/storage-suite/opfs`. The `core` `./storage` export is gone. There is no native implementation yet: it needs an expo-file-system one behind the same interface.                                                                                                        |

### Update: duplicate MCP clients and product logic

**3.5 duplicate MCP clients (fixed).** `core/src/mcp/` is now the single implementation of the protocol layer (JSON-RPC, `MCPSession`, SSE and Streamable-HTTP transports, PKCE helpers, tool-prompt build/parse, shared types). `native-mcp-client/` keeps only what is mobile-specific (`AgenticLoop`, `MCPClientService`, the mobile tool server, the local WebSocket transport, `MobileSession`, `ConsentStore`) and re-exports the shared pieces at the old paths, so the Expo app's imports still resolve. About 820 fewer source lines, plus new tests for the shared layer. Two things were deliberately not merged because the designs differ: the OAuth providers (in-memory and manual redirect on the web, SecureStorage plus expo-linking on native) and the config/status/tool result types. Behavior change for the mobile app: native Streamable HTTP now uses the web transport, which POSTs to the server URL, reconnects with backoff, and supports `terminateSession`. The old native copy did none of these.

**Product logic moved out of the extension.**

| From `packages/extension/src`                                | To                                                              | Notes                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessListControl/`                                         | `cognitive-brain/access-policy` (`@page-agent/access-policy`)   | Live-DOM code is behind the `./dom` subpath; `buildSnapshot` is no longer exported from the root. Added 11 tests. A throwing plugin is not caught by `PolicyEngine`, so the engine is fail-closed on decisions but not on plugin errors.                                  |
| `business-logic/`                                            | `cognitive-brain/business-logic` (`@page-agent/business-logic`) | `localStorage` access is now an injected `TrackedExtensionStore`; the extension supplies it in `lib/trackedExtensionStore.ts`.                                                                                                                                            |
| `llm/providers/adapter.ts`                                   | `llms/src/providers.ts`                                         | `createProviderResolver({ demo })`. The extension keeps a thin wrapper that binds its demo constants, so callers are unchanged. 10 tests.                                                                                                                                 |
| `memory/{orchestrator,consolidation,inferenceAdapter,types}` | `memory/src/orchestration` (`@page-agent/memory/orchestration`) | Still web-tier: it builds on the IndexedDB adapters, so Android needs the same classes wired to SQLite stores. The inference adapter takes injected `resolveClient` and an optional browser-inference transport; the extension wires them in `memory/inferenceWiring.ts`. |

**Also cleaned up.** Dead meet-coach code with broken imports was removed (`stt/` session and turn files, `welcome/openWelcome`, two registration helpers), and the extension typecheck is clean. Orphans left behind that still compile but have no consumer: `stt/{whisperEngine,modelCache,presets,types,offscreenStt-less}` and `welcome/{welcomeState,walkthrough}`.

**Still open:** `graph-viewer` has no consumer; the OAuth provider and MCP config types are not unified; orchestration has no SQLite wiring; there is no native `INamespacedFileStore`; the CI import-boundary rule is not written.

### Update: speech-to-text restored and placed in the tiers

The orphaned STT fragments were restored from the meet-coach repo (its copies were newer: channel selection in `SttSession` and an English-only Whisper fix) and split by what they need:

| Package                                         | Contents                                                                                                                                                               | Why there                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cognitive-brain/speech` (`@page-agent/speech`) | `SttEngine` contract and types, model presets, `SttSession`, `UtteranceCutter`, `EchoGuard`, `channelActivity` (voice-activity attribution), `sttTurns`, `CaptionTurn` | Pure logic on `Float32Array` and plain objects, so Android can reuse it with its own engine. 51 tests. |
| `browser/speech-web` (`@page-agent/speech-web`) | `WhisperEngine` (transformers.js), `modelCache` (Cache Storage), `offscreenStt`                                                                                        | Needs a Worker + WASM/WebGPU and `caches`, so it is browser-only. 3 tests.                             |

The offscreen document now handles `offscreen:stt:status|download|remove`, with matching `offscreenStt*` functions in `browser-ml/offscreen-bridge.ts`. Not restored: live session start/stop and polling, because they are driven by the dual-channel audio capture and decision engine that exist only in meet-coach. `welcome/welcomeState.ts` and `walkthrough.ts` stay in the extension: they are install-flow rules (`chrome.runtime.onInstalled` reasons) and depend on the meeting-coach call history. `CaptionTurn` is defined in `speech`; when meet-coach's `meet/` code is brought over, its `meet/types.ts` should re-export it instead of redefining it.

### Update: audio capture restored

| Piece                                                                                                                                                                                                            | Where                                                             | Notes                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DualChannelCapture` (mic + call-tab capture, 16 kHz PCM tap, voice-activity sampling)                                                                                                                           | `browser/speech-web/src/capture.ts`                               | Browser-only (Web Audio, `getUserMedia`, Chrome's `chromeMediaSource: 'tab'`). The `chrome.runtime.getURL` call is gone: the host passes `pcmWorkletUrl`. |
| `outputKind` (headphones vs speakers heuristic)                                                                                                                                                                  | `cognitive-brain/speech/src/outputDevice.ts`                      | Pure, so Android can reuse it with its own device labels.                                                                                                 |
| `needsToolbarClick` (Chrome `activeTab` grant error)                                                                                                                                                             | `extension/src/audio/captureErrors.ts`                            | Chrome-specific, stays in the extension.                                                                                                                  |
| `pcm-tap-worklet.js`                                                                                                                                                                                             | `extension/public/`                                               | Plain file because a worklet module loads by URL.                                                                                                         |
| Offscreen handlers `offscreen:audio:start/stop/snapshot`, `offscreen:dictation:start`, `offscreen:stt:poll` and the matching `offscreenAudio*` / `offscreenDictationStart` / `offscreenSttPoll` bridge functions | `entrypoints/offscreen/main.ts`, `browser-ml/offscreen-bridge.ts` | Manifest permissions (`tabCapture`, `activeTab`, `offscreen`) and the `USER_MEDIA` / `AUDIO_PLAYBACK` offscreen reasons were already present.             |

Not restored: the caller. In meet-coach the side-panel hook `useAudioChannels` gets the `tabCapture` stream id after a user gesture and drives these messages, and `background.ts` handles the toolbar click that grants `activeTab`. Until that is brought over, the capture path is complete but nothing starts it. `DualChannelCapture` has no unit test because it needs real Web Audio; it has only been type-checked and built.

## 11. `packages/ui-kit` review (duplication)

### Status of the folder

- **Untracked.** `packages/ui-kit/` is not in git and is not git-ignored. It is not in the root `workspaces`, the typecheck config or any build.
- **No `package.json`**, no `tsconfig.json`, so it is not a package and nothing can import it by name.
- **Size.** About 22.5k lines in 124 files: 100 `.jsx`, 11 `.tsx`, 9 `.js`, 1 `.ts` and 3 `.txt`. It is mostly `.jsx` and untyped. (An earlier estimate of about 21k lines was low.)
- **Platform.** React Native / Expo. It imports `react-native`, `@expo/vector-icons`, `expo-router`, `react-native-reanimated` and similar, and uses `.native` / `.web` file splits. It is the mobile app's UI layer, copied here.
- **It cannot build here.** 138 imports point at `@/packages/app-core/*` (theme, stores, hooks, services), and that package does not exist in this repo. Consumers of `ui-kit` also live in the app, so "nothing in the repo imports this file" cannot be turned into "this file is unused".
- **Stale paths after the folder move.** 6 imports use `@/packages/storage-suite/src/utils/storage`, which is now `packages/cognitive-brain/storage-suite`. 3 imports reach into `@/packages/cognitive-brain/memory/src/...` by deep path (`adapters/mobile/SQLiteStore`, `core/goals/GoalManager`, `core/goals/criteria`) instead of the `@page-agent/memory` subpaths, which breaks the "no deep imports into another package's `src/`" rule.
- **Tests.** 6 test files (React Native Testing Library) in `memory/` and `common/`. None can run here for the same reason.

### Duplication found

Method: exact file hashes, then similarity of normalized source lines (comments, imports and brace-only lines removed) within `ui-kit` and against every other `.ts/.tsx/.js/.jsx` file in the repo, then a manual read of the suspicious pairs.

**Exact duplicates:** none.

**Cross-repo copy-paste:** none by line content. That is expected, because `ui-kit` is React Native and the rest of the repo is DOM. The overlaps below are in purpose, not text.

**Inside `ui-kit` (near-duplicates and superseded copies):**

| Files                                                                                                                                                               | Evidence                                                                                                                           | Likely situation                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `input/DropdownSheet.jsx` and `input/MultiDropdownSheet.jsx`                                                                                                        | 77% of lines shared, about 70 differing lines out of about 210                                                                     | Real copy-and-modify. One component with a `multiple` prop, or a shared base, would replace both                                      |
| `ads/GoogleAds.js`, `GoogleAds.web.js`, `GoogleAds.jsx`, `GoogleAds.native.js`                                                                                      | `.js` and `.web.js` share 67%: the same web ad-script loader, one with a `Platform.OS` guard                                       | Four variants of one component; the plain `.js` duplicates the `.web.js` logic. Keep the `.web` / `.native` split and delete the rest |
| `ads/GoogleAds.native.js.txt`, `astro/SunSignDisplay.jsx.txt`                                                                                                       | Backup copies of live files (about the same size as the originals)                                                                 | Delete; git history already keeps old versions                                                                                        |
| `auth/BiometricLoginModal.jsx` and `BiometricRegisterModal.jsx`                                                                                                     | About 186 differing lines out of about 300                                                                                         | Shared shell (modal, prompt, error state) with two flows; extract the shell                                                           |
| `buttons/MicButton.tsx` and `MicButton2.jsx`                                                                                                                        | 47% shared; both are a pulsing mic button on `react-native-reanimated`. `MicButton2.jsx` still carries an old path comment         | `MicButton2` looks superseded. Only `MicButton` is imported (by `ChatInterface`)                                                      |
| `input/CheckboxTitle.jsx` and `ThemedCheckbox.jsx`; `SwitchTitle.jsx`, `SwitchWithDescription.jsx` and `ThemedSwitch.jsx`; `SliderInput.jsx` and `ThemedSlider.jsx` | 54% shared for the checkbox pair, 32% for the slider pair; the switch variants all wrap the same `Switch`                          | A themed primitive plus "with title" and "with description" wrappers written several times, each re-implementing the control          |
| `common/Header.jsx` (632 lines), `Header2.jsx` (192), `SimpleHeader.jsx` (79)                                                                                       | All three default-export a component named `Header`; textually different. Only `Header` is imported inside `ui-kit` (by `Contact`) | Three generations of one component                                                                                                    |
| `chat/ChatInterface.tsx` (730), `ChatWindow.tsx` (631), `Chat_Control_1.jsx` (504, exports `ChatUI`), `ChatUI.jsx` (0 lines)                                        | Textually different but the same role; `ChatUI.jsx` is empty                                                                       | Several chat screens and a stub. `Chat_Control_1` and the empty `ChatUI.jsx` look like leftovers                                      |
| `views/Accordion.jsx` (61) and `AccordionComponent.jsx` (156)                                                                                                       | Two accordions                                                                                                                     | Likely one is the old version                                                                                                         |
| `views/ProgressCircle1.jsx`                                                                                                                                         | Numbered like a variant                                                                                                            | Check for a successor before keeping                                                                                                  |
| `chat/ChatWorkerMock.js` and `MLCEngineMock.js`                                                                                                                     | Test doubles for the worker and the engine                                                                                         | Fine, but move them under a `__mocks__` folder                                                                                        |
| Empty files: `chat/ChatUI.jsx`, `ads/ads.txt`                                                                                                                       | 0 bytes                                                                                                                            | Remove                                                                                                                                |

**Overlap with the rest of this repo (same job, different code):**

| `ui-kit`                                                                         | Elsewhere                                                                                                                                                                            | Assessment                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat/MessageEmotionButtons.tsx` (84 lines)                                      | `extension/src/components/ui/MessageEmotionButtons.tsx` (95 lines, `lucide-react`)                                                                                                   | Same component forked for the DOM (about 141 differing lines, mostly icons and markup). Keep two renderers, but define the prop contract (`onEmotionClick(event, messageId, message, feedback?)`) once |
| `chat/ThinkingMessageParser.ts` (192 lines, pure TypeScript)                     | `extension/src/browser-ml/llm-rag.ts` (`_stripThinkingTokens` plus a streaming `<think>` splitter) and `extension/src/llm/voice-chat/integration.ts` (a `<think>` regex)             | Three separate implementations of the same parsing. The pure parser has no React Native import, so it fits `@page-agent/llms`; both apps could use one copy                                            |
| `chat/ChatWorker.js` (51 lines)                                                  | `extension/src/browser-ml/llm-worker.ts` (6 lines)                                                                                                                                   | Both only wrap `WebWorkerMLCEngineHandler`; the `ui-kit` one adds error posting. Trivial, but one worker wrapper is enough                                                                             |
| `chat/ChatEngine.jsx` (`MLCModelCacheManager`: model queue and size tracking)    | `cognitive-brain/llms/src/BrowserLLMClient.ts` (`engineCache`, refcounted engines)                                                                                                   | Overlapping responsibility for WebLLM engine lifecycle with different designs. Decide which owns it                                                                                                    |
| `chat/Models/OpenAIEndpointSection.jsx`, `ModelSelector/VisionModelSelector.tsx` | `extension/src/entrypoints/ai-provider-settings`, `browser-llm-settings`, `browser-ml/model-constraints.ts`, `website/src/lib/webllm/models.ts`, `storage-suite/.../llama.config.ts` | The repo already has several model catalogs; `ui-kit` adds another. The provider-resolution logic now in `@page-agent/llms` (`createProviderResolver`) is what the settings screens should call        |
| `memory/GoalsDashboard.jsx` status mapping (`in-progress` vs `in_progress`)      | `memory/src/core/goals` (`GoalStatus`)                                                                                                                                               | The screen re-maps a status the memory package already defines; it should import the type                                                                                                              |
| `chat/SettingsModal.jsx`                                                         | `extension/src/entrypoints/phone-simulator/SettingsModal.tsx`                                                                                                                        | Same name only; no shared content found                                                                                                                                                                |
| `common/Footer.jsx`, `common/Header.jsx`                                         | `website/src/components/Footer.tsx`, `Header.tsx`                                                                                                                                    | Same names only; no shared content found                                                                                                                                                               |

### Placement recommendation

`ui-kit` does not fit the three tiers: it is React Native UI, so it must not live in `browser/` and must not be imported by `cognitive-brain/`. A fourth tier, for example `packages/mobile/ui-kit`, would fit, with the rule that it imports `cognitive-brain` only and never `browser` or `extension`. Before that, it needs a `package.json` and a decision on where `app-core` lives, because 138 imports depend on it.

### Limits of this check

Similarity was measured on line content, so it finds copy-and-modify but not two components written independently for the same job; those were found by reading names, exports and sizes, and some may be intentional. I did not run any `ui-kit` code. I did not check `.css`, assets or the SVG imports (`../../../assets/icons/*.svg`), which point outside this folder.
