# Migration plan: isolating the extension from `cognitive-brain/`

**For:** engineers working on meet-coach.
**Status date:** 2026-11-13.
**Background:** `AdoptingCognitiveBrainAndBrowser.md` (how the layout works) and `ReusablePackagesReview.md` (why). Both were written in `page-agent-rp`; where they differ from meet-coach, this file wins.

**Decision (2026-11-13): `packages/browser/` is not created now.** It is created only when a website or an Android app needs it, so the extension does not carry packages it does not use. Until then `page-controller`, `ui`, `page-agent` and `graph-viewer` stay in `packages/`.

**What was verified (final state of this round).** Root typecheck and extension typecheck clean. Tests: extension 916 passed (2 skipped), `access-policy` 11, `core` 54, `llms` 58, `memory` 323, `speech` 67, `storage-suite` 17. `wxt build --mode production` succeeds. ESLint is clean on the files changed in this round (not run over the whole repo). **Not verified:** the built extension was not loaded in Chrome, so the new on-device path (section 1.3) has only a unit test; nothing was run on Android.

---

## 1. Done

### 1.1 Packages now consumed from `packages/cognitive-brain/`

| Package         | Old folder | Notes                                                                                                                                                                                                                                                                                                                           |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory`        | deleted    | Same code as the old copy plus Prettier formatting; the one code change is that the root no longer exports `IndexedDBProceduralStore` (still on `@page-agent/memory/adapters/web`). `AGENTS.md` kept the Playwright safety rule (`channel: 'chromium'`, `chromiumSandbox: true`). Extension pin moved from `1.8.2` to `1.12.4`. |
| `llms`          | deleted    | Gains `providers.ts` (`createProviderResolver`).                                                                                                                                                                                                                                                                                |
| `storage-suite` | deleted    | Gains OPFS (`/opfs`), `NamespacedFileStore` (`/file-store`) and the transformers loader. Its peer dependencies are all optional, so wiring it installs no React Native packages.                                                                                                                                                |
| `core`          | deleted    | Consolidated MCP client, `IPageController`, and no `./storage` export.                                                                                                                                                                                                                                                          |
| `speech`        | new        | Added to workspaces.                                                                                                                                                                                                                                                                                                            |
| `access-policy` | new        | Added to workspaces.                                                                                                                                                                                                                                                                                                            |

Root `workspaces` order is now: `page-controller`, `ui`, `cognitive-brain/llms`, `cognitive-brain/storage-suite`, `cognitive-brain/core`, `cognitive-brain/memory`, `cognitive-brain/access-policy`, `cognitive-brain/speech`, `page-agent`, `graph-viewer`, `mcp`, `extension`, ...

### 1.2 Extension code that moved out

| Extension code                                                                                                                                       | Now                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/memory/{orchestrator,consolidation,inferenceAdapter,types,index}.ts`                                                                            | `@page-agent/memory/orchestration`                         | The package version is a superset. It also fixes: non-Latin entity ids merging into one node, the `T3` "LLM unavailable" placeholder stored as a fact, an unhandled rejection in the auto-consolidation tick, per-event listener bookkeeping, and an empty `sessionId`. `think()` now throws when only the placeholder is available instead of returning it as an answer. Glue: `src/memory/inferenceWiring.ts`, called from `background.ts` before `new SmritiOrchestrator`. |
| `src/stt/{types,presets,sttSession,sttTurns,echoGuard,utteranceCutter,dictation,punctuationScore}.ts`, `src/audio/{channelActivity,outputDevice}.ts` | `@page-agent/speech`                                       | The package was older than the extension: the speaker-separation (diarization) support (`SttSegment.speaker`, `DiarizationPollState`, `SttSession.setSpeakerSource`, `sttTurns` using the speaker) was ported into it first, with tests. `meet/types.ts` re-exports `CaptionTurn` from `speech`.                                                                                                                                                                              |
| `src/accessListControl/`                                                                                                                             | `@page-agent/access-policy` (+ `/dom` for `buildSnapshot`) | The code was identical except that `buildSnapshot` and its helpers moved to `./dom`. Used only by `entrypoints/page-agent.content.ts`.                                                                                                                                                                                                                                                                                                                                        |
| `src/business-logic/chromeExtensionRanking/`                                                                                                         | removed                                                    | Nothing in the extension imported it. The package copy exists (`@page-agent/business-logic`, injected `TrackedExtensionStore`) but is **not wired**; wire it when a feature needs it.                                                                                                                                                                                                                                                                                         |
| `src/llm/providers/adapter.ts`                                                                                                                       | `createProviderResolver` in `@page-agent/llms`             | `adapter.ts` is now a thin wrapper that binds the `DEMO_*` constants and keeps the same exported names, so no call site changed. Behaviour is identical except that the debug `console.log` calls are gone.                                                                                                                                                                                                                                                                   |
| `@page-agent/core/storage` imports (`lib/widgetWorker.ts`, `skills/skill-store.ts`)                                                                  | `@page-agent/storage-suite/opfs`                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Other path fixes: `vitest.config.ts` aliases (`core`, `llms`), the `import.meta.glob` skill paths in `skills/skill-store.ts`, the core version lookup in `wxt.config.js`, and `lib/widgetFramework.test.ts` (relative imports into `cognitive-brain/core/src`, see 3.3). `LocalStorageAdapter` in `shared/storageAdapter.ts` uses an explicit field instead of a constructor parameter property (`erasableSyntaxOnly`); this was the only root typecheck error.

### 1.3 On-device model for memory (`LLM_INFERENCE`)

The on-device model already existed: WebLLM through the `browser` provider (`BrowserLLMClient` in `llms`). The memory orchestrator runs in the background service worker, which cannot host it, and the old path sent a `LLM_INFERENCE` message that nothing handled, so it returned empty text.

Now: `entrypoints/offscreen/main.ts` handles `offscreen:llm:infer` using the same `LLM` client (engine cached per model, unloaded after a grace period). `browser-ml/offscreen-bridge.ts` exports `offscreenLlmInfer()` (15-minute timeout, because loading a model can mean a large download). `memory/inferenceWiring.ts` uses it. One unit test covers the bridge.

- **Limitation:** `maxTokens` is not honoured, because `BrowserLLMClient` does not pass it to WebLLM. Noted in the handler.
- **Provider choice:** memory resolves its model through `getTextLLMConfig` (`memory/inferenceWiring.ts`), like every text-only feature. With the demo provider and no text-LLM override it is blocked, so memory text is never sent to the shared demo endpoint; the adapter then reports "LLM unavailable" instead of storing a placeholder. Covered by `inferenceWiring.test.ts`.
- **Chrome Web Store:** no new permissions. The `offscreen` permission and the offscreen document already exist, and the content security policy is unchanged.

### 1.4 `core`: old `native-mcp-client` import paths removed

Six one-line re-export files were deleted (`protocol/jsonrpc`, `transport/{IMCPTransport,SSETransport,StreamableHTTPTransport}`, `toolPrompt/{buildToolSystemPrompt,parseToolCall}`) and their importers now import from `core/src/mcp` directly. The barrel `native-mcp-client/index.ts` still exports the same names. `session/MCPSession.ts` stays: it holds a real subclass. Nothing in the extension used these paths; the Expo app's deep imports of them must move to `@page-agent/core/mcp`. `core`'s 54 tests pass; its typecheck shows only missing React Native packages in files the repo typecheck already excludes.

### 1.5 Tooling and docs

- `tsconfig.typecheck.json`: paths for `llms`, `core`, `memory` point at `cognitive-brain/`.
- `eslint.config.js`: ignore glob `packages/**/src/components/ui`, plus the no-type-info override for `.native.ts`, vitest configs and benchmarks.
- `scripts/sync-version.js`: reads `workspaces` instead of scanning `packages/*`. Only syntax-checked; **not run** (it rewrites every package version).
- Root `AGENTS.md`: updated paths, added the new packages, the tier rule, and the `offscreenLlmInfer()` entry. There is no root `CLAUDE.md` in this repo.

---

## 2. Current state of the tree

- **In `packages/cognitive-brain/`:** `access-policy`, `business-logic` (unwired), `core`, `llms`, `memory`, `speech`, `storage-suite`, `docs`.
- **Still in `packages/` (intended, until a website or Android app needs `browser/`):** `page-controller`, `ui`, `page-agent`, `graph-viewer`, plus `extension`, `mcp`, `e2e`, `website`/`companion-app` where present.
- **Formatting noise:** the copied packages were Prettier-reformatted, so the first commit shows large whitespace and import-order diffs. Commit formatting separately from logic if you want a reviewable history.

---

## 3. Remaining

### 3.1 Not needed until `browser/` exists

| #   | Item                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Create `packages/browser/` and move `page-controller`, `ui`, `page-agent`, `graph-viewer` into it. Take the `page-agent-rp` copies, not the old folders: `ui` still imports `../../../extension/src/lib/widgetRuntime` and `lib/db` and calls `chrome.runtime`, which the `browser/ui` copy fixes with `WidgetHost`. Diff each against the local one first. |
| B2  | `browser/speech-web`: move `whisperEngine`, `modelCache`, `offscreenStt` and `audio/capture.ts` (as `DualChannelCapture`, taking a `pcmWorkletUrl` instead of calling `chrome.runtime.getURL`).                                                                                                                                                             |
| B3  | `WidgetHost` implementation in `extension/src/lib/widgetHost.ts`, once the `ui` widget panels are mounted.                                                                                                                                                                                                                                                  |
| B4  | Extension `package.json` lists `@page-agent/ui` and `page-controller`/`page-agent` deps; nothing in `src` imports `@page-agent/ui`. Drop it or keep it for B3.                                                                                                                                                                                              |

### 3.2 Speech

| #   | Item                                        | Notes                                                                                                                              |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| S2  | `stt/knowledgeEnhancer.ts`                  | Depends on `dictation` (now in `speech`) and the knowledge folder. Decide whether it is speech logic or extension logic.           |
| S3  | `stt/transcriptCleanup.ts` and its fixtures | Imports `../meetingCoach/noteFacts`. Move `noteFacts` too, or keep this file in the extension.                                     |
| S5  | `diarization/`                              | Stays in the extension (an unchanged MIT copy of an external project plus glue). Revisit only if Android needs speaker separation. |

### 3.3 Boundaries and housekeeping

| #   | Item                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | ~~CI import-boundary rule~~ **Done**                                                                    | ESLint `no-restricted-imports` and `no-restricted-globals` in `eslint.config.js`: no relative import into another package's `src/`; `cognitive-brain` may not import `@page-agent/{page-controller,ui,page-agent,graph-viewer,ext}`, `wxt`, `@/…` or use `chrome`. Not enforced: unguarded DOM globals in `cognitive-brain`. |
| H2  | ~~widget test imported `core/src` by relative path~~ **Done**                                           | `@page-agent/core` now exports `classifyError` and `getBuiltInTools()` (a read-only copy of the tool registry); the test imports from the package.                                                                                                                                                                           |
| H3  | `tsconfig.typecheck.json` does not include `storage-suite`, `access-policy`, `speech`, `business-logic` | The extension typecheck covers what the extension imports. Add them if you want the libraries checked on their own. `storage-suite` needs its `.native.ts` and `speechPolyfill.ts` excluded, as in the adopting doc.                                                                                                         |
| H4  | `@page-agent/business-logic` is wired to nothing                                                        | Add it to workspaces and the extension's dependencies when the Chrome ranking feature is wanted.                                                                                                                                                                                                                             |
| H5  | `maxTokens` ignored by the on-device model                                                              | Pass it through `BrowserLLMClient` if memory prompts need a cap.                                                                                                                                                                                                                                                             |
| H6  | Whole-repo ESLint run                                                                                   | Only the files changed here were linted. The pre-commit hook lints every renamed file, so expect existing errors in files you touch.                                                                                                                                                                                         |

### 3.4 Carried over from the review (package level, not the extension)

- `graph-viewer` has no consumer.
- The two OAuth providers and the MCP config types are not unified.
- Orchestration has no SQLite wiring, and there is no native `INamespacedFileStore`.
- `core` still has browser-specific files behind `.web.ts` names (`skill-store.web.ts`, `skill-assets.web.ts`).

---

## 4. Recommended order for what is left

1. **Load the built extension in Chrome** and exercise: memory (a session end triggers consolidation), the on-device provider (set the provider to `browser` with a downloaded model, then trigger a consolidation or `think`), dictation and a call with speaker separation, and a page with a login form (access policy). These were covered by tests and the build, not by a live run.
2. ~~H2, then H1~~ Done (see section 6).
3. **S2 and S3**: small decisions, each its own commit.
4. **H3**: widen the typecheck once the packages are stable.
5. **B1 to B4 only when** a website or Android app needs them. Use the `page-agent-rp` copies and diff first.

### Rules to follow at every step

- Never overwrite a package blindly. Diff first. The meet-coach STT code was newer than the copy, and the old `memory` AGENTS rule was newer than the copy's.
- Stage explicit paths, not `git add -A packages`.
- Do not stage a file and then edit it before committing: lint-staged's restore step fails.
- Run `npm install --ignore-scripts` after every workspace change.
- Do not run `scripts/sync-version.js` to test it.
- Do not run Prettier over `cognitive-brain/core/skills/**` (it breaks the skill frontmatter).

### Verification checklist

1. `npm install --ignore-scripts`
2. `npx tsc --noEmit -p tsconfig.typecheck.json` and `npx tsc --noEmit -p packages/extension/tsconfig.json`
3. `npx vitest run` in `packages/extension` and in each `packages/cognitive-brain/*` package (`llms` with `--project llms`)
4. `cd packages/extension && npx wxt build --mode production`
5. `grep -rnE "from ['\"][^'\"]*(extension/src|storage-suite/src)" packages/cognitive-brain` prints nothing

## 5. Open questions

- Is the `maxTokens` limit of the on-device model acceptable for memory consolidation prompts (H5)?
- Should `knowledgeEnhancer` live in `speech` (S2)?

## 6. Fixes from the pre-commit review (2026-11-13)

- `core/vitest.config.js` (a second, redundant config) removed; `core/vitest.config.ts` now aliases `@page-agent/llms` with an exact-match regex. The plain-string alias broke every test run.
- `eslint.config.js` lints `core/src/native-mcp-client/**` without type information (no tsconfig covers it; the pre-commit hook failed on 12 parse errors).
- `.prettierignore` excludes `cognitive-brain/core/skills`, and four reference documents that Prettier had rewritten (`*italic*` to `_italic_`) were restored from `HEAD`.
- `memory` `SynthesisEngine`: the no-WebCrypto fallback hashed only the length and the first 32 characters, so changed text could look unchanged. It now hashes the whole content (React Native's Hermes usually has no `crypto.subtle`).
- Known and left as is: `VectorStore`/`IVectorStore` lost their `<Metadata>` generics (an API narrowing, noted in the adopting doc); the native MCP session identifies itself as `GuideAxon` in the initialize handshake; `EmbeddingService.web` now requires the host to call `configureTransformersLoader` (the extension does not use it today, and its own `browser-ml` embeddings are unaffected).

### H1 and H2 follow-up

- H1 found three violations the grep had missed:
    - `core/src/native-mcp-client/AgenticLoop.ts` imported `../../../../agent-runtime/src/loopGuard`, a package that does not exist here. The folder is excluded from typecheck and vitest, so nobody noticed. Added `native-mcp-client/loopGuard.ts` (dependency-free). The folder's `AgenticLoop` tests (7) now pass when run with a config that includes them; they are still excluded from `npm test` with the rest of the folder.
    - **H7 (open):** `packages/ui/src/panel/{ActiveWidgets,WidgetGallery,WorkflowStepStrip,DebugInspector}.tsx` import `extension/src/lib/widgetRuntime` and `lib/db` by relative path, which also points the dependency the wrong way (ui -> extension). They are exempted by name in `eslint.config.js`. Fix: inject the widget and session API into the panel through `PanelAgentAdapter`, then delete the exemption.
- `@page-agent/memory` had no `test` script, so `npm test` skipped its 324 tests. Added.
