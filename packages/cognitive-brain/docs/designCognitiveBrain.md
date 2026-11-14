# Hybrid Cognitive Memory Platform

## Product Requirements & System Architecture Document

Version: 2.2
Date: June 23, 2026

> **Path note:** the layout sections below write `packages/memory/` and `packages/core/`. Since the 2026-11-01 folder move these are `packages/cognitive-brain/memory/` and `packages/cognitive-brain/core/`.

**Last revised:** 2026-09-24 (§16.8 code review found and fixed a real event-archival data-loss gap and a triplicated `slugify` — see revision history and §0's document map)

---

# Revision History

**Note:** entries below are one-line pointers, not a substitute for reading the section. This table is a changelog, not a second draft of the document — for anything more than "what changed and where," read the cited section; don't reconstruct it from this table.

| Version         | Date          | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0             | May 26, 2026  | Initial architecture — four reference implementations (GA, Smriti, GBrain, LLM-Wiki-Compiler)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2.1             | May 27, 2026  | Unified BrainEngine/IIntelligenceEngine layering; SKILL.md discovery; session state tiering; competitive analysis vs. Open Agents/Firecrawl/agents-sample                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2.2             | June 23, 2026 | Unified SkillDefinition; OKF-compatible frontmatter (§5.5); Vault Connection UI + pending flush queue (§6.12); user-authored skills (§6.13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.3             | June 23, 2026 | Removed `ISkillRegistry`/deterministic `execute` from `@page-agent/memory` — browser tool execution belongs in the extension, not this package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.4 (addendum)  | 2026-09-10    | Flags that this document predates the GA→CB migration (§15A covers what's missing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.5 (addendum)  | 2026-09-22    | §16 added (Supermemory comparison) — §16.1-§16.3 now implemented, §16.4-§16.6 remain proposals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.6 (addendum)  | 2026-09-22    | §17 added (Profile / One-Pager / Compaction Recap / Goals Board) — proposed, not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.7 (addendum)  | 2026-09-22    | §17.3 One-Pager finalized: graph-seeded scope → vector dedup → LLM condensation, replacing the flat-merge placeholder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.8 (addendum)  | 2026-09-22    | §18 added (Reconciliation) — proposed, not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.9 (addendum)  | 2026-09-22    | Supermemory follow-ups: §17.2.7 (profile advantages), §17.2.8 (buckets), §16.5 (multi-modal wiring), §16.6.1 (`search_memory` tool), §18.6 (reconciliation scheduling)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.10 (addendum) | 2026-09-22    | §17.1.1 added — local-first, vault-optional persistence for Profile/one-pager/workstream/reconciliation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2.11 (addendum) | 2026-09-22    | Closed five open questions: §18.3.1 (T1/T2 tiering), §18.2 (workstream dedup), §17.2.9 (Profile viewer + correction), §17.2.8 (named default buckets), §18.4 (per-change confidence, stricter `prune` bar)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.12 (addendum) | 2026-09-22    | §18.9 added — known limitation: prose isn't derived from typed relations (decorative, not load-bearing); three follow-on mitigations recorded, not designed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.13 (addendum) | 2026-09-22    | §19 added — WHO/HOW/WHAT/WHEN/WHY taxonomy cross-reference, supersedes `designMemory.md` V3's narrower taxonomy as the organizing reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.14 (addendum) | 2026-09-22    | §19 tightened: ingestion/storage/retrieval components axis (§19.1.1), sharper session-replay-vs-episodic distinction, provider-landscape placement (§19.8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.15 (addendum) | 2026-09-22    | **Consolidation pass** following a full critical review. Fixed the duplicate `# 15` header (§15A). Trimmed this table to one line per entry. Corrected two reuse claims that didn't hold up against the actual code: `SynthesisEngine`/`IBrainEngine.synthesize()` return only a count today and need a real interface extension for §17.2.5/§18.4's section-scoped, structured output (not a drop-in reuse as previously stated); `InProcessGraph.computeClusters()` returns only an entity→cluster assignment, not the size/activity data §18.2's promotion criteria needs (also unwritten aggregation logic, not "reuse `computeClusters()`"). Flagged §17.1.1's vault-flush-degrades-gracefully assumption as unverified. Added an explicit "unvalidated shared default" caveat to the repeated 0.7/0.85 confidence thresholds, and flagged §18.4's per-change confidence mechanism as an unproven capability, not just an unimplemented one. Consolidated the three-way redundant "why GuideAxon beats Supermemory" argument (§16.6.1, §17.2.7, §19.8) down to one canonical version in §19.8 with the other two trimmed to cross-references. Added §0 "Document Map" distinguishing core architecture (§1-15) from competitive analysis/extensions (§16-19) in lieu of a full file split, which was assessed as too high-risk given the volume of cross-references into §16-19 from other proposed sections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.16 (addendum) | 2026-09-23    | **§17.2 (The Profile) implemented.** `ProfileClassifier` (T0 regex classification into the three fixed headers, written as `profile:<header>` tags), `ProfileSynthesizer` (static/dynamic split + LLM composition with T3 fallback), `ProfileClassificationProcessor` (registered in the pluggable chain after `ContradictionResolutionProcessor`), and `MemoryService.persistProfileSection()`/`getProfile()`/`assertProfileCorrection()` (fixed-ID local artifact, same pattern as the graph snapshot). Implementation surfaced a deeper problem than §2.15's `SynthesisEngine` correction anticipated: `compile()` hard-requires a vault (`if (!this.vault) return 0`) and is concept-extraction-shaped, not section-regeneration-shaped - no method addition would have fixed that, so `ProfileSynthesizer` was built independent of `SynthesisEngine` entirely. Extending `IBrainEngine` also required updating its other two implementations, `DesktopBrainEngine` and `NoOpBrainEngine`, which the original design note didn't anticipate. §17.3-§17.5 (One-Pager, Compaction Recap, Goals Board render) remain proposed. Vault push for the Profile artifact is not yet implemented (§6.12 itself remains unimplemented). 24 new tests added (`ProfileClassifier`, `ProfileSynthesizer`, `ProfileClassificationProcessor`), full suite (61 tests) passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.17 (addendum) | 2026-09-23    | **§5.1's foundational principle corrected, and `SynthesisEngine.compile()` fixed to match.** v2.0's original wording ("synthesized knowledge goes to vault") conflated synthesis's actual purpose — refining raw memory for the app's own local use — with the vault, which only exists for two orthogonal purposes: recovery (app storage reset/lost) and cross-device continuity. `compile()` previously returned `0` unconditionally with no vault configured, silently discarding all synthesis output for any install without one. Fixed: `SynthesisEngine` now takes an injected `IMemoryStore` and persists every synthesized artifact locally, unconditionally, as `type: 'artifact'` `MemoryEntry` rows; the vault push (`IVaultProvider.updatePage()`) still happens but only when configured, additive rather than gating. `compile()` now returns `0` only when _neither_ a store nor a vault exists. `upgradeT1Artifacts()` (desktop's T1→T2 vault-upgrade flow) intentionally keeps its own vault requirement — it's inherently cross-device, unlike `compile()`. `MemoryService` now passes its own `memStore` into `SynthesisEngine`'s constructor. §6.7 updated to describe the corrected behavior. 3 new regression tests added (`SynthesisEngine.test.ts`) covering: synthesize-and-persist with no vault at all, `compile()` returning `0` only when both store and vault are absent, and vault push not suppressing local persistence when both exist. Full suite (64 tests) passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.18 (addendum) | 2026-09-23    | **§17.6 wired: the Profile now actually reaches `ChatModeOrchestrator`.** Until this entry, §17.2's Profile machinery was correct and tested in isolation but never called from the real chat flow — nothing invoked `getProfile()` or injected it into the system prompt. Added `formatProfileForPrompt()` (pure formatter, `core/profile/`) and called `this.brain.getProfile()` from all three system-prompt-assembly call sites across `ChatModeOrchestrator.web.ts`/`.native.ts` (native has two: `handleTextMessage()` and the AgenticLoop path), injected as §17.6's section 1. 4 new tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.19 (addendum) | 2026-09-23    | **§17.5 (Goals Board) implemented.** `GoalManager.renderBoard()` added, backed by a new pure `formatGoalsBoard()` formatter; filters to open goals (`pending`/`in_progress`/`paused`), omits `completed`. Wired into `ChatModeOrchestrator` as §17.6 section 3. Implementation surfaced a real, pre-existing bug: `storeGoal()` pre-generated its own ID for new goals, but `IMemoryService.create()` always assigns its own — so the ID returned to callers never matched the real backing entry, and `closeGoal()` silently no-opped on any goal created this way. This is exactly what §17.7's own verification checklist ("open two goals, close one; verify `renderBoard()` omits it") would have caught immediately; fixed by capturing `create()`'s returned ID. 7 new tests, including that exact checklist scenario.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2.20 (addendum) | 2026-09-23    | **§17.3 (Memory One-Pager) implemented**, per the Scope → Dedup → Condense pipeline finalized in v2.7. New files: `core/onepager/scopeSelection.ts` (`topSalienceEntitiesInWindow()`, `expandScope()` wrapping `InProcessGraph.expandNeighbors()`, `collectEntriesLinkedToEntities()`), `core/onepager/dedup.ts` (`clusterBySimilarity()` — cosine over an injected `embeddingFn`, degrading to lexical/Jaccard similarity when none is available, since no `embeddingFn` is currently threaded through `MemoryServiceConfig`; `pickRepresentative()`), `core/onepager/OnePagerSynthesizer.ts` (`regenerate()`, LLM condensation with T3 fallback, `markStaleIfScoped()`). `IBrainEngine.getOnePager()` added (stubbed in `DesktopBrainEngine`/`NoOpBrainEngine`/extension's `SmritiOrchestrator`, matching the existing `getProfile()` stub convention). Two deliberate deviations from §17.3.6, both documented in code: (1) persistence bypasses `SynthesisEngine.compile()` despite the doc asserting its signature "suffices" — `compile()` is genuinely N-concept→N-page shaped (the same mismatch v2.16 already found for the Profile), so persistence follows `ProfileSynthesizer`'s precedent of a fixed-ID local artifact instead; (2) a 30-minute TTL cache stands in for the "session start, or every N turns" scheduler, achieving the same "periodic, not per-turn" behavior without new timer infrastructure. Wired into `ChatModeOrchestrator` as §17.6 section 2. §16.7's `HybridMemoryIndex` reference doesn't match anything in this package (only `OramaIndex` exists) — treated as aspirational/stale rather than blocking. 22 new tests, covering 6 of §17.3.8's 8 checklist items (early invalidation and cadence followed in 2.21).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.21 (addendum) | 2026-09-23    | **§17.4 (Compaction Recap) implemented, and the two remaining §17.3.8 checklist gaps (early invalidation, cadence) closed with real integration tests.** `WorkingMemoryManager` gained an `onEvict()`/`offEvict()` callback bus (mirrors `GoalManager.onGoalClosed()`); `core/working/CompactionRecap.ts` is a deliberately LLM-free, 200-token-capped buffer that captures one `ContextBuilder.formatEntry()` line per eviction. `IBrainEngine.getCompactionRecap()` added, wired into `ChatModeOrchestrator` as §17.6 section 4. Building the first _real_ `MemoryService` test (previously every test in this package faked `IMemoryService` directly — no in-memory `IMemoryStore`/`IMemoryIndex` existed) surfaced two further pre-existing bugs, both fixed: (1) `MemoryService.list()` silently ignored `orderBy`/`order` entirely — it only paginated whatever order the store returned (always `createdAt` descending per `IMemoryStore`'s cursor-pagination contract), meaning §17.3's `topSalienceEntitiesInWindow()` was never actually salience-sorted against a real store; fixed with client-side sorting in `list()`. (2) `markOnePagerStaleIfScoped()` was fire-and-forget even at its direct, supposedly-synchronous call site in `assertProfileCorrection()`, making the "early invalidation" guarantee racy; made properly awaitable and awaited there (left fire-and-forget at the async pipeline-event call site, where that's correct). Also discovered: the async T0 pipeline overwrites any caller-supplied `salience` shortly after `create()` (by design — salience is system-computed, not user-set), which the new integration test's helper works around by pinning salience via a follow-up `update()`. 22 new tests (12 for the recap/eviction hook, 10 integration tests against the real `MemoryService`, including both previously-open §17.3.8 checklist items). §17.2-§17.6 are now all implemented, tested, and wired end-to-end into `ChatModeOrchestrator`; full memory-package suite: 112 tests passing, stable across repeated runs.                                                                                                                                                                                                                                                                                |
| 2.22 (addendum) | 2026-09-23    | **§16.4 superseded by §16.8 (Knowledge Graph: Final Approach).** Three candidate graph designs were compared from a long-term (pre-production, not sunk-cost) perspective — GuideAxon's own flat-typed-predicate-edge proposal (§16.4, now deprecated), Supermemory's `isStatic`/version-chain/relation-label schema, and Lumen-Labs/brainapi2's event-centric (Actor→Event→Target→Context) model — and a sizing pass run against the winning design before committing. §16.8 documents the decision: an event-centric graph, schema adopted from brainapi2 but re-scoped for on-device/mobile-first execution (op-sqlite storage instead of Neo4j, single-pass T0 extraction instead of the 4-agent swarm, async enrichment via the existing eventual-consistency pipeline instead of synchronous multi-agent validation), with a recency-window + rollup-to-summary-node discipline (extending §18's `computeClusters()`/workstream-promotion pattern) required from the start to bound hub-entity edge fan-out. §16.4 remains in the document, marked deprecated, for historical record of why the flat-edge design was rejected in favor of event nodes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.23 (addendum) | 2026-09-24    | **§16.8 implemented and its verification gate run.** `EventNode`, the three `event_actor`/`event_target`/`event_context` edge types, `InProcessGraph.createEventNode()`/`getEventsForEntity()`/`pruneStaleEvents()`, and `EventGraphProcessor` (single-pass T0/T1 extraction, gated at confidence ≥ 0.7, wired into `MemoryService`'s pluggable processor chain via a new `graph` field on `ProcessorContext`). `pruneStaleEvents()` wired into `MaintenanceCycle` as a new phase 4 (`event_rollup`; the cycle is now 10 phases, not 9) — archives rolled-off events to a local artifact unconditionally, pushes to vault additionally when configured. The §16.8.2 verification gate (re-benchmark depth-2 traversal at 10k/100k nodes with realistic degree skew) was run and found a real problem: unmitigated hub traversal at 10k events measured 703ms, not the ~5-10ms §3.3 assumed — partly the predicted hub fan-out, partly a latent O(frontier²) bug in `expandNeighbors()`'s `Array.shift()`-based BFS queue (pre-existing, also used by `ContextBuilder`/`scopeSelection`/the One-Pager, never exercised at this scale before). Fixed with an index-cursor queue (no behavior change); post-fix unmitigated traversal is 6.9ms (10k events) / 120ms (100k events), and with the hot-window mitigation applied, ~0.2-0.3ms at both scales regardless of total historical event count. 22 new tests across `InProcessGraph`, `EventGraphProcessor`, and `MaintenanceCycle`'s new phase; full memory-package suite (135 tests) passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2.24 (addendum) | 2026-09-24    | **Post-implementation code review of §16.8 found two real bugs in the 2.23 landing, both fixed.** (1) `MaintenanceCycle.phaseEventRollup()`'s own comment already claimed `archiveEvents()` runs unconditionally (matching §5.1's principle, restated at line ~1652's status callout), but the code didn't match the claim: `pruneStaleEvents()` deletes rolled-off events from the graph synchronously as a side effect, then `archiveEvents()` — the only place those events get persisted anywhere — was gated behind `if (Date.now() - start < budgetMs)`, checked _after_ the deletion had already happened. Under budget pressure (a tight per-cycle `budgetMs`, or this phase running after earlier phases had already consumed most of it), the events were silently gone with no local or vault record, contradicting the code's own stated invariant. Fixed by removing the gate entirely — `archiveEvents()` now always runs when there's anything to archive; the outer `runPhases()` cycle-level budget check (which runs _before_ a phase starts, unchanged) still governs whether `event_rollup` runs at all. (2) `slugify()` existed as three independent, byte-for-byte-identical copies (`InProcessGraph.ts`'s original private one, a `slugifyPublic` copy hand-added to `MemoryService.ts`, and a third copy in the new `EventGraphProcessor.ts`, the last two each carrying a comment admitting they had to "mirror" the first). Consolidated to one canonical, exported `slugify()` in `InProcessGraph.ts`; `MemoryService.ts` and `EventGraphProcessor.ts` now import it instead of redeclaring — closes a silent-drift risk where a future edit to entity-id normalization in one copy (e.g. Unicode handling) would desync event role IDs from the entity IDs `wireEntry()` actually created, silently breaking `getEventsForEntity()`/`getRecentEvents()` for affected entities with no error. Both bugs were found by an adversarial multi-angle code review, not by the §16.8.2 benchmark or the 22 tests added in 2.23 — neither exercises the maintenance-cycle budget-exhaustion path or cross-checks the three `slugify` copies against each other. `tsc --noEmit` re-run clean on the memory package (only pre-existing, unrelated environment errors: missing `@types/node`/`vitest`/`@page-agent/llms` type declarations). |

---

# 0. Document Map

This document has two halves with different levels of grounding, added at different times — worth knowing before reading further:

|                                       | Sections | What it is                                                                                                                                                                                                                                                                                               | Grounding                                                                                                                                                                                                          |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Core architecture**                 | §1-15A   | The original platform design: interfaces, data flow, phased implementation, plus the GA→CB migration addendum                                                                                                                                                                                            | Ranges from aspirational (original v2.0-v2.3) to code-verified (§15A's addendum)                                                                                                                                   |
| **Competitive analysis & extensions** | §16-19   | Added 2026-09-22 in a single extended design session, driven by a feature-by-feature comparison against Supermemory (§16), followed by proposals for what an answering model should be fed (§17), how synthesized documents stay current (§18), and a functional taxonomy for organizing all of it (§19) | §16.1-§16.3 are implemented and tested (see §16's own status note); everything else in §16-19 is proposed, not implemented, and ranges from well-specified to explicitly flagged as needing further design (§18.9) |

If you're looking for **what GuideAxon's memory architecture currently does**, start in §1-15A and `docs/Memory/designMemory.md` (the actually-implemented memory system this platform doc sits above). If you're looking for **where it's headed and why**, §16-19 is the relevant half — but check each subsection's own status callout before treating anything there as current behavior.

---

# 1. Executive Summary

This document defines the requirements, architecture, strategic decisions, and implementation principles for a hybrid cognitive memory platform designed to support persistent AI cognition across:

- Mobile devices (iOS, Android, web browser)
- Local desktop environments
- Local-first AI workflows
- Long-term organizational memory
- Human-readable synthesized knowledge
- Autonomous and semi-autonomous AI agents

## Core Architecture in One Sentence

> **Local episodic memory (SQLite/IndexedDB) + lightweight local synthesis (T1 LLM) → Central Markdown Vault (via MCP) ← Desktop re-synthesis (T2 LLM) + richer graph backend (Postgres/pgvector).**

## What Makes This Different

This is not a RAG application. It is a **Cognitive Operating System** with three independently operable tiers:

| Tier                  | Platform            | Role                                                    |
| --------------------- | ------------------- | ------------------------------------------------------- |
| **Working Cognition** | Web / Mobile        | Capture events, lightweight synthesis, read vault       |
| **Deep Cognition**    | Desktop             | Full synthesis, graph reasoning, source ingestion       |
| **Canonical Memory**  | Central Vault (MCP) | Synthesized markdown artifacts, shared across all tiers |

Mobile users get a fully self-sufficient system. Desktop users get a better one over time. The vault is the only sync point — raw episodic memory never leaves the device.

## The Two-Layer Architecture (v2.1)

Version 2.1 formalizes a key structural distinction that runs across all platforms:

```
┌────────────────────────────────────────────────────────────────┐
│              IIntelligenceEngine (Web / Mobile only)            │
│    Agent personas · Workflow DAG · Skill execution · Streaming  │
└────────────────────────────────┬───────────────────────────────┘
                                 │  plugs into
┌────────────────────────────────▼───────────────────────────────┐
│               IBrainEngine  (ALL platforms)                     │
│  search · store · think · getContextPack · synthesize           │
│                                                                 │
│  Web/Mobile: IndexedDB + Orama + InProcessGraph                 │
│  Desktop:    Postgres + pgvector + Neo4j  (+ MCP server)        │
└────────────────────────────────────────────────────────────────┘
```

**Desktop**: `IBrainEngine` is the entire system. It is a passive memory layer — it exposes its methods as MCP tools. The intelligence (reasoning, decisions, multi-step plans) comes from external agents: Claude Code, OpenClaw, Hermes. GBrain's job is to supply context, not produce cognition.

**Web / Mobile**: `IBrainEngine` is the memory substrate. `IIntelligenceEngine` is layered on top — it gives the system conversational agent identity, workflow execution, and skill management. The two layers are decoupled: the intelligence layer can be swapped without touching the memory layer.

## Reference Implementations Evaluated

This architecture is informed by six evaluated codebases:

| Codebase                      | Contribution to This Design                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GA**                        | Memory abstraction interfaces (`IMemoryStore`, `IMemoryIndex`, `IMemoryService`), multi-tier L0→L1→L2 hierarchy, event-driven pipeline                                |
| **PA-Memory (Smriti)**        | Tiered LLM inference (T0–T3), 7 forgetting/retention policies, 3-pass graph building, salience formula                                                                |
| **GBrain**                    | Knowledge graph typed edges, 9-phase maintenance cycle, Minions job queue, BrainEngine interface, OpenClaw/Hermes agent integration                                   |
| **LLM-Wiki-Compiler**         | Synthesis engine (two-phase compile pipeline), provenance tracking, incremental processing, MCP server, vault integration                                             |
| **Open Agents (Vercel Labs)** | SKILL.md filesystem discovery, Zod-validated tool schemas, AGENTS.md always-present context, streaming LLM loop pattern                                               |
| **agents-sample** (this repo) | `SkillDefinition` interface (adapted from SkillDefinition) with semver versioning, `SkillExecutionEngine`, `TabsController` multi-page orchestration, `SkillRegistry` |

---

# 2. Strategic Vision

## 2.1 Core Problem

Most AI systems today operate using transient cognition:

```text
Query → Retrieve → Generate → Forget
```

Traditional RAG systems optimize chunk retrieval, embedding similarity, and token injection — but human cognition does not operate this way. Humans compress knowledge, form abstractions, synthesize summaries, maintain episodic memory, and continuously refine mental models.

This platform is designed around that cognitive principle.

## 2.2 The Synthesis Gap

The most important gap in existing memory systems: **none of them produce human-readable canonical knowledge artifacts**. They store raw events or embeddings, but never generate the compressed, explainable, portable knowledge that makes memory useful over time.

This platform solves that gap with a dedicated **Synthesis Engine** that transforms raw episodic memory into interlinked, cited, versioned markdown artifacts.

## 2.3 The Mobile-First Constraint

A user on mobile must have a fully functional cognitive platform. Desktop is an optional quality enhancer, not a dependency. This drives the **Option C synthesis strategy**:

1. Mobile captures episodic events locally → runs **T1 lightweight synthesis** → pushes artifacts to vault
2. Desktop detects T1-quality vault artifacts → runs **T2 full synthesis** → upgrades artifacts in-place
3. Both tiers read from the same vault — quality improves automatically when desktop is used

## 2.4 The Platform Separation Principle (v2.1)

The most important architectural decision in v2.1 is the formal separation of **memory** from **intelligence**:

- **Memory** (`IBrainEngine`) = universal, platform-adaptive substrate: store, retrieve, synthesize, context-pack
- **Intelligence** (`IIntelligenceEngine`) = platform-specific cognition layer: agent personas, skill execution, DAG workflows, streaming

This maps precisely to how GBrain works on desktop — GBrain IS the memory layer, and external agents (Claude Code, OpenClaw) ARE the intelligence. We replicate that model on mobile and web by building the `IIntelligenceEngine` as a separable, swappable module.

---

# 3. Competitive Analysis & Strategic Decisions

This section documents what competing web-based agentic frameworks are doing in the three areas where we had open architectural questions, and explains the strategic reasoning behind the choices we made.

## 3.1 Tool Execution — Industry Survey

### What Open Agents (Vercel Labs) does

Open Agents uses TypeScript functions registered in a **tool registry** with Zod-validated input schemas. Tools execute server-side inside the LLM loop — the model outputs a structured JSON tool call, the AI SDK intercepts it, executes the TypeScript function, and injects the result back into the message context before the next LLM turn.

For extensibility, Open Agents uses **SKILL.md** — Markdown files with YAML frontmatter that describe a skill's metadata (`name`, `description`, `version`, `allowed-tools`, `disable-model-invocation`). These files are discovered by scanning standard directories (`skills/`, `.claude/skills/`, `.agents/skills/`) recursively. Validation uses Zod. Skill names are uniqueness-checked and conflict-detected against built-in commands at registration time.

Their evaluation data shows that **AGENTS.md** (always-present skill descriptions injected into the system prompt) outperforms the async-loaded SKILL.md approach in agent evaluations: 100% pass rate vs 79%, with an 80% context size reduction (40KB → 8KB). The lesson: information that agents always need belongs in the system prompt, not behind a retrieval step.

### What Firecrawl does

Firecrawl does not own a tool registry. It IS a tool — a remote API service that acts as a browser-automation tool provider for external LLM agents. Agents call `/v2/scrape/{scrapeId}/interact` with natural language prompts, JavaScript/Python/Bash code, or structured CLI commands. Firecrawl executes these in a sandboxed Chromium browser and returns updated accessibility tree state.

The key insight: **deterministic browser actions** (click, fill, scroll, extract) are executed without LLM involvement. The LLM only decides _what_ to do; Firecrawl does _how_ to do it. This separation keeps the LLM out of mechanical execution entirely.

### What agents-sample (this repo) does

`agents-sample/skills/` has the most production-grade skill execution system in this codebase. Each skill is a typed `SkillDefinition` with:

- Zod input and output schemas (validated on both sides)
- `fallbackToLLM: boolean` — deterministic actions can opt into LLM fallback when execution fails
- `timeoutMs` — 5s for deterministic, 30s for LLM-assisted
- Semver versioning with constraint resolution (multiple versions coexist, best match selected)

12 built-in deterministic actions: calculator, URL encoder/decoder, time, color lookup, SVG sanitizer, page markdown extractor, HTML sanitizer, text rephraser, page summarizer.

### What we currently do

`WorkflowExecutor` has the `TOOLS` archetype emit `TOOL_CALL: {"tool": "...", "server": "vault", "args": {...}}` tokens from raw LLM output, which are parsed by a regex. This has no schema validation, no deterministic execution, no versioning, and only covers vault operations. It is fragile and limited.

### **Our decision: SKILL.md instruction injection — deterministic execution stays in the extension**

**Reasoning**: The `SkillDefinition` pattern from `agents-sample/skills/` is well-designed for the extension's `MultiPageAgent` layer, which owns `RemotePageController`. It is the wrong pattern for `@page-agent/memory`.

`@page-agent/memory` is platform-agnostic — it runs in a Chrome extension, an Expo mobile app, and a Node.js desktop process. Adding deterministic browser skills with `execute` functions that wrap `RemotePageController` would introduce an extension-only dependency into a package that must never depend on `@page-agent/page-controller`. The mobile and desktop builds would break.

The `WorkflowExecutor` inside `@page-agent/memory` can dispatch vault tool calls (`query_wiki`, `search_pages`) directly via `IVaultProvider` — that IS a memory-layer concern. Everything else — browser clicks, DOM fills, page scrolls — belongs to the layer that actually owns the browser: the extension's `MultiPageAgent`.

**The correct pattern for `@page-agent/memory`:**

1. **SKILL.md instruction injection** — the active skill's `instructionBody` is injected into each agent's system prompt by `WorkflowExecutor`. The LLM decides what to do based on those instructions.
2. **Vault tools via `IVaultProvider`** — the TOOLS archetype emits `TOOL_CALL: {"tool": "query_wiki", "server": "vault", ...}` tokens; `WorkflowExecutor` resolves them directly against `IVaultProvider`. No registry needed.
3. **Browser actions stay in the extension** — `MultiPageAgent` (extension layer, owns `RemotePageController`) handles all deterministic DOM operations. The memory package never calls `click()`, `fill()`, or `scroll()`.

> **v2.3 correction:** ISkillRegistry with deterministic `execute` functions is removed from `@page-agent/memory`. The `skills/impl/browser.ts` file (which wrapped `RemotePageController`) was an architectural boundary violation — a platform-agnostic package must not depend on extension-only APIs. SKILL.md instruction injection is the memory package's skill integration surface.

---

## 3.2 LLM Interaction — Industry Survey

### What Open Agents / Vercel AI SDK does

The AI SDK defines the now-standard LLM interaction loop:

```
User prompt
    ↓
LLM call → model outputs: text OR tool_call (name + JSON args)
    ↓
If tool_call: SDK executes registered tool function
    ↓
Tool result appended to messages[]
    ↓
New LLM call with updated context
    ↓
Repeat until text-only response or maxSteps reached
```

All of this streams to the client via **NDJSON**. Users see partial output as it is generated. `onStepFinish` callbacks fire after each completed step. Tool execution errors appear as typed `tool-error` stream parts. The LLM never sees raw text tool calls — it generates structured JSON, which the SDK intercepts before it reaches the conversation history.

Multi-model routing is dynamic: Vercel Feature Flags + Edge Config select the model per-request at runtime.

### What Firecrawl does

Firecrawl is a tool provider, not an orchestrator. It does not own the LLM interaction loop. The calling agent (Claude, OpenAI, etc.) maintains `messages[]`. Firecrawl's responses (accessibility tree state, extracted markdown) are injected into that history by the agent, not Firecrawl itself. Token streaming happens in the browser session background queue, returning state updates incrementally.

### What agents-sample does

A single LLM loop where each step appends the full `agent_history[]` to the prompt. The agent outputs a JSON object with `evaluation`, `memory`, `next_goal`, and `actions[]`. The loop runs until `done: true`. No streaming — the client blocks until the full step completes. Context grows linearly with no pruning — a problem for long tasks.

### **Our decision: Move to AI SDK streaming loop for IIntelligenceEngine**

**Reasoning**: The current `WorkflowExecutor` makes one blocking `invoke()` call per archetype and returns the full result at the end. This means users see nothing until all DAG stages complete. For a multi-agent workflow with 3–5 stages, that is a poor UX.

We adopt the AI SDK streaming loop pattern inside `IIntelligenceEngine` for the following reasons:

1. **User experience**: Partial output streams to the UI as it is generated. The user sees SCOUT findings arriving before WEAVE synthesis begins.
2. **Tool execution**: Typed tool calls (from `SkillRegistry`) execute inside the loop rather than via fragile token parsing after the LLM completes.
3. **Error handling**: `tool-error` stream parts surface failures immediately, not after the full DAG finishes.
4. **Cancellation**: Users can abort mid-workflow; streaming makes this natural.

The DAG multi-agent structure is preserved — agents within a stage still run in parallel — but each agent now streams its output incrementally rather than blocking.

> **Backward compatibility**: `@page-agent/llms` (`LLM.invoke()`) is not replaced. The streaming loop is a new `IIntelligenceEngine` behaviour layered above it for interactive use. Non-interactive synthesis (background jobs, vault compilation) continues to use `invoke()`.

---

## 3.3 Session State — Is Persistent Graph + Episodic Store Too Heavy for Web/Mobile?

### What Open Agents does

Conversation history is maintained in a `messages[]` array, persisted in Vercel KV between turns. AGENTS.md context is always present in the system prompt. Skills load asynchronously when needed. For sandbox state, Open Agents uses a separate Vercel Sandbox abstraction (snapshot-based hibernation, 10-min inactivity). No episodic memory — history is the only persistent state.

### What Firecrawl does

Browser session state has a 10-minute TTL and 5-minute inactivity timeout. A `profile` parameter with `saveChanges: true` persists cookies, localStorage, and sessions cross-session. The billing model (credits per second) explicitly incentivizes developers to manage session lifecycle — this is a design pressure that produces lean state.

### What agents-sample does

IndexedDB-backed session history (`useAgent.ts:loadSession`). The full `agent_history[]` is carried in the prompt per step. No semantic compression. For long tasks this causes context overflow — the growing history array is the primary architectural limitation of the agents-sample approach.

### The actual performance numbers

| Operation                                         | Web (IndexedDB + Orama) | Mobile (SQLite) |
| ------------------------------------------------- | ----------------------- | --------------- |
| Single entry write                                | ~1ms                    | ~0.5ms          |
| Semantic search, 1,000 entries                    | ~10ms                   | ~5ms            |
| Semantic search, 10,000 entries                   | ~80ms                   | ~40ms           |
| In-process graph traversal (1,000 nodes, depth-2) | ~10ms                   | ~5ms            |
| T1 LLM importance scoring                         | ~200–2,000ms            | ~500–3,000ms    |
| Full synthesis compile (10 entries)               | ~5–30s                  | ~10–60s         |

The episodic store and graph are not the bottleneck — the LLM is. Orama BM25 search over 10,000 entries takes ~80ms. The T1 LLM call for scoring takes up to 2 seconds. Everything except LLM calls can run synchronously without meaningful latency impact on mobile.

### **Our decision: Three-tier session state — persistent graph + episodic store is not too heavy**

**Reasoning**: The question "is it too heavy?" dissolves when the data is tiered by query frequency. We never query all 10,000 episodic entries per agent call — we query the semantic index (Orama), get top-K results, and inject those. The graph is queried as neighbor expansion (depth-2 from current task entities, not a full traversal).

```
Tier 1 — In-memory, session lifetime (discarded at close)
  WorkingMemory (4096t default)       — active reasoning context
  Active graph slice                   — neighbors of current task entities only

Tier 2 — Local persistent, device lifetime (IndexedDB / SQLite)
  Episodic store (last ~500 active entries, older compressed)
  Semantic index (Orama, rebuilt from store on first load)
  Graph snapshot (serialized, rebuilt from snapshot)
  Workflow history (IWorkflowPersistence)

Tier 3 — Vault, cross-device canonical (MCP)
  T1/T2 synthesized artifacts
  Shared across all platforms via IVaultProvider
```

The direct consequence: agents-sample's context-overflow problem disappears. Instead of a growing `agent_history[]`, each agent call injects a **token-budgeted context pack** assembled from Tier 1 (working memory) + Tier 2 (semantic recall top-K) + Tier 3 (vault artifacts). The token budget is fixed; quality degrades gracefully as history grows (older low-salience entries are evicted).

The Firecrawl TTL insight applies to Tier 1 only: session-scoped data is ephemeral by design. Tier 2 persists across sessions precisely because it is compressed and synthesized — it is not the raw growing history.

---

# 4. High-Level Architecture (v2.1)

```text
┌─────────────────────────────────────────────────────────────────┐
│              IIntelligenceEngine  (Web / Mobile only)            │
│                                                                 │
│  WorkflowExecutor (Nemilia DAG)                                  │
│    8 archetypes · parallel stages · output validation           │
│                                                                 │
│  SKILL.md instruction injection                                 │
│    Active skill's instructionBody → agent system prompts        │
│    Vault tool calls → IVaultProvider directly (no registry)     │
│    Browser/DOM dispatch → extension MultiPageAgent layer        │
│                                                                 │
│  IWorkflowPersistence (pluggable)                               │
│    InMemory · IndexedDB · Hybrid (default)                      │
│                                                                 │
│  Streaming LLM loop (AI SDK pattern)                            │
│    Skill instructions → injected into agent system prompts      │
└────────────────────────────────┬───────────────────────────────┘
                                 │  plugs into IBrainEngine
┌────────────────────────────────▼───────────────────────────────┐
│                  IBrainEngine  (ALL platforms)                   │
│                                                                 │
│  store()           — episodic write (non-blocking)              │
│  search()          — hybrid semantic search (vector + BM25)     │
│  think()           — T1/T2 synthesis answer                     │
│  synthesize()      — two-phase compile → vault artifacts        │
│  getContextPack()  — token-budgeted context assembly            │
│  getWorkingMemory()                                             │
│  runRetentionPolicies()                                         │
├────────────────┬──────────────────────┬─────────────────────────┤
│  Episodic      │  Semantic Memory     │  Knowledge Graph         │
│  Memory        │  (Hybrid RRF Search) │  (Typed Edges)           │
│  L0→L1→L2      │                      │                          │
└────────┬───────┴──────────┬───────────┴──────────┬──────────────┘
         │                  │                       │
         └──────────────────▼───────────────────────┘
                            ↓ Synthesis Engine
                            ↓ MCP
┌─────────────────────────────────────────────────────────────────┐
│            Central Vault (IVaultProvider via MCP)               │
│         Tolaria | Obsidian | Any MCP-compatible vault           │
└─────────────────────────────────────────────────────────────────┘
         ↑ Web/Mobile MCP read/write (T1)    ↑ Desktop MCP (T2)
┌────────┴──────────────────┐    ┌───────────┴─────────────────────┐
│      Web / Mobile         │    │           Desktop               │
│                           │    │                                 │
│  IBrainEngine impl:       │    │  IBrainEngine impl:             │
│  IndexedDB + Orama        │    │  Postgres + pgvector + Neo4j    │
│  InProcessGraph           │    │                                 │
│  T1 synthesis             │    │  Exposed as MCP server          │
│                           │    │  No IIntelligenceEngine here    │
│  IIntelligenceEngine:     │    │  External agents (Claude Code,  │
│  WorkflowExecutor         │    │  OpenClaw, Hermes) are the      │
│  SKILL.md injection       │    │  intelligence layer             │
│  IWorkflowPersistence     │    │                                 │
└───────────────────────────┘    └─────────────────────────────────┘
```

---

# 5. Strategic Architectural Principles

## 5.1 Separation of Raw Memory vs Synthesized Knowledge

_(v2.0's original wording, "synthesized knowledge goes to vault," was corrected 2026-09-23 — see below. The raw-memory half of this principle is unchanged.)_

Raw memory (stays local): noisy, temporal, append-only, high volume, incomplete, event-driven. Examples: conversations, tasks, browser events, code sessions, decisions. Raw memory is never considered canonical knowledge and never syncs across devices.

**Corrected principle (2026-09-23): synthesized knowledge is generated for the app's own local use, first.** The point of synthesis is refining raw memory — compressing it into something explainable, curated, stable, and citable — for GuideAxon itself to read back on every subsequent turn. That refinement has nothing to do with whether a vault exists; conflating "synthesized" with "in the vault" (v2.0's original framing) meant `SynthesisEngine.compile()` returned `0` and produced nothing at all whenever no vault was configured — an app-reset-recovery and cross-device mechanism was, by accident, gating the core local refinement it was never meant to gate.

The vault serves two purposes, both orthogonal to local operation:

1. **Recovery** — if local app storage is reset or lost, vault content is how synthesized knowledge (not just raw episodic memory, which never syncs at all) survives that.
2. **Cross-device continuity** — a user picking up on desktop after syncing sees the same synthesized knowledge, rather than having to re-synthesize it from scratch on the new device.

```text
Raw Memory (local device, never synced)
    ↓  T1 synthesis (mobile) / T2 synthesis (desktop)
Canonical Artifacts — persisted LOCALLY, unconditionally, no vault required
    ↓  (additive, only when a vault is configured — recovery + cross-device continuity)
Central Vault (Tolaria / Obsidian / any MCP-compatible vault)
```

Implemented in `SynthesisEngine.compile()` (§6.7): local persistence via an injected `IMemoryStore` is unconditional; the vault push happens _in addition_, gated only on whether `IVaultProvider` is configured — never as a prerequisite. This generalizes the same local-first/vault-optional relationship §17.1.1 established for the Profile to synthesis as a whole, since it turned out to be the same underlying principle stated too narrowly the first time.

## 5.2 Capability-Based Architecture

The platform abstracts storage engines, retrieval algorithms, graph systems, embedding models, LLM inference, and skill execution behind stable interfaces.

```typescript
// Agent runtime interacts with capabilities, never implementations
brain.search(query) // NOT: orama.search(query)
brain.store(event) // NOT: db.put(event)
brain.getContextPack(prompt) // NOT: memory.workingMemory + vault.search(...)
vault.readPage(slug) // NOT: obsidian.getFile(slug)
```

### Core Interfaces

```typescript
interface IBrainEngine {
    store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<string>
    search(query: string, options?: SearchOptions): Promise<MemorySearchPage>
    think(query: string): Promise<ThinkResult>
    synthesize(entries: MemoryEntry[]): Promise<number>
    getContextPack(prompt: string, budgetTokens?: number): Promise<ContextPack>
    getWorkingMemory(sessionId?: string): Promise<MemoryEntry[]>
    getRelated(id: string, relationType?: string): Promise<MemoryEntry[]>
    runRetentionPolicies(): Promise<RetentionResult>
    on(event: MemoryEvent, callback: (payload: unknown) => void): void
    initialize(): Promise<void>
    close(): Promise<void>
}

interface IIntelligenceEngine {
    execute(workflow: WorkflowDefinition): Promise<WorkflowResult>
    stream(workflow: WorkflowDefinition): AsyncIterable<WorkflowStreamEvent>
    executeSkill(id: string, args: unknown): Promise<unknown>
    listSkills(): SkillMeta[]
}

interface IWorkflowPersistence {
    saveAgentMemory(sessionId: string, memory: Record<string, string>): Promise<void>
    loadAgentMemory(sessionId: string): Promise<Record<string, string>>
    saveWorkflowResult(result: WorkflowResult): Promise<void>
    loadWorkflowHistory(limit?: number): Promise<WorkflowResult[]>
}
```

## 5.3 Local-First AI

_(Unchanged from v2.0)_

The system prioritizes local execution. Cloud models remain optional augmentation layers. The system must remain functional when fully disconnected.

Strategic reasons: privacy, ownership of cognition, offline operation, low latency, reduced inference cost, user trust, enterprise deployment flexibility.

## 5.4 Tiered LLM Inference

_(Unchanged from v2.0)_

| Tier   | Capability                     | Cost           | Used For                                                      | Platform Default |
| ------ | ------------------------------ | -------------- | ------------------------------------------------------------- | ---------------- |
| **T0** | Rules, regex, keyword matching | Free, no model | Entity extraction, salience scoring, outcome classification   | Always available |
| **T1** | Small local model (Ollama/MLC) | Low, on-device | Lightweight synthesis, entity linking, structured extraction  | Mobile default   |
| **T2** | Full model (local or cloud)    | High, powerful | Full synthesis, contradiction resolution, procedure evolution | Desktop default  |
| **T3** | Graceful fallback              | Zero           | No-LLM mode, offline operation                                | Fallback always  |

The platform gracefully degrades from T2 → T1 → T0 → T3 based on available compute and connectivity.

## 5.5 Human-Readable Cognition

Synthesized knowledge artifacts must remain inspectable, editable, portable, versionable, and human-readable. Markdown is the canonical synthesized knowledge format with YAML frontmatter for machine-readable metadata.

**OKF compatibility (v2.2, revised 2026-10-08):** Vault artifacts were made compatible with [Open Knowledge Format v0.1](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing). Three fields were added to `PageFrontmatter` for that: `type` (OKF-required concept type — e.g. `'synthesis'`, `'insight'`, `'procedure'`), `resource` (canonical source URL; null for synthesized-only artifacts), and `timestamp` (ISO-8601 alias for `synthesizedAt` — OKF's last-update field). The vault slug serves as the OKF file-path identifier (in the specification the Concept ID is the path without `.md`).

**The current specification is v0.2** ([`SPEC.md`](https://github.com/GoogleCloudPlatform/open-knowledge-format), read 2026-10-08). It changes two things that matter here: **`timestamp` is superseded by `generated.at`** (readers may still fall back to `timestamp`), and provenance is `sources`, a list of entries that each carry a required `resource` URI. It also adds `generated: { by, at }`, `verified`, `status` (`draft | stable | deprecated`), `stale_after`, and an `okf_version` marker in the bundle-root `index.md`. Where this implementation stands against v0.2:

- `type` is present, and it is the only key OKF always requires, so minimal compliance still holds.
- `timestamp` is now a legacy field. It is still written for one release, next to `generated.at`, and is then to be removed. `PageFrontmatter` now has `generated` and `status`; `verified`, `stale_after` and `okf_version` are not supported.
- **`sources` held `MemoryEntry` ids, which is not the v0.2 shape** (OKF's entries are mappings with a `resource` URI). The earlier statement here that every existing field "does not conflict with OKF" was therefore wrong for `sources`. Since 2026-10-08 the ids are written as `sourceIds`, a custom key, and `sources` is left for v0.2-shaped entries. The other existing fields (`synthesisQuality`, `provenanceState`, `contradictedBy`, `aliases`, `confidence`) are additive custom keys, which the specification allows.
- **Which writer produces what:** `ObsidianVaultProvider` (file system) writes the full `PageFrontmatter` and **now writes OKF v0.2** (below). `ObsidianRestVaultProvider` and `GitHubVaultProvider` write the **MKDF** layout through `toMkdf`, which keeps only a fixed list of fields (see 5.5.1). MKDF is a different format with its own `capturedAt`; those two writers are unchanged and are not OKF writers.

**Implemented 2026-10-08 (file writer only).** `toOkfV02()` (`vault/okf.ts`) is applied when `ObsidianVaultProvider` writes a page: it makes sure `type` is present (the synthesis engine never set one, so those pages were not valid OKF before), derives `generated: { by, at }` from `synthesizedBy` and `synthesizedAt` (a bare producer name becomes the actor `process:memory-engine`), keeps `timestamp` for one release, and moves string ids from `sources` to `sourceIds`. The provider's front-matter reader and writer (`vault/frontmatterYaml.ts`) were replaced because the old line-based reader turned a nested map into a stray top-level key and the old writer did not escape quotes or line breaks in strings. The new one reads and writes scalars, arrays and a one-level map; it is **not a full YAML parser**, and code that must read nested maps holding lists (the sync files) needs a real YAML library. Tests: `okf.test.ts`, `frontmatterYaml.test.ts` and `ObsidianVaultProvider.okf.test.ts` (run with `npx vitest run` from `packages/cognitive-brain/memory`; the package suite passes, 203 tests).

The sync design in `docs/designMemorySync.md` (section 5.5) writes OKF v0.2 directly and does not use `toMkdf`. Not done: updating the MKDF writers, `verified`, `stale_after` and `okf_version`.

### 5.5.1 Schema Comparison: MemoryEntry / PageFrontmatter vs MKDF vs OKF

The table below maps fields across all four schemas so future changes to any one can be evaluated against the others.

| Concept                   | `MemoryEntry` (runtime)         | `PageFrontmatter` (vault artifact)                      | MKDF `ExportableItem`         | OKF v0.2                                                                                |
| ------------------------- | ------------------------------- | ------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| **Identity**              | `id` (UUID)                     | slug (file path)                                        | `id` (`mkdf_{source}_{hash}`) | file path without `.md` (Concept ID)                                                    |
| **Concept type**          | `type` (`MemoryType` enum)      | `type` ← **OKF field (v2.3)**                           | `type` (free string)          | `type` (**required**)                                                                   |
| **Title**                 | `title`                         | `title`                                                 | `title`                       | `title` (optional)                                                                      |
| **Body / content**        | `content`                       | markdown body                                           | `body` (§ Source Content)     | markdown body                                                                           |
| **Source URL**            | `metadata.sourceUrl`            | `resource` ← **OKF field (v2.3)**                       | `url`                         | `resource` (optional)                                                                   |
| **Last updated**          | `synthesizedAt`                 | `timestamp` ← **OKF v0.1 field (v2.3); legacy in v0.2** | `capturedAt`                  | `generated.at` (`timestamp` is the legacy v0.1 form)                                    |
| **Tags**                  | `tags`                          | `tags`                                                  | `tags`                        | `tags` (optional)                                                                       |
| **Description**           | —                               | `aliases` (closest)                                     | —                             | `description` (optional)                                                                |
| **Author / agent**        | `agentId`                       | `synthesizedBy`                                         | `capturedBy`                  | `generated.by` (actor form: `<producer>/<version>`, `human:<id>` or `process:<id>`)     |
| **Sources / provenance**  | `sourceIds[]`                   | `sources[]` (strings: entry ids)                        | (§ References section)        | `sources[]` (entries that each carry a `resource` URI; **a different shape from ours**) |
| **Lifecycle**             | —                               | —                                                       | —                             | `status` (`draft \| stable \| deprecated`), `stale_after`                               |
| **Human verification**    | —                               | —                                                       | —                             | `verified[]` (`{ by, at }`)                                                             |
| **Bundle version**        | —                               | —                                                       | —                             | `okf_version` in the bundle-root `index.md`                                             |
| **Quality tier**          | `synthesisQuality`              | `synthesisQuality` (T1/T2)                              | § AI Enrichment               | —                                                                                       |
| **Confidence**            | `confidence`                    | `confidence`                                            | § AI Enrichment               | —                                                                                       |
| **Provenance state**      | —                               | `provenanceState`                                       | —                             | —                                                                                       |
| **Contradictions**        | `relations` (contradicts edges) | `contradictedBy[]`                                      | —                             | —                                                                                       |
| **Aliases**               | —                               | `aliases[]`                                             | —                             | —                                                                                       |
| **Salience / importance** | `salience`, `importance`        | — (runtime only)                                        | —                             | —                                                                                       |
| **Session / user scope**  | `sessionId`, `userId`           | — (runtime only)                                        | `source` field                | —                                                                                       |
| **MKDF document ID**      | —                               | derived via `MkdfAdapter.hashSlug(slug)`                | `id`                          | —                                                                                       |

**Key observations:**

1. **`MemoryEntry` is runtime-only** — salience, importance, userId, sessionId never leave the device. They are not serialised into vault artifacts.

2. **`PageFrontmatter` is the in-memory shape of a vault page, but only one writer serialises it whole.** `ObsidianVaultProvider` (file system) writes it in full, as OKF v0.2 since 2026-10-08. `ObsidianRestVaultProvider` and `GitHubVaultProvider` write MKDF through `toMkdf` (see 3). A page is minimally OKF-compliant only if `type` is present; `toOkfV02()` now guarantees it on the file writer (the synthesis engine did not set one).

3. **MKDF wraps `PageFrontmatter`, and the mapping is not lossless.** `MkdfAdapter.toMkdf()` writes only `title`, `type`, `resource` (as `url`), `timestamp` or `synthesizedAt` (as `capturedAt`), `tags`, `synthesisQuality`, `synthesizedBy`, `confidence` and `provenanceState`; the last four are also repeated in the `## AI Enrichment` section. **`sources`, `contradictedBy`, `aliases`, `lastUpgradedAt` and any extra field are dropped.** (Checked in `MkdfAdapter.ts`, 2026-10-08.)

4. **OKF requires only `type`** — everything else is additive. Our `PageFrontmatter` adds provenance, quality, contradiction tracking and aliases as custom keys, which the specification allows. The two earlier exceptions are handled on the file writer: ids that were written as `sources` now go to `sourceIds`, and `timestamp` is kept for one release next to `generated.at`.

5. **Round-trip fidelity depends on the provider.** `MkdfAdapter.fromMkdf()` can only reconstruct the fields `toMkdf()` wrote, so a page that goes through `ObsidianRestVaultProvider` or `GitHubVaultProvider` loses `sources`, `contradictedBy`, `aliases` and extra fields. The `[key: string]: unknown` index signature keeps extra fields only on the path that writes `PageFrontmatter` directly, `ObsidianVaultProvider.updatePage()`, which now also round-trips the nested `generated` map.

## 5.6 Skill Instruction Injection

**Skill instructions augment agent behaviour through prompt engineering, not code execution.**

`@page-agent/memory` is platform-agnostic. It must run identically in a Chrome extension, an Expo mobile app, and a Node.js desktop process. This rules out hosting deterministic `execute` functions that wrap browser APIs (`RemotePageController.click()`, `.fill()`, `.scroll()`). Those belong in the extension's `MultiPageAgent` layer, which actually owns the browser.

The memory package's skill integration surface is SKILL.md instruction injection:

```typescript
// WorkflowExecutor: inject active skill's instructionBody into each agent's system prompt
function buildAgentSystemPrompt(archetype: ArchetypeDefinition, activeSkill?: Skill): string {
    if (!activeSkill) return archetype.systemPrompt
    return `${archetype.systemPrompt}\n\n<active-skill>\n${activeSkill.instructionBody}\n</active-skill>`
}
```

**Vault tool calls** are the one category of tool execution WorkflowExecutor does own — because `IVaultProvider` is a memory-layer interface. The TOOLS archetype emits `TOOL_CALL: {"tool": "query_wiki", "server": "vault", ...}` tokens, and WorkflowExecutor resolves them directly against `IVaultProvider` without a registry.

**Architectural boundary (v2.3):** `@page-agent/memory` must never import from `@page-agent/page-controller`. Browser actions are dispatched by the extension layer after the LLM has decided what to do based on the injected skill instructions.

---

# 6. Core System Components

## 6.1 Agent Runtime Layer

### Purpose

Acts as the cognitive orchestration engine. Coordinates memory retrieval, tool execution, synthesis triggering, context construction, and agent workflow execution.

### Two Runtime Profiles

#### 6.1.1 Lightweight Runtime — Web / Mobile (Nemilia Pattern + IIntelligenceEngine)

**Philosophy:** Browser-native, stateless orchestration, no server required for core functionality. Agents are plain JSON definitions that compose into DAG workflows. The intelligence layer (`IIntelligenceEngine`) is a separable module that plugs into `IBrainEngine` — it can be replaced or omitted without affecting the memory substrate.

**8 Core Agent Archetypes:**

| Agent      | Role                      | Temp | Capability                                                                                     |
| ---------- | ------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| **SCOUT**  | Research & Discovery      | 0.25 | Gathers facts, saves to MEMORY                                                                 |
| **LENS**   | Analysis & Insights       | 0.35 | Transforms data into patterns and rankings                                                     |
| **QUILL**  | Content & Communication   | 0.65 | Writes clear, audience-tailored output                                                         |
| **FORGE**  | Critical Review & QA      | 0.30 | Identifies gaps, errors, logical weaknesses                                                    |
| **WEAVE**  | Synthesis & Summary       | 0.65 | Integrates findings into executive summaries                                                   |
| **NEXUS**  | Web Search & Live Data    | 0.20 | Live search + MCP tool execution                                                               |
| **VISION** | Visual & Chart Generation | 0.40 | SVG diagrams, charts, infographics                                                             |
| **TOOLS**  | Vault Tool Execution      | 0.10 | Emits `TOOL_CALL:` tokens for vault operations; WorkflowExecutor resolves via `IVaultProvider` |

**Always-present vault capability summary (AGENTS.md pattern):**

Each agent's system prompt includes a compact vault capability summary injected at construction time — not loaded lazily on request. This follows Open Agents' finding that always-present context achieves 100% agent awareness vs 79% for async-loaded discovery. The summary covers vault operations only (query_wiki, search_pages, read_page, get_context) — browser/DOM capabilities are not listed here; they belong to the extension layer.

**Active Skill injection (v2.2):**

When the user has an active Skill (selected via SkillPicker ⚡ in the extension UI), `buildSkillTaskPrefix(activeSkill)` prepends the Skill's `instructionBody` to the workflow prompt before `IIntelligenceEngine.stream()` is called. The WorkflowExecutor receives the combined prompt transparently — no DAG changes required. Phase 2 will thread a `skillInstruction` field through `WorkflowDefinition` for proper system-prompt injection into individual archetypes. See §6.13 for the full Skills system.

**Workflow Execution Model:**

```typescript
interface WorkflowDefinition {
    id: string
    agentIds: AgentId[]
    prompt: string // Template with {{variables}}
    dag: boolean // Enable parallel execution
    dagStages: Record<AgentId, number> // Stage grouping for parallelism
    feedbackLoops: Record<string, boolean> // 'agA:agB' bidirectional revision
    conditions: Record<
        AgentId,
        {
            // Skip if source scored < threshold
            sourceAgent: AgentId
            threshold: number
        }
    >
    hitlOverrides: Record<AgentId, boolean> // Human-in-the-loop gates
    validate: boolean // Auto-score outputs (0-10), retry if below valThreshold
    memory: boolean // Persist MEMORY[key]: value across agents
    orchestrator: {
        planTemp: number
        synthTemp: number
        valThreshold: number // Minimum score before retry
    }
}
```

**DAG Execution:**
Agents group by `dagStages` value and run in parallel within each stage. Stage 1 (NEXUS search) → Stage 2 (SCOUT + LENS in parallel) → Stage 3 (WEAVE synthesis). Each agent receives `priorSummary` of all previous agent outputs plus memory context.

**Streaming LLM Loop (v2.1):**

The `IIntelligenceEngine.stream()` method exposes per-agent output as it generates, following the AI SDK streaming pattern. Each agent in the DAG streams its partial output to the client; subsequent stages receive the completed output of prior stages. Users see SCOUT findings arrive before WEAVE begins synthesis.

```typescript
interface WorkflowStreamEvent {
    type:
        | 'agent.started'
        | 'agent.token'
        | 'agent.tool_call'
        | 'agent.tool_result'
        | 'agent.completed'
        | 'workflow.completed'
        | 'workflow.error'
    agentId?: AgentId
    stageNumber?: number
    token?: string
    toolCall?: { skillId: string; args: unknown }
    toolResult?: unknown
    output?: AgentOutput
    result?: WorkflowResult
}
```

**Memory Integration:**
Agents write persistent facts via `MEMORY[key]: value` tokens. A T0 model extracts these automatically. Memory context is injected into subsequent agents and persisted via `IWorkflowPersistence`.

**Vault Tool Execution:**
TOOLS agent emits `TOOL_CALL: {"tool": "...", "server": "vault", "args": {...}}` tokens. `WorkflowExecutor.resolveToolCalls()` intercepts these after each agent completes and calls the appropriate `IVaultProvider` or `IBrainEngine` method directly. Browser actions are not handled here — they are dispatched by `MultiPageAgent` in the extension layer.

---

#### 6.1.2 Rich Runtime — Desktop (MCP Server, no IIntelligenceEngine)

**Philosophy:** Full agent platform compatible with OpenClaw, Hermes, Claude Code, Cursor, and any MCP-aware agent client. The desktop runtime exposes `IBrainEngine` as an MCP server. External agents ARE the intelligence layer. The desktop adds no conversational agent logic — it is pure memory substrate.

**BrainEngine as MCP server:**

```typescript
// Desktop MCP server exposes IBrainEngine methods as tools
interface DesktopMCPServer {
    // Maps to IBrainEngine.search()
    search: Tool<{ query: string; topK?: number }, MemorySearchPage>

    // Maps to IBrainEngine.think()
    think: Tool<{ query: string }, ThinkResult>

    // Maps to IBrainEngine.store()
    ingest_source: Tool<{ content: string; metadata: SourceMetadata }, string>

    // Maps to IBrainEngine.synthesize()
    compile_wiki: Tool<CompileOptions, CompileResult>

    // Maps to IBrainEngine.getContextPack()
    get_context_pack: Tool<{ prompt: string; budget_tokens?: number }, ContextPack>
}
```

**Agent routing:**

```text
OpenClaw / Hermes / Claude Code
      ↓  MCP (OAuth 2.1)
Desktop IBrainEngine (MCP server)
      ↓
Postgres + pgvector + Knowledge Graph + Synthesis Engine
      ↓  MCP
Central Vault
```

---

## 6.2 IBrainEngine — Unified Memory Interface

### Purpose

`IBrainEngine` is the single, stable interface that all tiers of the system expose. The same interface is implemented three times with different backends:

| Implementation       | Platform            | Backend                              |
| -------------------- | ------------------- | ------------------------------------ |
| `WebBrainEngine`     | Web / Extension     | IndexedDB + Orama + InProcessGraph   |
| `MobileBrainEngine`  | React Native / Expo | SQLite + Orama + InProcessGraph      |
| `DesktopBrainEngine` | Node.js / Electron  | Postgres + pgvector + Neo4j/Memgraph |

`MemoryService` from Phase 1 is the concrete implementation of `IBrainEngine` for web/mobile. `IIntelligenceEngine` plugs into `IBrainEngine` and is only instantiated on web and mobile.

### Design principle: IBrainEngine does not know about agents

`IBrainEngine` has no knowledge of agent archetypes, workflow stages, or MEMORY tokens. It stores and retrieves memory entries. `IIntelligenceEngine` orchestrates agents and calls `IBrainEngine` for context. This is the same relationship as GBrain (memory) + Claude Code (intelligence) on desktop.

---

## 6.3 Memory Abstraction Layer

_(Interface design unchanged from v2.0 — see `IMemoryService`, `IMemoryStore`, `IMemoryIndex`)_

The upper layers must not know:

- which vector DB is used
- whether graph reasoning exists
- whether embeddings are local or remote
- which tier of LLM is active

**Eventual consistency principle (from GA):** Memory writes succeed immediately. Enrichment (embedding, synthesis, entity extraction, graph linking) happens asynchronously via the pipeline. This keeps the system responsive on mobile where pipeline jobs may be deferred.

---

## 6.4 Episodic Memory System

_(Unchanged from v2.0 — L0→L1→L2 hierarchy, salience formula, 7 retention policies)_

### Session State Tiering (v2.1)

Session state is explicitly tiered to prevent context overflow (the primary failure mode observed in agents-sample's growing `agent_history[]`):

```
Tier 1 — In-memory, session lifetime
  WorkingMemory (4096t default, configurable)
  Active graph slice (neighbors of current task entities, depth-2)
  → Discarded when session closes; never persisted to IndexedDB

Tier 2 — Local persistent, device lifetime (IndexedDB / SQLite)
  Episodic store (last ~500 active entries, configurable)
  Semantic index (Orama, rebuilt from store on first load)
  Graph snapshot (serialized adjacency map)
  Workflow history (via IWorkflowPersistence)
  → Survives page reload; subject to retention policies

Tier 3 — Vault, cross-device canonical (MCP)
  T1/T2 synthesized markdown artifacts
  Shared across all platforms via IVaultProvider
  → Only sync point; raw memory never leaves device
```

**Why this solves context overflow:** Each `IBrainEngine.getContextPack()` call assembles a fixed-size context from Tier 1 + Tier 2 top-K results + Tier 3 artifacts, bounded by a token budget. As episodic history grows, the oldest low-salience entries are evicted from the top-K ranking — the context window never grows unboundedly.

---

## 6.5 Semantic Memory System

_(Unchanged from v2.0 — Hybrid Search with RRF, intent-based adaptive weights, Orama/pgvector backends)_

---

## 6.6 Knowledge Graph System

_(Unchanged from v2.0 — typed edge vocabulary, self-wiring graph, 3-pass building, 9-phase maintenance)_

---

## 6.7 Synthesis Engine

Two-phase compile pipeline (SHA-256 incremental, provenance tracking, synthesis quality metadata) — unchanged from v2.0 in shape. **Persistence corrected 2026-09-23 (§5.1):** `compile()` no longer requires a vault. It takes an injected `IMemoryStore` (`MemoryService` supplies its own `memStore`) and persists every synthesized artifact there unconditionally, as `type: 'artifact'` `MemoryEntry` rows keyed by the same slug the vault would have used. The vault push — via `IVaultProvider.updatePage()` — still happens, but only when `vault` is configured; it's additive (recovery + cross-device continuity, §5.1), never a prerequisite. `compile()` now only returns `0` if _neither_ a store nor a vault is configured — previously it returned `0` on missing vault alone, silently discarding all synthesis output whenever no vault existed. `upgradeT1Artifacts()` (the desktop T1→T2 vault-upgrade flow, §2.3/§7.2) keeps its own vault requirement — that method is inherently cross-device (it upgrades content another device already pushed to the vault), unlike `compile()`'s same-device local refinement.

---

## 6.8 Background Job Queue

_(Unchanged from v2.0 — Minions pattern, time-boxed execution, exponential backoff)_

---

## 6.9 Skill Instruction Injection (v2.3)

### Purpose

Skills in `@page-agent/memory` work through **prompt engineering, not code execution**. The active skill's `instructionBody` (SKILL.md content) is injected into agent system prompts by `WorkflowExecutor` before any agent runs. The LLM decides what to do based on those instructions; the memory package dispatches no browser actions.

> **Why not ISkillRegistry with `execute` functions?** `@page-agent/memory` runs on three platforms: Chrome extension, Expo mobile, Node.js desktop. A `browser.click()` skill that wraps `RemotePageController` would break mobile and desktop builds — `RemotePageController` is an extension-only API. The deterministic tool execution layer belongs in `MultiPageAgent` (extension), not here. See §5.6.

### Skill Instruction Injection

`WorkflowExecutor` accepts an optional active skill and injects its `instructionBody` into every agent's system prompt at construction time:

```typescript
function buildAgentSystemPrompt(archetype: ArchetypeDefinition, activeSkill?: Skill): string {
    if (!activeSkill) return archetype.systemPrompt
    return `${archetype.systemPrompt}\n\n<active-skill>\n${activeSkill.instructionBody}\n</active-skill>`
}
```

This is transparent to the DAG — no workflow definition changes, no new interfaces. The LLM reads the injected instructions and adjusts its output accordingly.

### Vault Tool Resolution (the one tool call WorkflowExecutor owns)

The TOOLS archetype emits structured `TOOL_CALL:` tokens for vault operations. `WorkflowExecutor` resolves these directly via `IVaultProvider` — no registry, no Zod schemas:

```typescript
// WorkflowExecutor.resolveToolCalls() — called after each agent completes
switch (call.tool) {
    case 'query_wiki':
        result = await vault.queryWiki(call.args.question)
        break
    case 'search_pages':
        result = await vault.searchPages(call.args.query)
        break
    case 'read_page':
        result = await vault.readPage(call.args.slug)
        break
    case 'get_context':
        result = await brain.getContextPack(call.args.prompt)
        break
}
ctx.agentMemory[`tool_result_${call.tool}`] = JSON.stringify(result)
```

Vault tool calls are a memory-layer concern — they call `IVaultProvider` and `IBrainEngine`, both of which are defined and owned by this package. Everything else is the extension's concern.

### Skill Object (SKILL.md format)

The `Skill` type is shared with `packages/extension/src/skills/` (SkillFramework). No `execute` field:

```typescript
interface Skill {
    id: string // UUID (user skills) or 'org.page-agent.*' (built-ins)
    name: string // lowercase, hyphens: 'code-reviewer'
    displayName: string
    description: string // "Use when..." — drives auto-detection in Phase 2
    tags: string[]
    instructionBody: string // Full Markdown instruction text — this is the entire skill
    version: string // semver
    author: string
    isBuiltIn: boolean
}
```

### Always-Present Vault Capability Summary (AGENTS.md pattern)

Following Open Agents' finding that always-present context achieves 100% agent awareness vs 79% for async-loaded discovery, each agent system prompt includes a compact vault capability summary:

```text
AVAILABLE VAULT TOOLS:
  query_wiki(question)   → synthesized answer from vault knowledge
  search_pages(query)    → matching vault artifact list
  read_page(slug)        → full vault artifact markdown
  get_context(prompt)    → token-budgeted context pack

Use: TOOL_CALL: {"tool": "query_wiki", "server": "vault", "args": {"question": "..."}}
```

Browser actions, DOM manipulation, and page extraction are NOT listed here — they are dispatched by the extension layer after the LLM decides to act.

---

## 6.10 IWorkflowPersistence (v2.1 — new)

### Purpose

Decouples `WorkflowExecutor` from its storage strategy. The current implementation accumulates `agentMemory: Record<string, string>` in-process and discards it at session end. `IWorkflowPersistence` makes this pluggable, enabling three deployment profiles:

| Implementation                 | Use case                      | Write latency      | Durability      |
| ------------------------------ | ----------------------------- | ------------------ | --------------- |
| `InMemoryWorkflowPersistence`  | Ephemeral / test              | ~0ms               | Session only    |
| `IndexedDBWorkflowPersistence` | Web extension default         | ~1ms async         | Survives reload |
| `HybridWorkflowPersistence`    | **Default for all platforms** | ~0ms (flush async) | Survives reload |

### Interface

```typescript
interface IWorkflowPersistence {
    // Agent memory — MEMORY[key]: value tokens accumulated across agents
    saveAgentMemory(sessionId: string, memory: Record<string, string>): Promise<void>
    loadAgentMemory(sessionId: string): Promise<Record<string, string>>
    clearAgentMemory(sessionId: string): Promise<void>

    // Workflow results — for session resume and history
    saveWorkflowResult(result: WorkflowResult): Promise<void>
    loadWorkflowHistory(sessionId?: string, limit?: number): Promise<WorkflowResult[]>
    loadWorkflowResult(workflowId: string): Promise<WorkflowResult | null>
}
```

### HybridWorkflowPersistence (default)

Writes to in-memory synchronously. Flushes to IndexedDB asynchronously via `requestIdleCallback` (or `setTimeout(0)` fallback). Reads attempt IndexedDB first, fall back to in-memory.

This matches the "writes succeed immediately, enrichment is async" principle already established for `MemoryService`, and mirrors agents-sample's `useAgent.ts` session resume via IndexedDB — but without blocking the agent on the write.

```typescript
class HybridWorkflowPersistence implements IWorkflowPersistence {
    private readonly memCache = new Map<string, Record<string, string>>()
    private readonly idb: IndexedDBWorkflowPersistence

    async saveAgentMemory(sessionId, memory) {
        this.memCache.set(sessionId, memory) // synchronous, ~0ms
        this.scheduleFlush(() => this.idb.saveAgentMemory(sessionId, memory)) // async
    }

    async loadAgentMemory(sessionId) {
        return (
            this.memCache.get(sessionId) ?? // fast path
            (await this.idb.loadAgentMemory(sessionId))
        ) // cold start / resume
    }
}
```

**Why this matters for desktop:** Desktop users running their own agentic framework (Claude Code, OpenClaw) can swap `IWorkflowPersistence` for a Postgres-backed implementation without changing any agent code. The interface makes the persistence strategy a configuration choice, not an architectural constraint.

---

## 6.11 MCP Vault Integration Layer

_(Unchanged from v2.0 — IVaultProvider interface, MCP tool mapping, supported vault providers)_

---

## 6.12 Vault Connection UI (v2.2 — new)

### Purpose

Allows users to configure which vault provider their mobile/extension instance writes synthesized artifacts to. This is the missing link for §8.3 (Desktop Agent Flow) — both the mobile extension and the desktop IBrainEngine MCP server must point at the same vault for the agent to read what mobile synthesized.

Today, `createWebBrainEngine()` in `factory.ts` always returns `NullVaultProvider`. This UI makes the vault connection user-configurable at runtime.

### Vault Providers

| Provider            | Platform     | Transport                                   |
| ------------------- | ------------ | ------------------------------------------- |
| Obsidian Local REST | Desktop only | `PUT /vault/{path}` with Bearer API key     |
| GitHub              | Any device   | Git Data API — batch commit via 5-step flow |
| Tolaria             | Any device   | Custom MCP endpoint + token                 |

### Configuration Storage

Config follows the same split as the MKDF export spec:

- **`chrome.storage.sync`** — `vaultConfig: { type, endpoint }` — roams across the user's devices
- **`chrome.storage.local`** — `vaultAuthToken` — never synced (credentials stay on device)

### Pending Vault Flush Queue

T1 synthesis artifacts must not block the synthesis pipeline on a live MCP call. Instead:

```text
SynthesisEngine produces artifact
    ↓
addPendingVaultArtifact(artifact)  → chrome.storage.local pendingVaultArtifacts[]
    ↓ (non-blocking)
chrome.alarms: 'flush-vault-artifacts' (every 5 min)
    ↓
flushPendingVaultArtifacts(vaultConfig)
    ├─ optimistic clear (clear before write — prevents double-flush on concurrent alarm)
    ├─ IVaultProvider.writePage(slug, mkdf)
    └─ on failure: restore each artifact individually
```

This is the adapter of the MKDF §4 pending-queue + alarm pattern applied to vault synthesis output.

### Settings UI Surface

The vault settings panel lives in the extension side panel (gear icon → Settings → Vault tab). It mirrors the MKDF §5 overlay pattern:

```
Vault Provider:  [ GitHub ▾ ]

Endpoint:        [ owner/repo           ]  (placeholder adapts per type)
Auth token:      [ ••••••••••••••••     ]

[ Test Connection ]   [ Save ]

Pending: 3 artifacts   [ ↑ Sync now ]
```

The **Sync now** button is shown only when `config.type !== 'none'` and pending count > 0. On popup open, if pending count > 0, auto-flush fires before rendering.

---

## 6.13 Skills System — User-Authored Skills (v2.2)

### Purpose

The Skills system (`packages/extension/src/skills/`) manages **user-authored LLM instruction packages** — the instruction-only path of the unified `SkillDefinition` interface (§6.9). Users create, edit, share, and activate Skills without writing TypeScript.

**Implementation:** `packages/extension/src/skills/` (extension-local — manages storage, UI, and activation; relies on the same `SkillDefinition` type from `@page-agent/memory/src/skills/`)

### Relationship to WorkflowExecutor

User-authored Skills are the `instructionBody` source for WorkflowExecutor's skill injection (§6.9). There is no `ISkillRegistry` in `@page-agent/memory` — the `Skill` type is shared with `packages/extension/src/skills/` (SkillFramework), and Skills are stored in IndexedDB `user_skills`. The extension passes the active skill's `instructionBody` to `IIntelligenceEngine.stream()` via `WorkflowDefinition.activeSkillInstruction`; WorkflowExecutor injects it into agent system prompts.

|                   | User-authored Skills (this section)           | §6.9 Vault tools                      |
| ----------------- | --------------------------------------------- | ------------------------------------- |
| `instructionBody` | ✅ Required — the whole skill                 | Injected as vault capability summary  |
| `execute`         | ❌ Absent — instruction only                  | ❌ Not in memory package              |
| **Storage**       | IndexedDB `user_skills` store (DB v8)         | n/a — resolved via `IVaultProvider`   |
| **Discovery**     | SkillPicker ⚡; keyword auto-detect (Phase 2) | Always-present in agent system prompt |
| **Author**        | User, community, or AI agent                  | `IVaultProvider` interface            |

### Skill Object Schema

```typescript
interface Skill {
    id: string // UUID
    name: string // e.g. "code-reviewer" — lowercase, hyphens
    displayName: string // e.g. "Code Reviewer"
    description: string // "Use when..." — drives auto-detection
    tags: string[]
    instructionBody: string // Full Markdown instruction text
    version: string // semver
    author: string
    isBuiltIn: boolean // prevents deletion
}
```

### Integration with IIntelligenceEngine

**Phase 1 (current) — task-prefix injection:**

```typescript
// In App.tsx, before calling IIntelligenceEngine.stream():
const prompt = activeSkill ? buildSkillTaskPrefix(activeSkill) + userPrompt : userPrompt
intelligenceEngine.stream({ ...workflow, prompt })
```

WorkflowExecutor receives the combined prompt. No DAG changes required — Skill context is transparent to all archetypes.

**Phase 2 (planned) — system-prompt injection:**

A `activeSkillInstruction?: string` field added to `WorkflowDefinition` carries the active Skill's `instructionBody` into `WorkflowExecutor`, which injects it into the system prompt of individual archetypes (SCOUT, LENS, QUILL, FORGE, WEAVE) via `buildAgentSystemPrompt()` rather than prepending to the task string. This is the correct injection point — system prompts, not task strings.

### SKILL.md Export (cross-tool portability)

Skills export as standard SKILL.md files, compatible with VS Code Copilot, Claude Code, Cursor, and Codex CLI:

```markdown
---
name: code-reviewer
description: Use when reviewing code for correctness, style, or security issues.
version: 2.0.0
author: user
tags: [coding, review]
---

You are a senior software engineer...
```

### 5 Built-in Skills (synthetic interrogation pattern)

| Skill            | Input tag     | Interrogation dimensions                                                                         |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `summarizer`     | `<inputText>` | Theme, supporting ideas, evidence, author purpose, implications                                  |
| `code-reviewer`  | `<code>`      | Correctness, security, robustness, concurrency, maintainability                                  |
| `explain-simply` | `<topic>`     | Core mechanism, analogy, misconceptions, why it matters, 12-year-old test                        |
| `rewriter`       | `<original>`  | Clarity, tone drift, structure, concision, factual fidelity                                      |
| `brainstormer`   | `<challenge>` | Assumption inversions, constraint relaxation, cross-domain analogs, perspective shifts, extremes |

All five built-ins use the **synthetic interrogation** pattern: generate N diagnostic questions spanning enumerated dimensions, answer each before producing output. This forces depth before generation.

---

# 7. Mobile vs Desktop Architecture

## 7.1 Mobile / Web Runtime

### Strategic Role

Mobile is a **fully self-sufficient cognitive node**, not a thin client. It captures, synthesizes, and queries without requiring a desktop. It acts as working memory for the user's current context and lightweight long-term memory via the vault.

### Responsibilities

- Real-time episodic event capture
- T0 entity extraction (zero cost)
- T1 lightweight synthesis → push to vault
- Semantic recall from local index + vault
- Working memory management (session context)
- `IIntelligenceEngine` — agent personas, DAG workflows, skill instruction injection
- SKILL.md instruction injection — `instructionBody` → agent system prompts
- `IWorkflowPersistence` — Hybrid (in-memory + IndexedDB) default
- Skills system (`packages/extension/src/skills/`) — user-authored LLM instruction packages, SKILL.md export
- Vault Connection UI — settings panel + pending flush queue (§6.12)
- Background job queue (in-memory, time-boxed)
- MCP vault reads for deep queries

### Technology Stack

| Component            | Technology                                                                                                                                   | Source Pattern              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Language             | TypeScript                                                                                                                                   | —                           |
| Storage              | SQLite (native) / IndexedDB (web)                                                                                                            | GA / Smriti                 |
| LLM                  | MLC WebGPU / Ollama small model                                                                                                              | Smriti T1                   |
| Embeddings           | Platform-specific, not unified: 384-dim web (Transformers.js MiniLM-L6-v2) / 768-dim native (llama.rn nomic-embed-text-v1.5, ported from GA) | Smriti + GA                 |
| Hybrid search        | Orama (vector + BM25 + RRF)                                                                                                                  | GA                          |
| Working memory       | Token-budget-aware, 4096t default                                                                                                            | GA                          |
| Memory interfaces    | IBrainEngine (= IMemoryService impl)                                                                                                         | GA + v2.1                   |
| Agent framework      | Nemilia-pattern (8 archetypes, DAG)                                                                                                          | Nemilia v2.2                |
| Streaming LLM loop   | AI SDK pattern, NDJSON to client                                                                                                             | Open Agents v2.1            |
| Skill injection      | SKILL.md instructionBody → agent system prompts                                                                                              | SkillFramework v2.0         |
| Skills system        | SKILL.md + IndexedDB `user_skills` store                                                                                                     | SkillFramework v2.0 (§6.13) |
| Workflow persistence | HybridWorkflowPersistence                                                                                                                    | v2.1                        |
| Vault access         | IVaultProvider via MCP                                                                                                                       | LLM-Wiki-Compiler           |
|                      |

---

## 7.2 Desktop Runtime

### Strategic Role

Desktop acts as the **synthesis powerhouse and knowledge ingestion hub**, AND as a **passive MCP memory server** for external agent platforms. No `IIntelligenceEngine` is instantiated on desktop — external agents (Claude Code, OpenClaw, Hermes) supply the intelligence.

### Unique Capabilities vs Mobile

- **T2 full synthesis** — re-synthesizes T1 vault artifacts to higher quality
- **Source ingestion** — PDFs, URLs, files, session exports, email, calendar
- **Deep graph reasoning** — Neo4j/Memgraph traversal, community detection, impact analysis
- **Durable job queue** — Postgres-native Minions, survives restarts
- **IBrainEngine as MCP server** — external agent platforms plug in via MCP and gain brain-first memory lookup
- No `IIntelligenceEngine` — the external agent platform IS the intelligence

### Technology Stack

| Component       | Technology                                | Source Pattern    |
| --------------- | ----------------------------------------- | ----------------- |
| Language        | TypeScript (Node.js)                      | —                 |
| Primary DB      | PGLite (local) / Postgres (shared)        | GBrain            |
| Vector search   | pgvector + BM25 + RRF                     | GBrain            |
| Graph           | Neo4j / Memgraph (typed edges)            | GBrain            |
| LLM             | Local (llama.cpp / vLLM) or cloud         | GBrain            |
| Embeddings      | Voyage / OpenAI / local                   | GBrain            |
| Job queue       | Postgres-native Minions                   | GBrain            |
| Synthesis       | LLM-Wiki-Compiler pipeline                | LLMWiki           |
| MCP server      | IBrainEngine exposed as MCP tools         | v2.1              |
| Agent framework | External: OpenClaw / Hermes / Claude Code | GBrain            |
| Vault access    | IVaultProvider via MCP                    | LLM-Wiki-Compiler |

---

# 8. Agent Framework Integration

## 8.1 The Agent-Memory Contract

Agents at all tiers interact with `IBrainEngine` through the same interface. The difference is what is available underneath.

```typescript
// Agent receives this context object — identical on mobile and desktop
interface AgentMemoryContext {
    workingMemory: MemoryEntry[] // Session-scoped, token-budgeted
    vaultContext: ContextPack // From MCP: top-ranked artifacts + graph neighbors
    localRecall: MemorySearchPage // From IBrainEngine.search(): recent + semantic matches
    brainEngine: Pick<
        IBrainEngine, // Write-back
        'store' | 'getContextPack'
    >
    vaultProvider: Pick<
        IVaultProvider, // Vault tool calls (TOOLS archetype)
        'readPage' | 'searchPages' | 'queryWiki'
    >
    activeSkillInstruction?: string // instructionBody of the active SKILL.md — injected into system prompts
    persistence: IWorkflowPersistence // Session memory read/write
}
// Note: no ISkillRegistry — deterministic tool execution (browser, DOM) belongs in the
// extension's MultiPageAgent layer, which owns RemotePageController.
```

## 8.2 Mobile Agent Flow (Nemilia Pattern)

````text
User message
    ↓
IIntelligenceEngine.stream(workflow)
    ↓
WorkflowExecutor.buildDagGroups(agentIds, dagStages)
    ↓
Stage 1 parallel: [NEXUS web search] (if enabled)
Stage 2 parallel: [SCOUT local recall] [LENS analysis]
    ├─ Each agent receives: task + priorSummary + memCtx + vaultCtx + searchCtx
    ├─ Vault TOOL_CALL tokens → IVaultProvider (query_wiki, search_pages, read_page)
    ├─ Agents write MEMORY[key]: value → T0 extraction → IWorkflowPersistence
    ├─ Streaming: each token emitted as WorkflowStreamEvent
    └─ If validate: score output 0-10, retry with feedback if below threshold
Stage 3: [WEAVE synthesis] ← orchestrator final report
    ↓
Extract visuals (```chart, ```svg, ```html blocks)
    ↓
Auto-save result to IWorkflowPersistence + trigger synthesis job
````

## 8.3 Desktop Agent Flow (OpenClaw / Hermes / Claude Code Compatible)

```text
External agent platform (OpenClaw / Hermes / Claude Code)
    ↓  MCP (OAuth 2.1)
IBrainEngine (MCP server exposed by desktop runtime)
    ├─ search → pgvector + BM25 + graph signal boost
    ├─ think  → T2 synthesis layer answer
    ├─ ingest_source → add new source → schedule synthesis job
    └─ get_context_pack → ContextPack for agent context window
    ↓
Minions job queue schedules background enrichment
    ├─ T2 synthesis compile
    ├─ Graph recluster
    └─ Vault sync (push compiled artifacts)
```

**Any MCP-aware agent platform works without modification.** Install the MCP config pointing at the desktop IBrainEngine server, and the agent immediately gains brain-first memory lookup on all queries.

### Prerequisites for §8.3 to work end-to-end

Both mobile and desktop must point at the **same vault**. This requires:

1. **Mobile/extension**: Vault Connection UI (§6.12) configured with the vault provider and credentials
2. **Desktop**: `DesktopBrainEngine` MCP server configured to read/write the same vault
3. **Vault flush queue**: Mobile's pending T1 artifacts flushed via `chrome.alarms` before the desktop agent queries them

Without §6.12 (today's gap — `factory.ts` always returns `NullVaultProvider`), the desktop agent only sees artifacts it produced itself, not mobile's T1 output.

## 8.4 Cross-Tier Agent Handoff

_(Unchanged from v2.0 — T1 → T2 vault upgrade flow)_

## 8.5 Skill Instruction + Vault Tool Flow

**Skill instruction injection (before agents run):**

```text
User message + active SKILL.md
    ↓
WorkflowExecutor.buildAgentSystemPrompt(archetype, activeSkill)
    ↓ injects instructionBody into each agent's system prompt
Agents run with skill context already present — no runtime dispatch needed
```

**Vault tool resolution (after each agent completes):**

```text
TOOLS archetype LLM output contains:
  TOOL_CALL: {"tool": "query_wiki", "server": "vault", "args": {"question": "..."}}
    ↓
WorkflowExecutor.resolveToolCalls()
    ├─ vault.queryWiki(question)    → stores result in agentMemory
    ├─ vault.searchPages(query)     → stores result in agentMemory
    ├─ brain.getContextPack(prompt) → stores result in agentMemory
    └─ Emit as WorkflowStreamEvent.tool_result
```

**Browser/DOM actions (extension layer only — not in @page-agent/memory):**

```text
LLM output (informed by injected skill instructions) → extension reads response
    ↓
MultiPageAgent (extension) dispatches:
    RemotePageController.clickElement(index)
    RemotePageController.inputText(index, text)
    RemotePageController.scroll(...)
```

`@page-agent/memory` has no visibility into or responsibility for this third flow. The boundary is clean: memory package handles memory and vault; extension handles browser.

## 8.6 Prospective Memory (Time + Topic Triggered)

_(Unchanged from v2.0 — Einstein-McDaniel dual-pathway model)_

---

# 9. Memory Lifecycle Management

_(Unchanged from v2.0 — lifecycle states, retention policies, self-managing hierarchies)_

---

# 10. Synchronization Strategy

_(Unchanged from v2.0 — vault as sync point, raw memory stays local, multi-source federation)_

---

# 11. Security and Privacy

_(Unchanged from v2.0 — local-first, encrypted sync, OAuth 2.1, audit log)_

---

# 12. Non-Functional Requirements

| Requirement                    | Goal                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Offline operation              | Required — T1 synthesis must work disconnected                                                                       |
| Mobile self-sufficiency        | Required — no desktop dependency                                                                                     |
| Local-first                    | Required                                                                                                             |
| Cross-platform                 | Required                                                                                                             |
| Pluggable memory engines       | Required — IBrainEngine / IMemoryStore / IMemoryIndex                                                                |
| Pluggable vault providers      | Required — IVaultProvider / MCP                                                                                      |
| Pluggable LLM (T0–T3)          | Required                                                                                                             |
| Pluggable workflow persistence | Required — IWorkflowPersistence                                                                                      |
| Human-readable artifacts       | Required — Markdown with YAML frontmatter                                                                            |
| Explainable synthesis          | Required — paragraph + claim-level provenance                                                                        |
| Tiered synthesis quality       | Required — T1 mobile, T2 desktop, upgradeable                                                                        |
| Agent framework compatible     | Required — Nemilia (mobile), OpenClaw/Hermes (desktop)                                                               |
| Streaming agent output         | Required — WorkflowStreamEvent per token (v2.1)                                                                      |
| Skill instruction injection    | Required — active SKILL.md instructionBody injected into agent system prompts                                        |
| SKILL.md portability           | Required — Skills export as SKILL.md for cross-tool compatibility (VS Code Copilot, Claude Code, Cursor)             |
| Browser/memory boundary        | Required — `@page-agent/memory` must never import `@page-agent/page-controller`; browser dispatch stays in extension |
| Vault connection UI            | Required — users configure vault provider on mobile for Desktop Agent Flow (§8.3)                                    |
| Low coupling                   | Required                                                                                                             |
| Provider portability           | Required                                                                                                             |

---

# 13. Monorepo Placement

## 13.1 Package: `@page-agent/memory` (existing, extended in v2.1)

```
packages/memory/
├── src/
│   ├── interfaces/
│   │   ├── IBrainEngine.ts             ← NEW v2.1: unified interface across platforms
│   │   ├── IIntelligenceEngine.ts      ← NEW v2.1: web/mobile only
│   │   ├── ISkillRegistry.ts          ← REMOVED in v2.3 (deterministic execution belongs in extension)
│   │   ├── IWorkflowPersistence.ts     ← NEW v2.1
│   │   ├── IMemoryService.ts           (existing, becomes IBrainEngine impl)
│   │   ├── IMemoryStore.ts
│   │   ├── IMemoryIndex.ts
│   │   └── IVaultProvider.ts
│   │
│   ├── core/
│   │   ├── MemoryService.ts            (implements IBrainEngine for web/mobile)
│   │   ├── pipeline/
│   │   ├── synthesis/
│   │   ├── graph/
│   │   └── working/
│   │
│   ├── agents/
│   │   ├── archetypes/
│   │   └── WorkflowExecutor.ts         (updated: SKILL.md injection, IVaultProvider dispatch, IWorkflowPersistence, streaming)
│   │
│   │   NOTE: ISkillRegistry.ts and skills/impl/ were removed in v2.3.
│   │   Deterministic tool execution (browser, DOM) belongs in packages/extension/src/agent/
│   │   (MultiPageAgent → RemotePageController). Skill types shared via SkillFramework in
│   │   packages/extension/src/skills/. No skill registry lives in @page-agent/memory.
│   │
│   ├── persistence/                    ← NEW v2.1
│   │   ├── InMemoryWorkflowPersistence.ts
│   │   ├── IndexedDBWorkflowPersistence.ts
│   │   └── HybridWorkflowPersistence.ts
│   │
│   ├── adapters/
│   │   ├── web/
│   │   ├── mobile/
│   │   └── desktop/
│   │
│   ├── vault/
│   ├── jobs/
│   └── index.ts
```

## 13.2 Subpath Exports (v2.1)

```json
{
    "name": "@page-agent/memory",
    "exports": {
        ".": "./src/index.ts",
        "./interfaces": "./src/interfaces/index.ts",
        "./adapters/web": "./src/adapters/web/index.ts",
        "./adapters/mobile": "./src/adapters/mobile/index.ts",
        "./adapters/desktop": "./src/adapters/desktop/index.ts",
        "./vault": "./src/vault/index.ts",
        "./agents": "./src/agents/index.ts",
        "./agents/actions": "./src/agents/actions/index.ts",
        "./persistence": "./src/persistence/index.ts"
    }
}
```

## 13.3 Dependency Rules (v2.1)

```
packages/memory/core           → no dependencies on page-agent ecosystem
packages/memory/adapters/*     → platform-specific deps only (idb, better-sqlite3, pg)
packages/memory/vault          → @modelcontextprotocol/sdk only
packages/memory/persistence    → idb (web/mobile), no desktop deps
packages/memory/agents         → @page-agent/llms, @page-agent/memory/core,
                                  @page-agent/memory/persistence
                                  NEVER → @page-agent/page-controller (browser/DOM is extension-only)

packages/extension             → @page-agent/memory, @page-agent/memory/adapters/web,
                                  @page-agent/memory/persistence
                                  (Skills system: packages/extension/src/skills/ — extension-local)
                                  (Browser dispatch: MultiPageAgent → RemotePageController)
packages/website               → @page-agent/memory, @page-agent/memory/adapters/web

packages/core (browser automation) ← zero cross-dependency with packages/memory
```

---

# 14. Implementation Phases (v2.1)

## Phase 1 — Foundational Cognition ✅ _Implemented_

- `IMemoryService` / `IMemoryStore` / `IMemoryIndex` interfaces
- Episodic memory with L0→L1 hierarchy
- IndexedDB (web) storage adapter
- T0 entity extraction and salience computation
- T1 lightweight synthesis
- Orama hybrid search (vector + BM25 + RRF)
- Working memory with token budgets
- `IVaultProvider` interface + MCP adapter (`MCPVaultClient`, `NullVaultProvider`)
- 8 Nemilia agent archetypes + `WorkflowExecutor` (DAG execution, MEMORY token extraction, output validation)
- In-memory job queue

## Phase 2 — Unified BrainEngine + Skill Injection _(next)_

- **`IBrainEngine` interface** — extract from `IMemoryService`, add `think()`, `synthesize()`, `getContextPack()`
- **`IIntelligenceEngine` interface** — wrap `WorkflowExecutor`, expose `stream()`
- **`WorkflowStreamEvent`** — replace blocking `execute()` with streaming loop (AI SDK pattern)
- **`IWorkflowPersistence`** — `InMemoryWorkflowPersistence`, `IndexedDBWorkflowPersistence`, `HybridWorkflowPersistence`
- **Update `WorkflowExecutor`** — replace `TOOL_CALL:` regex with direct `IVaultProvider` dispatch; use `IWorkflowPersistence` for `agentMemory`; inject active skill `instructionBody` into agent system prompts
- **Remove `IActionRegistry` / `ActionRegistry`** from `packages/memory/src/` — this code exists today and must be deleted (boundary violation: wraps `RemotePageController` in a platform-agnostic package)
- **Remove `skills/impl/browser.ts`** — extension-only code that must not live in `@page-agent/memory`
- **Always-present vault capability summary** — inject vault tool descriptions into every agent system prompt at construction time
- **OKF-compatible `PageFrontmatter`** — add `type`, `resource`, `timestamp` fields (§5.5) (done for OKF v0.1; the v0.2 update of the file writer was done on 2026-10-08, see §5.5)
- **Vault Connection UI** — settings panel + pending flush queue + `chrome.alarms` timer (§6.12)
- LLM-Wiki-Compiler pipeline adapted as Synthesis Engine
- Two-phase compile (concept extraction → page rendering)
- SHA-256 incremental processing
- Provenance tracking (paragraph + claim level)
- Synthesis quality metadata (`synthesisQuality: T1 | T2`)
- Cross-source concept merging
- Vault MCP push/pull

## Phase 3 — Structural Cognition

- Desktop `DesktopBrainEngine` (Postgres + pgvector + Neo4j)
- `IBrainEngine` exposed as MCP server
- Knowledge graph (typed edges, self-wiring, 3-pass building)
- Minions job queue (Postgres-native, durable)
- 9-phase maintenance cycle
- T2 synthesis on desktop
- T1 → T2 upgrade detection and scheduling
- Source ingestion (PDF, URL, files)
- OpenClaw / Hermes integration

## Phase 4 — Hierarchical Cognition

- 7 forgetting / retention policies (Smriti)
- Memory compression layers
- Advanced graph reasoning (community detection, impact analysis)
- Adaptive retrieval (intent-based weight tuning)
- Prospective memory (time + topic triggered)
- Cross-device synthesis quality upgrades
- Obsidian vault adapter
- Executive summary generation

## Phase 5 — Autonomous Cognition

- Proactive synthesis agents (detect knowledge gaps)
- Organizational monitoring and conflict detection
- Risk analysis and dependency mapping
- Autonomous synthesis refinement
- Multi-user vault federation
- Enterprise deployment (air-gapped, encrypted)

---

# 15. Final Architectural Position

The platform is designed as:

```text
A Cognitive Operating System
```

not a chatbot, RAG application, vector database wrapper, or note-taking application.

The architecture separates cognition (IIntelligenceEngine), memory (IBrainEngine), synthesis (SynthesisEngine), retrieval (IMemoryIndex), storage (IMemoryStore), skill instruction injection (SKILL.md), workflow persistence (IWorkflowPersistence), representation, and orchestration into independently evolvable layers connected through stable capability interfaces.

**Key design commitments (v2.3):**

1. **IBrainEngine is the universal layer** — same interface on web, mobile, desktop; same method signatures regardless of whether the backend is IndexedDB or Postgres
2. **IIntelligenceEngine is web/mobile only** — desktop intelligence comes from external agent platforms (Claude Code, OpenClaw) via MCP; we do not replicate that on desktop
3. **`@page-agent/memory` never imports `@page-agent/page-controller`** — browser and DOM operations belong in the extension's `MultiPageAgent` layer, which owns `RemotePageController`. The memory package is platform-agnostic; adding extension-only `execute` functions to it would break mobile and desktop builds. Skill integration in the memory package is SKILL.md instruction injection only.
4. **Streaming by default for interactive workflows** — `IIntelligenceEngine.stream()` emits per-token events; users see agent reasoning as it happens
5. **Pluggable workflow persistence** — `IWorkflowPersistence` with `HybridWorkflowPersistence` as default; desktop users can swap to Postgres without changing agent code
6. **Skills augment agent behaviour through prompt engineering** — SKILL.md `instructionBody` is injected into agent system prompts by `WorkflowExecutor`. The LLM decides what to do; `MultiPageAgent` in the extension dispatches the resulting browser actions. Skills export as SKILL.md for cross-tool portability (VS Code Copilot, Claude Code, Cursor). Vault operations (query_wiki, search_pages) are resolved directly via `IVaultProvider` — no registry.
7. **Mobile is a full cognitive node, not a thin client**
8. **The vault is the only sync point** — raw episodic memory stays local
9. **Synthesis quality improves automatically** as desktop is used (Option C — T1 → T2 upgrade)
10. **MCP is the vault and desktop memory protocol** — vault provider is user's choice

The ultimate goal:

```text
Persistent, explainable, modular machine cognition
```

capable of operating continuously across devices, environments, organizations, workflows, and time — starting from a browser tab on a phone, growing richer as more infrastructure is added, and never losing what the user has learned.

---

# 15A. GA→CB Migration Addendum (post-2026-06-05, not reflected above)

_(Numbered 15A rather than 16 to avoid renumbering every cross-reference into §16-19 elsewhere in this document — this was a duplicate `# 15` header prior to the 2026-09-22 consolidation pass, §2.15.)_

The Expo-app cutover described in `docs/Misc/implementGAtoCBMigrationPlan.md` (decision: Option B, full port) completed 2026-06-05 and moved substantial GuideAxon App Memory (GA) logic into this package's `memory/src/core/`. None of the sections above were updated to describe it. This addendum lists what actually exists in code today that the rest of this document is silent on:

**Ported and now living under `memory/src/core/`:**

- `goals/GoalManager.ts` — goal CRUD, `closeGoal()` outcome recording, persisted as `MemoryEntry` with `type: 'goal'` (not MMKV as in the original GA implementation)
- `pipeline/processors/ProcedureLearningProcessor.ts` + `ProcedureEvolutionProcessor.ts` — the SMRITI-style 4-stage procedure promotion ladder (`candidate → experimental → active → stable`), registered in `Pipeline` alongside the T0/T1 fast path
- `pipeline/processors/DecayProcessor.ts` — importance-based numeric decay, a separate concern from `MaintenanceCycle`'s retention policies
- `wiki/WikiIngestionJob.ts` + `WikiRetriever.ts` — Adamic-Adar edge inference and BFS wikilink traversal; no equivalent existed in CB before the port
- `audit/MutationLogStore.ts` + `.native.ts` — mutation audit trail, additive (CB had none)

**Embedding dimensions**: see the corrected Technology Stack row above — this document previously stated a single "384-dim" figure; native is actually 768-dim (ported from GA's `HybridMemoryIndex`), and the two are not unified.

**Vector search**: `adapters/web/OramaIndex.ts` already has real vector-embedding support (constructor-injected `EmbeddingFunction`, `vector` field, semantic search mode) — this is not aspirational, it is Phase 2.1 of the migration plan, already implemented.

**Mobile storage**: `adapters/mobile/index.ts` now exports a real `SQLiteStore` (op-sqlite, FTS5, composite cursor pagination) ported from GA's `MemoryStore.native.ts` — this replaced what was previously a one-line stub re-exporting the web adapter.

**Naming**: the migration plan mandated renaming GA's pipeline-stage T0/T1/T2 labels to `PipelineTier.RuleBased`/`Lightweight`/`Full` specifically to avoid colliding with this document's own T1/T2 _LLM quality tier_ terminology (§7.1 tech stack, "MLC WebGPU / Ollama small model", "T1 LLM" / "T2 LLM" throughout). If you are reading code in `pipeline/processors/` and see "T1"/"T2" in a comment, check which meaning is intended — the two concepts are deliberately orthogonal despite the shared prefix.

**What is still accurate above despite the gap**: the `IVaultProvider`/MCP-outbound-only framing (§8.3, Phase 1 vault bullet), the `IBrainEngine`/`IIntelligenceEngine` layering, and the three-tier (mobile/desktop/vault) model are all still correct — the migration extended the memory core, it did not change these higher-level contracts.

---

# 16. Supermemory Comparison — Recommended Enhancements (2026-09-22)

> **Status: §16.1–§16.3 implemented (2026-09-22); §16.4 deprecated, superseded by §16.8 (2026-09-23); §16.5–§16.6 still proposed.** This section exists because a competitive comparison against [supermemory.ai/product](https://supermemory.ai/product/) — a hosted graph-based memory API — surfaced five concrete areas where GuideAxon's memory system (documented in `docs/Memory/designMemory.md`, and at the platform level here) is behind, alongside two areas where it is already ahead by design (type-system depth, procedural/prospective memory). §16.4 (fact-level graph edges), §16.5 (ingestion connectors), and §16.6 (API/agent integration parity) remain **recommendations to build**, not claims about current code — treat those three the same way §14's un-checked Phase items are treated.
>
> **§16.1–§16.3 implementation note:** built directly in `packages/cognitive-brain/memory/src/` (the real, currently-wired codebase — not the pluggable-but-unregistered `ImportanceProcessor` this section originally pointed at). Landed in:
>
> - `types.ts` — `isDurable`/`expiresAt` on `MemoryEntry`; `'extends'` added to `EdgeType`
> - `core/pipeline/processors/T0DurabilityClassifier.ts` — new, rule-based (T0), wired into `Pipeline.processEntry` alongside entity extraction
> - `core/pipeline/processors/ContradictionResolutionProcessor.ts` — new; implements the `same`/`updates`/`extends` classification and version-chain writes described in §16.2 below
> - `core/pipeline/processors/T0SalienceProcessor.ts` — `reinforcement_boost` term added to `computeSalience()`
> - `core/MemoryService.ts` — registers the new processor via `Pipeline.registerProcessor()` (an existing extension point that had no caller before this) and supplies a `ProcessorContext.llmService` adapter over the T1 LLM
> - `core/context/ContextBuilder.ts` — `filterMemories()` now excludes entries superseded via a `child` relation
> - `adapters/mobile/SQLiteStore.ts` — added `is_durable`/`expires_at` columns (with an `ALTER TABLE`-based migration) so the new fields actually persist on native, not just on web's schemaless IndexedDB store
>
> One design deviation from the original write-up: `extends` is a first-class `EdgeType` rather than `related_to` + `metadata.relationKind: 'extends'` — simpler, and `EdgeType` was already designed as an extensible union.
>
> Two of the five gaps below (contradiction resolution, cross-memory inference) were already self-identified as deferred gaps in `docs/Memory/designMemory.md` V3 — this section is not new discovery there, it's confirmation plus a concrete design for closing them.
>
> **Correction (2026-09-22, post-code-review):** §16.1 and §16.2 originally proposed a `behaviorClass: 'fact' | 'preference' | 'episode'` enum and a `contradicts`-relation-plus-`metadata.supersededBy` mechanism, modeled on Supermemory's _marketing_ description. A direct read of Supermemory's own open-source code (`packages/memory-graph/src/api-types.ts` in `supermemoryai/supermemory` — the real `MemoryEntry` backend schema their own graph-visualization package consumes) shows their actual mechanism is different from, and simpler than, the marketing copy implies: there is **no fact/preference/episode enum anywhere in their schema.** What exists is two orthogonal fields (`isStatic: boolean`, `forgetAfter?: string`) plus an explicit version chain (`parentMemoryId`, `rootMemoryId`, `version`, `isLatest`) and a `relation: 'updates' | 'extends' | 'derives'` field. "Facts/Preferences/Episodes" is a user-facing description of _emergent behavior_ from those mechanics, not a mechanism itself — and their "preferences strengthen with repetition" claim has no corresponding field in the public schema at all, so it's either buried in their closed-source scoring or aspirational copy. §16.1 and §16.2 below have been revised to match the more composable, code-verified model instead of the enum-based marketing description.

## 16.1 Durability & Expiry Fields (replaces the earlier `behaviorClass` enum proposal)

**Why:** A fixed three-way `fact | preference | episode` enum (the original proposal here) forces awkward boundary calls the moment real data shows up — "prefers window seats when flying" is a preference by intuition but should decay like an ordinary fact if the user never repeats it; a `goal`-linked episodic entry might be both time-bound _and_ worth keeping past its expiry as history. Supermemory's actual schema (not its docs) avoids this by using two independent, composable fields instead of one categorical tag — that turns out to be the better model to copy.

**Design:** Add to `MemoryEntry`:

```typescript
isDurable?: boolean;   // persists until explicitly superseded (Supermemory's isStatic)
expiresAt?: string;    // ISO timestamp — entry is time-bound, decays/forgotten after this point
```

Both are orthogonal to `type` (compression tier) and to `importance`/`salience`. A raw L0 entry and its derived L1/L2 descendants can each set these independently — a durable fact extracted from a non-durable episodic conversation turn is the common case, not the exception.

**Where it's computed:** Extend `ImportanceProcessor`'s existing LLM call to also return `isDurable` and an optional `expiresAt` as additional structured fields — one round trip, not a new processor. A T0 keyword/date-pattern fallback (explicit dates, "tomorrow"/"this week" phrasing → set `expiresAt`; declarative "is"/"works at"/"prefers" phrasing → `isDurable: true`) covers the no-LLM-adapter case, matching the graceful-degradation pattern already used elsewhere in the pipeline.

**Reuse, don't duplicate:** GuideAxon's prospective memory (`designMemory.md` §9.1) already has a `fireAt` field on `ProspectiveTrigger` for time-based triggers. `expiresAt` here is a distinct concept (when an ordinary memory stops being current) — the two should not be merged — but both being ISO-timestamp fields on `MemoryEntry`-adjacent structures should use the same date-handling utility rather than duplicating parsing logic.

**Why this matters:** `isDurable` becomes the gate for §16.2 below — only durable entries are candidates for contradiction resolution; non-durable (episodic/expiring) entries fall through to the existing `DecayProcessor`/pruning path unchanged.

## 16.2 ContradictionResolutionProcessor (write-time fact supersession via version chain)

**Why:** This is the sharpest documented gap. Supermemory's `updates` relation supersedes a fact at write time, guaranteeing a single current answer to "what do I currently believe about X," using an explicit version chain (`parentMemoryId`/`rootMemoryId`/`version`/`isLatest`) rather than a same-level peer relation. GuideAxon's `contradicts` relation type exists in the schema but — per `designMemory.md` V3's own "deferred gaps" list — no processor acts on it, and (per the correction above) a peer `contradicts` relation plus a `metadata.supersededBy` flag would have been a second, parallel versioning mechanism alongside the `parent`/`child` chain GuideAxon already built and already uses for procedure versioning (`designMemory.md` §7). Two ways to express "this superseded that" in one codebase is exactly the kind of inconsistency that produced the V2 `docToEntry()` field-loss bug (`designMemory.md` §1, Bug 2) — two code paths disagreeing about what a "complete" entry looks like.

**Design:**

- **Gate:** `shouldProcess` = `isDurable === true` (§16.1) and entity extraction has already resolved a subject for the entry.
- **Matching:** search existing durable entries sharing the same linked entity via `HybridMemoryIndex`.
- **Classification:** when a candidate covers the same subject+attribute with a different value, ask the LLM to classify the relationship as `updates` (conflicting) or `extends` (additive) — matching Supermemory's own two relation types by name, not just concept — gated at confidence ≥ 0.7, the same threshold already used for procedure-patch validation (`designMemory.md` §7), for consistency across the codebase.
- **On `updates`:** create a new entry as a `child` of the superseded one (reusing the existing `parent`/`child` relation, the same version-chain mechanism `ProcedureEvolutionProcessor` already uses — one versioning code path shared by facts and procedures, not two). Never delete the old entry — the chain itself is the audit trail, and the existing mutation log (`designMemory.md` §3) records the transition on top of it, no new audit mechanism needed.
- **On `extends`:** add a `related_to` relation with `metadata: { relationKind: 'extends' }` between the two entries. This is the branch the original proposal had nowhere to write — without an `extends` relation, the LLM's non-conflicting classification result would have had no schema-level home, silently discarding the enrichment. See the `MemoryRelation` extension below.
- **Read-side fix (easy to miss):** `ContextBuilder`/`buildContextForQuery` (`designMemory.md` §9.4) must resolve to the newest node in a `parent`/`child` chain (`isLatest`-equivalent: no entry exists that names this one as `parent`) rather than returning every version. Write-time supersession alone does nothing for retrieval unless the read path also walks the chain.

**`MemoryRelation` extension required:** add `'extends'` alongside the existing `'derived_from' | 'summarizes' | 'contradicts' | 'related_to' | 'parent' | 'child'` union (`designMemory.md` core types). Current mapping against Supermemory's three relation types:

| Supermemory | GuideAxon                                                 | Status                                                   |
| ----------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `derives`   | `derived_from`                                            | Already supported — `InsightProcessor` writes this today |
| `updates`   | `parent`/`child` (reused from procedure versioning)       | Proposed here, not yet implemented                       |
| `extends`   | _(new)_ `related_to` + `metadata.relationKind: 'extends'` | Proposed here — genuine gap, no prior equivalent         |

**Pipeline position:** after `SalienceProcessor`/`EntityExtractionProcessor` (needs resolved entities to match on), before `SummarizationProcessor`.

## 16.3 Preference Reinforcement (repetition-based salience boost)

**Why:** Supermemory's docs claim preference-like memories "strengthen with repetition," though (per the correction above) no field in their actual schema demonstrates this — it may be internal to their closed-source scoring. GuideAxon's V3 salience formula already has a `retrieval_boost` component (rewarding memories that are _recalled_), but nothing rewards a memory being _restated_ by the user — a different, complementary signal worth having regardless of whether Supermemory's version is real or aspirational.

**Design:**

- Add `metadata.restatementCount`, distinct from the existing `retrievalCount`.
- A lightweight step gated on `isDurable === true` and no `expiresAt` (§16.1 — i.e., the entries most like a "standing preference") checks semantic similarity against existing such entries; a near-duplicate increments `restatementCount` on the existing entry instead of creating a new one.
- Extend the salience formula (`designMemory.md` §9.2) with a fifth-ish term: `reinforcement_boost = min(restatementCount × 0.02, 0.15)` — additive and capped, same shape as the existing `retrieval_boost`, no formula redesign required.

**Pipeline position:** same stage as §16.2.

## 16.4 Fact-Level Graph Edges (typed relations, not a new graph store) — **DEPRECATED, see §16.8**

> **Status: deprecated 2026-09-23, superseded by §16.8.** This proposal — extending `MemoryRelation` with typed predicate edges between existing entity nodes, no new graph store — was evaluated against two alternatives (Supermemory's schema, Lumen-Labs/brainapi2's event-centric model) from a long-term, pre-production perspective (i.e. not weighted toward what GuideAxon already has built). It lost on representational ceiling: a flat subject-predicate-object edge has nowhere to attach an event's own timestamp, context, or confidence independent of the two entities it connects, and this document's own provenance goal (`designMemory.md` §3, paragraph+claim-level provenance) needs exactly that. It also **inherits the flat-edge design's already-acknowledged non-scaling trade-off** (`getEdgesTo()` stays a full scan) without buying back any of the richer reasoning an event-hub model provides in exchange for that cost. Kept below, unmodified, as the historical record of what was proposed and why it was rejected — do not implement this section. See §16.8 for the design that replaced it.

**Why:** Supermemory's graph operations (`update`/`extend`/`derive`) work over facts — it can infer an unstated fact by traversing typed relationships. GuideAxon's graph (`designMemory.md` §6, §8) is more structurally elaborate (Adamic-Adar weighting, versioned wiki pages, slug immutability) but is scoped to entity co-occurrence and wiki-page linking — it has no subject-predicate-object triple structure, so it cannot answer "what is Google's relationship to me" by traversal, and has no `derive` capability at all.

**Design:** do **not** build a second graph system — that would repeat the mistake the wiki design explicitly avoided (`designMemory.md` §8, "Architecture Decision: No Separate GraphStore"). Instead, extend the existing `MemoryRelation` model with typed predicate edges between two `entity` MemoryEntries (or a durable entry, §16.1, and an entity) — e.g. `{ type: 'related_to', metadata: { predicate: 'works_at' } }`. A `derive` capability becomes: walk two typed edges (A --works_at--> B, B --owned_by--> C) and propose a candidate third fact (A --works_at_subsidiary_of--> C) for LLM confirmation, gated by the same confidence-threshold pattern used elsewhere.

**Trade-off carried forward:** this still doesn't scale `getEdgesTo()` past a full scan — acceptable at current bounded corpus sizes (per the existing wiki design's own reasoning), but worth revisiting if the fact-graph grows large enough to become a primary retrieval path rather than a supplementary one.

## 16.5 Ingestion Connectors

**Why:** This is Supermemory's clearest lead — live connectors (Google Drive, Gmail, Notion, OneDrive, GitHub, S3), a web crawler, webhook-driven sync. GuideAxon's memory system is conversation-first by design; its only comparable path is the LLM Wiki's raw-entry ingestion (`sourceType: 'paste' | 'upload' | 'api_feed' | 'manual'`), with no live-connector ecosystem. `designCognitiveBrain.md` §3.1 (agents-sample comparison) already flags document-ingestion ergonomics as a place even a smaller open-source competitor (Aethene) does better.

**Design — reuse the wiki-raw path, don't invent a new type:**

- Extend `sourceType` to add connector-origin values (`'gdrive' | 'gmail' | 'notion' | 'github' | 's3' | 'url_crawl'`), tag with `metadata.connectorId`. `WikiMemoryProcessor` (`designMemory.md` §8) handles the resulting entries unchanged.
- **Scope down before building all of them:** start with a URL/webpage crawler (no OAuth, lowest effort) plus one OAuth connector (Drive or Gmail) to validate the pattern.
- **Webhooks don't fit this architecture as-is.** GuideAxon is local-first/mobile-first with no always-on server (§5.3, §2.3) — Supermemory's webhook-plus-4-hour-fallback model assumes a hosted backend GuideAxon deliberately doesn't have. The natural home for connector polling and OAuth token refresh is the **desktop tier** (§7.2 — already positioned with Postgres/pgvector and an MCP server), which pushes synthesized artifacts to the shared vault (§8.3) that mobile then reads. Mobile gets a lightweight manual/share-sheet ingestion path instead of running live connector sync on-device. This maps onto the existing three-tier vault architecture rather than requiring new infrastructure — it's a placement decision, not a new capability tier.

**Multi-modal ingestion is a wiring gap, not a missing capability.** `WikiRawEntry.sourceType` already includes `'upload'` — the type system anticipated this. GuideAxon already has PDF/document extraction (RAG pipeline) and image processing (vision hooks) elsewhere in the app (`CLAUDE.md`'s `app-core/services`), separately from the memory system. The gap is that neither extraction result is ever handed to `WikiService.ingestRaw()` — a PDF uploaded via RAG lives only in the RAG vector index, never gets entity extraction, salience scoring, or contradiction resolution the way a chat turn does. Closing it is one integration point per extractor: after RAG's document extraction or vision's image captioning produces text, call `WikiService.ingestRaw(extractedText, { sourceType: 'upload', mimeType })`, reusing §8's existing content-hash dedup and ingestion pipeline unchanged. No new extraction engineering — Supermemory's advantage here is integration breadth (one pipeline for every modality), not extraction capability GuideAxon lacks.

## 16.6 API / Agent Integration Parity

**Why:** Supermemory ships TS/Python/REST SDKs, Vercel AI SDK and OpenAI SDK/Agents SDK integrations, Claude Code/Cursor/Codex plugins, and a hosted remote MCP server (`mcp.supermemory.ai/mcp`). GuideAxon's `IBrainEngine`-as-MCP-server (§6.1.2) and SKILL.md export (§6.13) are architecturally equivalent in intent but not productized the same way.

**Recommendations, in priority order (highest leverage first):**

1. **Productize the desktop `IBrainEngine` MCP server (§6.1.2) into an actual hosted/installable binary** — the direct analog of `mcp.supermemory.ai/mcp`. Highest leverage: the interface and tool mapping already exist on paper (§6.1.2's `DesktopMCPServer` table); the gap is deployability, not design.
2. **Publish a TS/REST SDK wrapping `IBrainEngine`** (`store`/`search`/`think`/`getContextPack`) as a versioned package. Mostly packaging, since `IBrainEngine` is already a stable, platform-agnostic interface by design (§6.2).
3. **SKILL.md export (§6.13) is already the Claude Code/Cursor/Codex parity story** — cross-tool-compatible today. The remaining gap is distribution/installer UX, not the underlying mechanism.
4. **Explicitly hold off on a Python SDK and Vercel AI SDK / OpenAI SDK integrations** until there is a deliberate product decision to expose GuideAxon's memory as a third-party platform rather than an app-internal engine. `IIntelligenceEngine` is app-embedded by design (§2.4, §6.1.1); maintaining two competing public agent-SDK integrations is meaningful ongoing surface area that shouldn't be taken on by default just to match a competitor's feature list. This is a scoping question for whoever owns product direction, not an engineering task to schedule.

### 16.6.1 `search_memory` — an Agent-Invocable Search Tool (new)

**Why:** Supermemory's search API exposes rich options directly to the calling agent — `include.forgottenMemories`, `include.relatedMemories`, `searchMode`, `rerank`. GuideAxon's underlying primitives are comparable, in one respect richer (`lifecycleState` has more granularity — `archived`/`deprecated`/`deleted`/`synthesized` — than Supermemory's binary forgotten flag), but they're not assembled into one tool the answering model can invoke mid-conversation. Today, retrieval happens automatically via `ContextBuilder` before generation (§17.0); the vault's `query_wiki`/`search_pages` are agent-invocable via `TOOL_CALL` (§6.9), but scoped to vault artifacts only, not the full episodic/semantic/insight store.

**Design — wrap existing primitives, build nothing new underneath:**

```typescript
// New PageAgentTool, alongside the existing 13 (CLAUDE.md's tools/index.ts)
search_memory({
  query: string,
  includeForgotten?: boolean,   // maps to filter: { lifecycleState: ['archived', 'deprecated'] }
  includeHistory?: boolean,     // walk parent/child chain (§16.2) - return superseded versions too
  types?: MemoryType[],         // maps to existing SearchOptions.filter.type
  topK?: number,
})
```

- `includeForgotten` → `MemoryFilter.lifecycleState` (existing field) — already finer-grained than Supermemory needs.
- `includeHistory` → `getRelated(id, 'parent')`/`getRelated(id, 'child')` (existing method) walked to reconstruct the version chain — GuideAxon's equivalent of Supermemory's `context`/`rootMemoryId` response fields.
- No `aggregate` (query-time cross-source synthesis) equivalent proposed here — that's a materially bigger feature (an LLM call inside the tool's own execution) and should be scoped separately if wanted, not bundled into this wrapper.
- Registered the same way vault tools are (§6.9's `TOOL_CALL` resolution via `WorkflowExecutor`), extended to resolve against `IBrainEngine.search()`/`getRelated()` directly rather than only `IVaultProvider`.

## 16.7 Summary Table

| Gap vs. Supermemory                                    | Recommendation                                                                                     | Depends on                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| No durability/expiry typing                            | §16.1 `isDurable`/`expiresAt` fields                                                               | —                                                |
| No write-time contradiction resolution                 | §16.2 `ContradictionResolutionProcessor` + `parent`/`child` version chain + new `extends` relation | §16.1                                            |
| No repetition-based reinforcement                      | §16.3 `restatementCount` + salience term                                                           | §16.1                                            |
| No fact-level graph traversal/derive                   | §16.4 typed predicate edges on `MemoryRelation`                                                    | Entity graph (existing)                          |
| No live ingestion connectors                           | §16.5 extend wiki-raw `sourceType`, desktop-tier polling                                           | Vault Connection UI (§6.12), Desktop tier (§7.2) |
| Multi-modal ingestion isolated from memory pipeline    | §16.5 wire existing RAG/vision extraction output into `WikiService.ingestRaw()`                    | LLM Wiki ingestion (existing, §8)                |
| No public SDK / hosted MCP server                      | §16.6 productize existing MCP server + TS/REST SDK                                                 | `IBrainEngine` (existing)                        |
| No agent-invocable memory search tool                  | §16.6.1 `search_memory` wrapping existing `search()`/`getRelated()`/`lifecycleState` filter        | `IBrainEngine` (existing)                        |
| No configurable topic taxonomy outside profile headers | §17.2.8 small (8-12) `tags`-based bucket set, T0/T1 classified                                     | `ProfileClassifier` pattern (§17.2.5)            |

---

## 16.8 Knowledge Graph: Final Approach (2026-09-23)

> **Status: proposed — design finalized, not yet implemented.** This section is the outcome of a dedicated evaluation session comparing three candidate knowledge-graph designs from a long-term, pre-production perspective (explicitly _not_ weighted toward minimizing disruption to existing code, since nothing here has shipped). It supersedes §16.4, which is kept above marked deprecated for historical record.

### 16.8.1 The three options considered

|             | GuideAxon's own proposal (§16.4, deprecated)                                                                                                                                                                                                                    | Supermemory's schema                                                                                                                                                                          | Lumen-Labs/brainapi2                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Model**   | Flat typed-predicate edges between existing entity `MemoryEntry` nodes (subject–predicate–object)                                                                                                                                                               | Two orthogonal fields (`isStatic`, `forgetAfter`) + explicit version chain (`parentMemoryId`/`rootMemoryId`/`version`/`isLatest`) + `relation: 'updates' \| 'extends' \| 'derives'`           | Event-centric: actions are first-class hub nodes — `Actor —rel→ Event —rel→ Target —rel→ Context` — not flat edges                                                                                                                                                                                                                                                       |
| **Pros**    | Reuses existing `InProcessGraph`/`MemoryRelation` infra directly; cheapest to build; no new storage concept                                                                                                                                                     | Simplest schema of the three; proven at hosted-product scale; low engineering cost                                                                                                            | Best representational ceiling for personal memory: natively captures timestamp/context/attribution/confidence per fact, not just per entity-pair; append-only event nodes give real provenance; maps naturally onto GuideAxon's own episodic-memory-heavy (WHEN) taxonomy                                                                                                |
| **Cons**    | Same representational ceiling as Supermemory's model (no event/attribution structure) for more implementation effort; inherits an already-acknowledged non-scaling trade-off (`getEdgesTo()` full scan) without buying back extra reasoning power for that cost | Thin public schema — no subject-predicate-object or event structure documented; can't answer multi-hop "why do I believe X, and when did that change" without extra machinery bolted on later | As literally implemented upstream: 4-agent extraction swarm (Scout/Observations/Architect/Janitor) per fact — too slow/expensive for synchronous on-device use; designed around a pluggable hosted backend (Neo4j/Milvus/MongoDB/Postgres) and a standalone MCP server, neither of which survives mobile's no-always-on-server, background-execution-limited environment |
| **Chosen?** | No — deprecated (§16.4)                                                                                                                                                                                                                                         | No — runner-up                                                                                                                                                                                | **Yes, refined for mobile (§16.8.2)**                                                                                                                                                                                                                                                                                                                                    |

### 16.8.2 What we chose, and why

**Event-centric graph, brainapi2's schema, re-scoped for on-device/mobile-first execution.** The event-hub _topology_ (actions as nodes with their own timestamp/context/confidence, not flat edges) is adopted as-is — it's the highest-ceiling model of the three, and doing this before production data exists avoids a flat-edge → event-hub schema migration later, which would require re-extracting or reinterpreting every stored fact. The _implementation_ brainapi2 ships (multi-agent extraction swarm, external graph DB, standalone MCP server) is not adopted wholesale — none of it survives mobile's constraints, and none of it is actually load-bearing for the schema decision itself.

**Refinements required before this is buildable:**

1. **Storage: op-sqlite, not Neo4j/Milvus/MongoDB.** A graph is nodes + typed edges with an index — `InProcessGraph` already does this over SQLite (native) / IndexedDB (web). Event nodes are additional rows in the same `nodes`/`edges` tables, not a new storage paradigm. No dedicated graph database, no pluggable multi-backend menu — mobile needs exactly one embedded backend.
2. **Extraction: single-pass T0, not a 4-agent swarm, on the synchronous path.** One structured-extraction LLM call writes a minimal event node (actor/action/target/context) synchronously on-device. Anything swarm-like (dedup, cross-fact validation, brainapi2's "Janitor" role) runs asynchronously — on-device during idle time, or deferred to the desktop tier (already planned with Postgres/Neo4j/Memgraph as the "richer graph backend," §7.2) — reusing the eventual-consistency principle already applied to embedding/synthesis/entity-linking (§5.3) rather than inventing a new mechanism.
3. **Retrieval: existing hybrid search, unchanged.** BM25 (Orama FTS5) + dense vector search (768-dim on-device) already covers brainapi2's `/retrieve/search` pattern (BM25 ∪ dense vectors). No new retrieval infra needed.
4. **No standalone MCP server on-device.** A persistent HTTP server doesn't survive iOS/Android background-execution limits. This mirrors the call already made in §16.6 for GuideAxon's own MCP server: the hosted/installable endpoint belongs on the desktop tier; mobile stays an embedded engine.
5. **Bounded growth, from the start — the sizing constraint that makes this buildable.** Event-hub graphs grow faster than entity-only graphs (every action is a new node, not a reused one) and are subject to hub-entity edge fan-out (a frequently-discussed entity accumulates one new edge per event it participates in, unboundedly). Sizing analysis (heavy user, ~30 events/day): ~11,000 event nodes/year, ~33,000 edges/year, ~125MB over 3 years including embeddings — storage is not the blocker, but the existing depth-2 traversal benchmark (~5-10ms at 1,000 nodes, §3.3) does not hold at this scale and must be re-measured with realistic degree skew, not assumed. Mitigation, extending mechanisms already designed elsewhere in this document rather than inventing new ones:
    - **Hot graph window**: cap actively-traversable event nodes to a fixed recency window (e.g. last ~500–1,000 events, matching Tier 2's existing episodic cap, §3.3).
    - **Rollup, not deletion**: events aging out of the window are clustered and collapsed into a single summary node via `InProcessGraph.computeClusters()` — the same mechanism §18's workstream promotion already proposes, applied here to graph density rather than "what's currently active." Raw event nodes move to the vault (Tier 3) for audit/history rather than being deleted, preserving the append-only property outside the hot local index.
    - **Degree-capped traversal**: neighbor expansion from a hub entity takes the top-N most recent/salient incident edges per hop, not all of them — bounds fan-out regardless of total degree.

**Verification gate before implementation starts:** re-run the depth-2 traversal benchmark synthetically at 10k and 100k nodes with realistic (non-uniform) degree skew. If it doesn't hold up under the hot-window + degree-cap mitigations above, that's a signal to tighten the window further before writing extraction code, not after.

> **Status: implemented and verified, 2026-09-24.** `EventNode`/event-role edges, `InProcessGraph.createEventNode()`/`getEventsForEntity()`/`pruneStaleEvents()`, and `EventGraphProcessor` (the single-pass T0/T1 extraction step) are built and wired into `MemoryService`'s pipeline. `pruneStaleEvents()` is wired into `MaintenanceCycle` as a new phase 4 (`event_rollup`, between `graph_rewire` and `semantic_promotion` — the cycle is now 10 phases, not 9); it archives rolled-off raw events to a local `artifact` entry unconditionally (§5.1's corrected principle) and additionally pushes to the vault when one is configured, mirroring `SynthesisEngine.renderAndPersist()`'s pattern.
>
> The verification gate was run (`benchmarks/eventGraphTraversal.bench.ts`, Zipfian-skewed synthetic corpora, 20 samples per measurement) and it surfaced a real problem, not a hypothetical one: at 10,000 events (1 year, heavy-user rate) with a hub entity holding ~3,500 incident edges, unmitigated depth-2 traversal from that hub took a **median of 703ms** — two orders of magnitude past §3.3's 5-10ms figure, which only ever measured uniform-degree nodes. Root cause was two compounding factors, not one: the hub fan-out this section predicted, _and_ a latent bug in `expandNeighbors()` — it dequeued its BFS frontier with `Array.shift()`, which re-indexes the entire remaining array on every call, turning the traversal into O(frontier²) instead of O(frontier). That bug predates this work (`expandNeighbors()` is also used by `ContextBuilder`/`scopeSelection`/the One-Pager) and had simply never been exercised at hub-degree scale before. Fixed by switching to an index-cursor queue (same BFS order, same results, no behavior change) — after the fix, unmitigated hub traversal at 10k events dropped to **6.9ms median**, and at 100k events (3-year horizon) to **120ms median** (hub degree ~35,700). With the `pruneStaleEvents()` mitigation applied (90-day / 500-event hot window, matching the defaults wired into `MaintenanceCycle`), hub traversal at both scales dropped to **~0.2-0.3ms median** regardless of total historical event count — confirming the hot-window design does what §16.8.2 needed it to do, independent of the BFS fix. Full results and methodology in the benchmark file itself.

---

# 17. Answering-Model Input Model: Profile, One-Pager, Compaction Recap, Goals Board (2026-09-22)

> **Status: §17.2-§17.6 are all implemented as of 2026-09-23** — Profile, Memory One-Pager, Compaction Recap, and Goals Board render are all built, tested, and wired into `ChatModeOrchestrator`'s system-prompt assembly in the §17.6 order below (see v2.16, v2.18-v2.21 in the revision history for what shipped in each pass). This section originally documented what the answering model received before this work started, then proposed the pieces that were missing; it's kept largely as-written below for the design rationale, with `implemented` status callouts added at each subsection rather than rewritten as a pure "current state" doc. The profile design is informed by [supermemory.ai/docs/concepts/user-profiles](https://supermemory.ai/docs/concepts/user-profiles)'s static/dynamic split, adapted to GuideAxon's own fixed-header model (§17.2.4 explains why GuideAxon does not copy Supermemory's open-ended bucket design).

## 17.0 How the Answering Model Was Fed Before This Section Shipped (historical - see §17.6 for the current assembly)

There used to be no separate profile, one-pager, or compaction-recap document anywhere in the system. What reached the prompt before v2.16-v2.21 was:

```text
User message
    ↓
ChatModeOrchestrator (web/native)
    ├─ OpenAIEndpointService tried first (LM Studio/Ollama/vLLM)
    └─ falls back to on-device LLM (llama.rn native / WebLLM web)
         ↑
    Context assembled from:
    ├─ WorkingMemoryManager.getForSession() — recent turns, token-budgeted (§16.1's designMemory.md §4)
    └─ ContextBuilder.buildContext() / buildContextForQuery() — salience+recency or
       intent-reranked assembly from HybridMemoryIndex.search() results (designMemory.md §9.4)
```

Everything else described in this section — the write-time pipeline (entity extraction, durability classification, salience, summarization/insight promotion, procedure learning, contradiction resolution, decay/pruning) — happens **after** the answer is generated, asynchronously, enriching what the _next_ turn's search will find; that part is still true today. What's changed as of v2.16-v2.21 is that Profile, one-pager, compaction recap, and goals board are now also pre-digested into standing artifacts the model reads every turn, per §17.6.

The vault/synthesis path (§5.1, §6.7) is the closest existing analog to "memories as documents" — `SynthesisEngine` produces markdown artifacts with YAML frontmatter — but it's a _downstream_ output for cross-device sync and desktop-tier querying, not something read back into the answering model's own prompt on every turn.

## 17.1 Design Decision: Separate Documents, Not One Merged Page

**Question this section exists to answer: is this a "one-pager" or a "three-pager"?**

**Recommendation: neither literally — three (four, counting the goals board) separate small documents, each independently token-budgeted, not one merged multi-page file.**

**Reasoning:** "Pages" isn't the real constraint — total prompt tokens is. But the three candidate documents have fundamentally different volatility and regeneration triggers:

| Document         | Changes when...                                                           | Natural regeneration trigger                                                              |
| ---------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Profile          | A durable fact about who the user is, or a preference, changes            | On write, via `ContradictionResolutionProcessor` (§16.2) touching a profile-relevant fact |
| Memory one-pager | The situational picture shifts — new open threads, recently active topics | Periodically (session start, or every N turns)                                            |
| Compaction recap | Working memory is about to evict something                                | On eviction, not on a schedule                                                            |

Merging these into one file means every regeneration trigger fires a rewrite of the whole merged document, and every consumer (or a future UI surfacing "here's what GuideAxon knows about you") has to parse out three unrelated concerns from one blob. Keeping them separate costs nothing at prompt-assembly time — they're concatenated into the system prompt in one step regardless (§17.6) — and keeps each one's regeneration logic independent and independently cacheable.

### 17.1.1 Persistence Principle: Local-First, Vault-Optional

**Every document in §17 and §18 (Profile, one-pager, workstream pages, and reconciliation's edits to all three) persists as an ordinary local `MemoryEntry { type: 'artifact' }` first, unconditionally, with zero setup required. A connected vault is an additive sync target, never a prerequisite.**

This corrects an inconsistency in earlier drafts of this section, which described these documents as `SynthesisEngine`-produced output destined for the vault, implicitly requiring a configured `IVaultProvider` before Profile/one-pager/reconciliation could do anything at all. That's wrong, and the fix is to apply a pattern this document already established rather than invent a new one: **wiki pages (§8) already work exactly this way** — stored locally via the normal `MemoryEntry` path first (searchable, usable, zero configuration), with vault replication happening asynchronously through the existing Pending Vault Flush Queue (§6.12) only if a vault is configured. Nothing about Profile/one-pager/workstream content is different enough to justify a separate rule.

Concretely:

```text
Profile / one-pager / workstream page generated or reconciled
    ↓
Written locally as MemoryEntry { type: 'artifact', tags: [...] } — ALWAYS, no vault required
  (this is what §17.6's prompt assembly reads from - it never depends on vault state)
    ↓ (only if a vault is configured)
addPendingVaultArtifact(artifact) → existing §6.12 queue → flushed to IVaultProvider
  → git-tracked markdown, cross-device sync, reconciliation's commit-message audit trail
```

**Why this is the same shape as Supermemory's own answer to this question, despite the different architecture:** Supermemory has no "vault" concept at all — every deployment mode (hosted cloud, self-hosted local) writes to its own always-present database from the first API call, so the question of "what if the durable store isn't configured yet" never arises for them. GuideAxon can't collapse the two layers the way Supermemory does — the local store and the git vault are genuinely different things serving different purposes (on-device availability vs. cross-device git history) — but it can guarantee the same _user-facing_ property Supermemory gets for free: the feature works from the first write, with durability/sync layered on top rather than gating it.

**What this changes downstream:**

- §17.2.5 and §17.3.6 ("Generation Mechanism" / "Regeneration Trigger and Caching"): the artifact write is a local `memoryService.create()`/`update()` call; the vault push is the existing §6.12 queue, not a new mechanism.
- §18.5 ("Git-Commit Mechanics"): reconciliation's core operation is updating the local artifact's content. The structured git commit is what happens _in addition_ when a vault is reachable — a bonus audit trail, not the mechanism itself. Without a vault, reconciliation still works; it just doesn't produce a browsable git history (the raw episodic entries backing the document remain the fallback audit trail either way, per §18.1's invariant).

**Unverified assumption, flagged in the 2026-09-22 consolidation pass (§2.15):** this section assumes §6.12's `flushPendingVaultArtifacts(vaultConfig)` degrades gracefully when no vault is configured at all — i.e. that it's a no-op or short-circuits cleanly rather than firing its 5-minute alarm against an absent `vaultConfig` forever. §6.12 was originally scoped to a narrower case (a configured-but-temporarily-unreachable vault), and this section extends its responsibility to "never configured" without checking that the (also not-yet-written) implementation actually handles that path. Since §6.12 itself is unimplemented, this is an assumption stacked on an assumption — worth confirming explicitly when §6.12 is actually built, not just when §17/§18 are.

## 17.2 The Profile

### 17.2.1 Why a Profile at All (vs. relying on search alone)

Supermemory's own rationale (`user-profiles` doc): a profile eliminates the "3-5 queries, 200-500ms" cost of re-deriving foundational context every turn via search, replacing it with a single always-attached document. The same argument applies to GuideAxon — `HybridMemoryIndex.search()` is fast in absolute terms (per `designCognitiveBrain.md` §3.3's own numbers, ~10-80ms depending on corpus size), but it's still a _retrieval_ step reacting to the current query. A profile is foundational context the model needs on **every** turn regardless of what was asked, and shouldn't depend on the current message happening to surface it via search.

### 17.2.2 The Three Headers

GuideAxon's profile is not a general "facts about the user" bag — it's scoped specifically to what the assistant needs to _behave correctly_, in three fixed sections:

- **Life context** — a summary of selected user circumstances and the people or work relevant to them (role, key relationships, ongoing situations worth knowing about).
- **Autonomy calibration** — preferences about when GuideAxon should act versus ask (e.g. "send routine emails without asking," "always confirm before scheduling anything with external people").
- **Channel communication style** — preferences about _how_ to communicate (tone, verbosity, formality, preferred format).

These three are the "headers" GuideAxon always sees — every answer is generated with this context present, not retrieved on demand.

### 17.2.3 Static vs. Dynamic Split

Per Supermemory's model: **static** = long-term stable facts (role, expertise, format preferences); **dynamic** = current/temporary context (active projects, recent focus, temporary states). GuideAxon splits the same way, and — usefully — this maps directly onto the `isDurable`/`expiresAt` fields already built in §16.1:

- **Static section** = `isDurable: true` entries with no `expiresAt`, ideally ones that have survived at least one `ContradictionResolutionProcessor` pass without being superseded (i.e. no `child` relation — still the current version) or that have an elevated `restatementCount` (§16.3) — the user has stated this more than once, or it has stood unchallenged.
- **Dynamic section** = `isDurable: true` entries created or last-updated recently (a rolling window, e.g. 14 days), or entries with `expiresAt` set that are still in the future — i.e. things that are true _right now_ but not asserted as permanent.

This is not a new classification pass — it's a read-time query shape (`filter: { minSalience, ... }` style, or a dedicated `filter.isDurable` + recency window once `MemoryFilter` supports it — a small addition alongside the existing `minSalience`/`minImportance` filter fields) over facts already tagged by the existing pipeline.

### 17.2.4 Why Fixed Headers, Not Supermemory's Open-Ended Buckets _For the Profile Itself_

Supermemory's **buckets** (`preferences`, `goals`, `work`, and organization-defined custom buckets, sorted by a classifier) are a general-purpose topic taxonomy — useful when the product doesn't know in advance what a given deployment cares about. GuideAxon's three headers are deliberately **not** that: they're not "topics the user has talked about," they're the fixed, closed set of things the _answering behavior itself_ depends on. Autonomy calibration and communication style aren't topics a user would casually generate content about — they're closer to configuration that happens to be inferred from conversation rather than a settings screen. A general bucket classifier would need those two categories manually pre-declared anyway to reliably route facts into them, at which point GuideAxon's fixed three-header model is simpler and just as correct for GuideAxon's specific need. (`GoalManager`, § 17.5, already exists as GuideAxon's own answer to Supermemory's `goals` bucket — kept as its own subsystem rather than folded into the profile, since goals have a lifecycle — open/closed/outcome — that plain facts don't.)

This argues against buckets _replacing_ the three fixed headers. It doesn't argue against buckets existing at all — §17.2.8 adopts a scoped-down version of the concept for facts that fall outside all three headers.

### 17.2.5 Generation Mechanism (implemented 2026-09-22)

**Implementation correction, deeper than the 2026-09-22 consolidation pass (§2.15) first found:** `SynthesisEngine` is not reused at all, not even via a new `compileSection()` method as that pass proposed. Reading `SynthesisEngine.compile()`'s actual body during implementation showed it does `if (!this.vault) return 0` as its very first line — it hard-requires a configured vault, unconditionally, and is structured around extracting N concepts from raw sources into N separate vault pages. That's incompatible with §17.1.1's "persists locally, unconditionally, no vault required" principle at a deeper level than a missing method signature - adding `compileSection()` to a vault-required class wouldn't fix the vault requirement. `ProfileSynthesizer` is therefore its own small, independent, local-first class with no dependency on `SynthesisEngine`. Persistence follows §17.1.1: the local `MemoryEntry` write is unconditional; the vault push is additive (not yet implemented - tracked as follow-up work, same as the rest of §6.12's flush queue).

```text
ContradictionResolutionProcessor resolves a durable fact (create/update/extend)
    ↓
ProfileClassificationProcessor (registered after ContradictionResolutionProcessor
  in the pluggable processor chain, MemoryService.initialize()):
  ProfileClassifier.classifyForProfile() tags the fact with a header, as a
  `profile:<header>` tag (queryable via the existing MemoryFilter.tags path,
  not a new filter dimension) - or leaves it untagged if nothing matches
    ↓ (only if tagged)
ProfileSynthesizer.computeSection(header, memory, llmService):
  queries durable facts for that header (§17.2.3's static/dynamic split,
  applied in-process over the tag-filtered results) → LLM composes a short
  paragraph per section, T3 fallback (fact concatenation) if no LLM available
    ↓
MemoryService.persistProfileSection() writes the section into the fixed-ID
  local Profile artifact (`__profile__`, same fixed-ID-via-direct-store-access
  pattern as the existing graph snapshot) - this is what IBrainEngine.getProfile()
  reads from, unconditionally, no vault required
    ↓ (only if a vault is configured - NOT YET IMPLEMENTED, tracked separately)
Would queue via the existing §6.12 Pending Vault Flush Queue → IVaultProvider.updatePage()
```

Classification runs as a T0 keyword pass today (mirroring `T0DurabilityClassifier`'s regex-first approach); the LLM upgrade path exists at the `compose()` step (section prose), not yet at the classification step itself - a possible future refinement, not required for correctness.

**Regenerates synchronously per matching fact, not "background, batched" as originally envisioned** - correctness first; batching stale-section regeneration is a performance optimization that can be layered on later without changing what a section actually says.

### 17.2.6 Files (implemented 2026-09-22, unless noted)

| File                                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/profile/ProfileClassifier.ts`                          | `classifyForProfile()`/`applyProfileClassification()` - T0 regex classification into a header or `null`; `ALL_PROFILE_HEADERS`, `profileTag()`                                                                                                                                                                                                                                                                 |
| `core/profile/ProfileSynthesizer.ts`                         | `computeSection()` - static/dynamic split + LLM composition (T3 fallback). Pure computation, no store access (see correction above for why it doesn't use `SynthesisEngine`)                                                                                                                                                                                                                                   |
| `core/pipeline/processors/ProfileClassificationProcessor.ts` | Pluggable processor: tags durable entries, triggers section regeneration, persists via `IMemoryService.persistProfileSection()`                                                                                                                                                                                                                                                                                |
| `interfaces/IMemoryService.ts`                               | Added `persistProfileSection(section): Promise<void>` - internal plumbing; the fixed-ID artifact can't be reached via `create()`/`update()` alone                                                                                                                                                                                                                                                              |
| `types.ts`                                                   | `ProfileHeader`, `ProfileSection { header, static, dynamic, updatedAt }`, `Profile { sections, updatedAt }` — landed directly in the shared `types.ts` rather than a new `core/profile/types.ts`, consistent with where every other type in this codebase lives                                                                                                                                                |
| `interfaces/IBrainEngine.ts`                                 | `getProfile(): Promise<Profile>` and `assertProfileCorrection(header, factId, correctedText): Promise<void>` (§17.2.9 - bypasses `ContradictionResolutionProcessor` classification, writes an `updates` relation directly at `confidence: 1.0`) — implemented on `MemoryService`, and stubbed on `DesktopBrainEngine`/`NoOpBrainEngine` (the interface's other two implementations, which needed updating too) |
| `core/MemoryService.ts`                                      | `persistProfileSection()`, `getProfile()`, `assertProfileCorrection()` — the fixed-ID artifact write uses direct `memStore` access, same pattern as the existing graph snapshot                                                                                                                                                                                                                                |

### 17.2.7 Why This Design Improves on Supermemory's Profile, Not Just Differs From It

**Trimmed in the 2026-09-22 consolidation pass (§2.15) — the full four-point argument (auditable classification vs. an opaque model, one data model serving contradiction resolution/profile/reconciliation at once, a git-based audit trail once §18 lands, zero-round-trip local-first assembly) previously lived here in full and is now consolidated into §19.8, which makes the same case as part of placing GuideAxon on the broader provider landscape rather than as a standalone comparison. See §19.8 for the complete argument.** The one point worth keeping local to this section: the profile's static/dynamic split isn't a separate classifier decision — it's a direct query over `isDurable`/`expiresAt`/`restatementCount` (§16.1, §16.3), fields the profile shares with §16.2's contradiction resolution and §18's reconciliation. That sharing is what makes §19.8's "one data model, not three separate systems" claim concretely true for the Profile specifically, rather than an assertion — worth restating briefly here since it's the mechanism this whole section depends on, even though the comparative framing now lives in §19.8.

### 17.2.8 Configurable Topic Buckets (Beyond the Three Headers)

Adopts Supermemory's bucket _concept_ — a configurable, classifier-assigned topic taxonomy — scoped down for facts that don't belong to any of the three fixed headers but still benefit from topic-based retrieval scoping (interests, health, finances, hobbies, travel, and similar). This is a parallel, optional classification layer, not a fourth header and not a replacement for §17.2.2's fixed three.

**Deviations from Supermemory's parameters, and why:**

- **Small default set (8-12), not 50.** Bucket classification has to work at T0 (regex/keyword, zero LLM cost) with a T1 upgrade path, per the tiered-inference principle (§5.4) already governing every other classifier in this system (`T0DurabilityClassifier`, `T0EntityExtractor`). A lightweight on-device T0 pass reliably distinguishing among 50 categories is a much harder problem than among a small, well-differentiated set; Supermemory's classifier is presumably cloud-scale and doesn't face this constraint.
- **Reuse `tags`, not a new field or filter dimension.** A bucket assignment is written as a `tags` entry (e.g. `bucket:health`), queryable via the existing `MemoryFilter.tags`/`tagMatchMode` (AND-semantics, `designMemory.md` §1 Bug 3) — no new schema field, no new query path.
- **Per-user configuration, not per-org.** GuideAxon is single-user-per-install; Supermemory's org-level/space-level two-tier bucket config collapses to a single user-settings screen listing name+description pairs for custom buckets, stored alongside other preferences (`packages/app-core/store`).

**Mechanism:** identical shape to `ProfileClassifier` (§17.2.5) — a T0 keyword pass guided by each bucket's description, with an LLM upgrade path, run at the same pipeline stage. A fact can land in a header, a bucket, both, or neither (an entry tagged `autonomy` and `bucket:work` simultaneously is expected and fine — the two are orthogonal, same as Supermemory's static/dynamic-vs-bucket axes).

**Default bucket set (8, not left as an unspecified "8-12"):**

```
professional, health, learning, personal    ← reused verbatim from GoalManager.domain
                                               (ProcedureMetadata.domain, designMemory.md §7) -
                                               free consistency between a goal's domain and
                                               a fact's bucket in the same real-world area
finances, relationships, interests, travel  ← new; common Supermemory presets not already
                                               covered by GoalManager's four domains
```

**Why reuse `GoalManager`'s domains instead of an independent list:** inventing a separate taxonomy would mean a "learning" goal and a "learning" bucket fact have no structural relationship even though they're about the same real-world area. Reusing the same four names costs nothing and lets goals and buckets cross-reference. The four additions cover topics goals genuinely don't have an equivalent for (you don't have a "goal" about your relationships or interests the way you have one about learning a skill) — they're adopted from Supermemory's 13 presets, trimmed to the four that don't overlap what `GoalManager` already names.

### 17.2.9 User-Facing Correction: Viewer + Direct Assertion

**Why this is needed:** Autonomy Calibration specifically has real behavioral consequences — it governs when GuideAxon acts versus asks. Relying solely on "restate the correction in chat and hope the pipeline classifies it correctly" (§16.2) is not an adequate correction path for something with that much downstream effect; the user needs a way to fix it directly.

**Scope, deliberately minimal for now:**

1. **Read-only Profile viewer.** A settings screen rendering `IBrainEngine.getProfile()`'s current output (§17.2.6 — already a planned read API, no new backend work). Lets a user see what GuideAxon currently believes about them, section by section.
2. **"This is wrong" action.** From the viewer, flagging a specific line writes a correction as a **direct user assertion**, not a restated fact for the pipeline to classify. This bypasses `ContradictionResolutionProcessor`'s LLM classification step entirely — a user directly saying "this is wrong" doesn't need an LLM to judge whether it's `same`/`updates`/`extends`, because the user _is_ the ground truth. It goes straight to the `updates` path (§16.2) with `confidence: 1.0` and `metadata.assertedByUser: true`, creating a `child` relation over the flagged fact the same way any other correction does.

**Explicitly deferred (not this pass):** full bidirectional vault-markdown editing — letting a user edit the Profile's markdown file directly (e.g. in Obsidian) and having that edit flow back into the memory graph. That requires a vault-read-back ingestion path this document doesn't otherwise need and is a materially larger feature; the viewer + direct-assertion pair above covers the actual risk (autonomy calibration being wrong with no fast correction path) without it.

## 17.3 Memory One-Pager

Distinct from the Profile: the Profile answers "who is this person and how should I behave," the one-pager answers **"what's going on right now."** Content: currently-active procedures, prospective-memory reminders due soon (`designMemory.md` §9.1), and the recent episodic/semantic/insight activity not already captured by the Profile's dynamic section.

### 17.3.1 Why Not a Flat L1/L2 Merge

The obvious MVP is `list({ filter: { type: ['semantic', 'insight'] } })` sorted by salience, fed into `ContextBuilder.buildContext()`. This is worth building first to validate the mechanism cheaply, but it is **not the long-term design**, for four reasons:

1. **Wrong types.** L1 (`semantic`) and L2 (`insight`) don't carry `procedure` or `prospective` entries — exactly the "active right now" content a one-pager most needs. A real one-pager spans four types, not two.
2. **L2 is sparse.** Insight synthesis only fires when 3+ related L1 entries share ≥2 entities (`Pipeline.maybePromoteToInsight`) — most current topics haven't crossed that bar, so a merge is L1-heavy almost all the time.
3. **Redundant by construction.** An `insight` is derived from specific `semantic` entries via `sourceIds`. Including both the insight and the summaries it was built from double-counts the same fact and wastes the smallest, most valuable part of the prompt.
4. **Flat top-K salience mixes unrelated topics.** Ranking purely by salience across the whole store can surface five disconnected things instead of a coherent picture of what's currently active.

The long-term design replaces flat ranking with **graph-seeded scope selection** (fixes #4) and adds **vector-similarity dedup** (fixes #3), while widening the type set (fixes #1) and running as a background synthesis pass rather than a live per-turn query (addresses the latency argument in §17.2.1 — a one-pager should be pre-computed, not re-derived on every message).

### 17.3.2 Final Pipeline: Scope → Dedup → Condense

```text
OnePagerSynthesizer.regenerate() — runs periodically (§17.3.6), not per-turn
    │
    ├─ Stage 1: SCOPE  (graph walk, not flat ranking)      →  candidate set (≤40 entries)
    ├─ Stage 2: DEDUP   (vector similarity)                →  deduped set (≤15 entries)
    └─ Stage 3: CONDENSE (LLM synthesis, T3 fallback)       →  one-pager markdown artifact
```

### 17.3.3 Stage 1 — Graph-Seeded Scope Selection

Reuses `InProcessGraph.expandNeighbors(nodeId, depth)` (§6.6/`designMemory.md` §6) — the same BFS primitive already built for entity/wiki traversal — instead of inventing a second graph-walk implementation:

```typescript
// 1. Seed: the entities behind the highest-salience entries created/updated
//    in the last D days (default 7) — "what's currently hot," not "what's ever mattered."
const seedEntities = topSalienceEntitiesInWindow((days = 7), (limit = 5))

// 2. Expand: pull in the connected neighborhood of each seed, depth-2
//    (same depth default WikiRetriever already settled on, §6/designMemory.md §8,
//    and for the same reason - depth-1 misses linked-but-indirect context,
//    depth-3+ mostly adds noise).
const scopeEntityIds = new Set(seedEntities.flatMap((id) => graph.expandNeighbors(id, 2)))

// 3. Collect: any entry of type episodic/semantic/insight/procedure/prospective
//    whose .entities overlap scopeEntityIds, or whose linkedProcedureIds/relations
//    reference a scoped procedure - capped at 40 before Stage 2.
const candidates = collectEntriesLinkedToEntities(scopeEntityIds, {
    types: ['episodic', 'semantic', 'insight', 'procedure', 'prospective'],
    limit: 40,
})
```

**Why this beats flat top-K:** the seed-and-expand walk guarantees every candidate is _connected_ to something currently active, rather than being independently salient in isolation. Five unrelated high-salience facts about five unrelated topics no longer compete for the same slots as a connected cluster of ten facts about what the user is actually doing this week.

### 17.3.4 Stage 2 — Vector-Similarity Dedup

Directly targets the L1/L2 redundancy problem (§17.3.1 #3), generalized to any near-duplicate pair in the candidate set, not just insight/source pairs:

```typescript
// Reuse the same embeddingFn already injected into HybridMemoryIndex/OramaIndex
// for search - no second embedding pipeline. Prefer a cached embedding
// (already computed at index time) over recomputing.
const embeddings = await Promise.all(candidates.map((c) => getOrComputeEmbedding(c)))

// Cluster candidates whose cosine similarity exceeds a high bar (0.92) - this is
// near-duplicate detection, not topical similarity, so the threshold is
// deliberately strict: two entries about the same broad topic but different
// specifics must NOT collapse into one.
const clusters = clusterBySimilarity(candidates, embeddings, (threshold = 0.92))

// Within each cluster, keep exactly one representative:
//   1. Prefer higher tier: insight > procedure > semantic > episodic > prospective
//      (an insight already subsumes the L1 summaries it was derived from)
//   2. Prefer not-superseded: no `child` relation (§16.2's version chain)
//   3. Tie-break: highest salience
const deduped = clusters.map(pickRepresentative)
```

This is what makes it safe to widen Stage 1's type set to five types and still end up with a short list — dedup, not a tighter initial filter, is what keeps the final set small and non-repetitive.

### 17.3.5 Stage 3 — LLM Condensation (with T3 fallback)

The deduped set (≤15 entries) is composed into a short markdown narrative — not a concatenation of formatted entries, which is a list, not a one-pager:

```text
Prompt: "Summarize what's currently active for this user in 150-250 words,
organized as: active threads, open procedures, upcoming reminders.
Source material: <deduped entries, each tagged with its type>"
```

**T3 fallback (no LLM available):** fall back to `ContextBuilder.formatEntry()` per surviving deduped candidate, sorted by salience — the same graceful-degradation pattern already used throughout this system (`WikiPageProcessor`'s rule-based fallback, `T1SummarizationProcessor.t3Summarize()`). A concatenated-but-deduped list is still strictly better than the flat-merge MVP, since Stages 1-2 already removed the noise and redundancy.

### 17.3.6 Regeneration Trigger and Caching

Periodic, not per-turn — the same principle as the Profile (§17.2.5):

- **Scheduled:** session start, or every N turns (config, default matches `MaintenanceCycle`'s cadence rather than inventing a new timer).
- **Early invalidation:** if `ContradictionResolutionProcessor` (§16.2) resolves a new fact whose entities intersect the _current_ one-pager's scope set, mark it stale immediately rather than waiting for the next scheduled run — a new fact about something already in scope should show up promptly; the periodic schedule is the ceiling on staleness, not the only trigger.
- **Output:** a single artifact via `SynthesisEngine.compile()` — unlike the Profile (§17.2.5), the one-pager regenerates as one whole document rather than individual sections of a larger one, so it doesn't need the `compileSection()` extension §17.2.5 requires; `compile()`'s existing signature is adequate here. Persisted locally first per §17.1.1, vault push additive and queued via the existing §6.12 flush mechanism, never a prerequisite for the one-pager being usable.

### 17.3.7 Files (implemented 2026-09-23, v2.20)

| File                                   | Purpose                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/onepager/OnePagerSynthesizer.ts` | Orchestrates Scope → Dedup → Condense; exposes `regenerate()` and `markStaleIfScoped(entry)`                                                          |
| `core/onepager/scopeSelection.ts`      | `topSalienceEntitiesInWindow()`, `expandScope()`, `collectEntriesLinkedToEntities()` — wraps `InProcessGraph.expandNeighbors()`                       |
| `core/onepager/dedup.ts`               | `clusterBySimilarity()`, `pickRepresentative()` — cosine similarity over an injected `embeddingFn`, lexical (Jaccard) fallback when none is available |
| `interfaces/IBrainEngine.ts`           | `getOnePager(): Promise<string>` added, plus stubs in `DesktopBrainEngine`/`NoOpBrainEngine`/the extension's `SmritiOrchestrator`                     |

Two deviations from the plan below, both intentional and documented in code (see v2.20 in the revision history for why): persistence goes through a fixed-ID local artifact (`MemoryService.getOnePager()`) rather than `SynthesisEngine.compile()`, and caching is a 30-minute TTL rather than a session-start/N-turn scheduler.

### 17.3.8 Verification Checklist (One-Pager) — all 8 implemented (v2.20-v2.21)

| Feature                  | Test                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph-seeded scope       | Create a connected cluster (shared entity) of 5 medium-salience entries and 3 unrelated high-salience singletons; verify the cluster dominates the candidate set over the higher-salience singletons |
| Depth bound              | Verify entries 3+ hops from any seed entity are excluded from candidates                                                                                                                             |
| Vector dedup             | Create a `semantic` entry and an `insight` derived from it (near-identical content); verify only the `insight` survives Stage 2                                                                      |
| Dedup precision          | Create two entries on a similar broad topic but different specifics (similarity ~0.7); verify both survive (below the 0.92 threshold)                                                                |
| Representative selection | In a duplicate cluster, verify a `procedure` is preferred over a `semantic` entry, and a non-superseded entry is preferred over one with a `child` relation                                          |
| T3 fallback              | Simulate no LLM available; verify the one-pager still renders (concatenated, deduped, salience-sorted) rather than failing                                                                           |
| Early invalidation       | Resolve a new fact whose entity is already in the current one-pager's scope; verify it's marked stale before the next scheduled regeneration                                                         |
| Cadence                  | Advance N turns with no scope-relevant fact changes; verify a scheduled regeneration still occurs                                                                                                    |

## 17.4 Compaction Recap (implemented 2026-09-23, v2.21)

`WorkingMemoryManager` already evicts entries by lowest-salience-first when the token budget is exceeded (`designMemory.md` §4). Before this shipped, eviction just **dropped** the entry from working memory — nothing summarized what was lost. The compaction recap closes that gap:

```text
WorkingMemoryManager about to evict entries E1..En (over budget)
    ↓
Before dropping: append a one-line summary of each evicted entry to a running
  "compaction recap" buffer (LLM-free — reuse ContextBuilder.formatEntry()'s
  existing per-type formatting, just append instead of discard)
    ↓
Recap buffer itself is token-capped (e.g. 200 tokens) - oldest recap lines
  drop first, same eviction policy as working memory itself
```

This is intentionally cheap (no LLM call) — it's a safety net against silent context loss, not a second synthesis pipeline. Implementation: `WorkingMemoryManager.onEvict()`/`offEvict()` (a callback bus, same shape as `GoalManager.onGoalClosed()`) plus `core/working/CompactionRecap.ts` for the buffer itself; `MemoryService` subscribes one to the other in its constructor. `IBrainEngine.getCompactionRecap()` reads the current buffer.

## 17.5 Goals / Tasks Board (implemented 2026-09-23, v2.19)

No new subsystem was needed — `GoalManager` already existed and is a real, working implementation of this box. The addition was `GoalManager.renderBoard(): Promise<string>`, backed by a pure `formatGoalsBoard()` formatter, that formats open goals (title, category, status) as a compact markdown list suitable for direct prompt injection, alongside the Profile/one-pager/recap rather than requiring a separate `getGoals()` + ad hoc formatting at each call site. Building it surfaced a real pre-existing bug in `storeGoal()` — see v2.19 in the revision history.

## 17.6 Assembled Answering-Model Input (final shape) — implemented 2026-09-23 (v2.18-v2.21)

```text
System prompt sections, in order:
  1. Profile          (from §17.2 - regenerated on relevant fact changes)
  2. Memory one-pager  (from §17.3 - regenerated periodically)
  3. Goals board       (from §17.5 - GoalManager.renderBoard())
  4. Compaction recap  (from §17.4 - only non-empty if working memory has evicted recently)
  5. Working memory    (existing - recent conversation turns)
  6. On-demand search  (existing - ContextBuilder.buildContextForQuery() results for the current message)
```

Sections 1-4 are new artifacts, independently regenerated (§17.1); sections 5-6 are the pre-existing context path (§17.0). Implemented exactly in this order in `ChatModeOrchestrator.web.ts`/`.native.ts` (all 3 system-prompt-assembly call sites), as plain string concatenation onto `systemContent` — no formal "addon array" abstraction, matching the file's existing `<active-skill>` idiom. None of this required changing how `ChatModeOrchestrator` calls the LLM.

**Gap vs. this section's original claim:** "each independently token-budgeted" is only true for the compaction recap (its own internal 200-token cap, §17.4) and, loosely, the one-pager (the LLM condensation prompt targets 150-250 words, §17.3.5). The Profile and Goals board have no truncation logic at all in the `ChatModeOrchestrator` wiring — an unusually large Profile or goals list would be injected in full. Not yet a problem in practice (both are naturally small - three fixed headers, open goals only) but a real gap if either grows unbounded. Not fixed in this pass.

## 17.7 Verification Checklist

| Feature                      | Test                                                                                                                                                                                                               | Status                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile classification       | Create a durable fact matching autonomy-calibration language ("always ask before..."); verify `ProfileClassifier` tags it `autonomy`, not `life_context`                                                           | ✅ `ProfileClassifier.test.ts` (v2.16)                                                                                                                                                                                                 |
| Static/dynamic split         | Create a fact 14+ days old with `restatementCount >= 2`; verify it renders in the static section. Create a fact from today with `expiresAt` unset; verify it renders in the dynamic section only until it ages out | ✅ `ProfileSynthesizer.test.ts` (v2.16)                                                                                                                                                                                                |
| Profile regeneration scoping | Update one fact tagged `communication_style`; verify only that section's markdown regenerates, not the whole profile                                                                                               | ✅ `ProfileClassificationProcessor.test.ts` (v2.16)                                                                                                                                                                                    |
| One-pager cadence            | Advance N turns; verify a new one-pager snapshot is produced without requiring a new fact write                                                                                                                    | ✅ `MemoryService.onePager.test.ts` (v2.21, via TTL expiry rather than a literal turn counter — see §17.3.6's deviation)                                                                                                               |
| Compaction recap             | Force working memory over its token budget; verify evicted entries appear as one-line summaries in the recap rather than disappearing silently                                                                     | ✅ `CompactionRecap.test.ts` / `WorkingMemory.test.ts` (v2.21)                                                                                                                                                                         |
| Goals board rendering        | Open two goals, close one; verify `renderBoard()` omits the closed goal                                                                                                                                            | ✅ `GoalManager.renderBoard.test.ts` (v2.19)                                                                                                                                                                                           |
| Assembly order               | Inspect the assembled prompt; verify sections appear in the §17.6 order and each respects its own token budget independently                                                                                       | ⚠️ **Not tested.** No test asserts the actual concatenated `systemContent` order in `ChatModeOrchestrator`, and (per the gap noted above) the "independent token budget" half of this claim doesn't hold for two of the four sections. |

---

# 18. Reconciliation — Non-Append Memory Maintenance (2026-09-22)

> **Status: proposed, not implemented.** This section formalizes a requirement that the write-time pipeline (§16) and §17's Profile/one-pager generation don't cover: periodic maintenance that _rewrites_ already-synthesized documents rather than only appending to or fading them. Five specific behaviors motivated this: moving temporary details into workstreams, shortening durable records while linking to fuller notes, generalizing repeated examples into traits, removing incidental details, and replacing incorrect facts with dated corrections.

## 18.0 What's Already Covered vs. What's New

Two of the five behaviors already exist at the _entry_ level; reconciliation's job for those two is to make the graph-level fact reach the _prose_ that quotes it:

| Behavior                                              | Entry-level mechanism                                                                                                  | What reconciliation adds                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace incorrect facts with dated corrections        | Fully covered — `ContradictionResolutionProcessor`'s `updates` classification + `parent`/`child` version chain (§16.2) | Nothing new mechanically — reconciliation just needs to re-read the current chain state and rewrite any prose still quoting a superseded version                      |
| Turn examples into broader traits                     | `InsightProcessor`'s L2 synthesis does this for entity clusters (`Pipeline.maybePromoteToInsight`)                     | The same generalization, applied to Profile section prose specifically, which L2 insight synthesis doesn't touch                                                      |
| Shorten durable records while linking to fuller notes | The L0→L1 promotion + `sourceIds` pattern establishes "compressed pointer to fuller record"                            | Not applied to Profile/one-pager prose itself — a static-section blurb should _shrink_ as `restatementCount` (§16.3) grows, linking out rather than accumulating text |
| Remove incidental details                             | **Nothing today.** Retention policies (`designMemory.md` §9) are salience/age-threshold-driven, not judgment-driven    | New capability — an LLM judgment pass, not a numeric threshold                                                                                                        |
| Move temporary details into workstreams               | **"Workstream" doesn't exist as a concept.**                                                                           | New primitive (§18.2)                                                                                                                                                 |

## 18.1 What Reconciliation Is (and Is Not)

Three tiers of memory maintenance now exist at three different frequencies and granularities:

| Tier                                     | Frequency                                  | Scope                                                                  | Operation                                                       |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Write-time pipeline (§16)                | Every entry                                | One entry                                                              | Additive — create / link / supersede                            |
| Pruning (`designMemory.md` §9, existing) | Daily / weekly / monthly                   | Episodic batch                                                         | Compressive — summarize a time window                           |
| **Reconciliation (this section)**        | Weekly, or size/age-triggered per document | A synthesized document (Profile section / one-pager / workstream page) | **Rewrite** — restructure, compress, generalize, prune, correct |

**Invariant that must hold:** reconciliation only ever touches the **synthesized layer** — Profile sections, the one-pager, workstream pages — and **never** raw episodic `MemoryEntry` rows. This is the same separation `designCognitiveBrain.md` §5.1 already establishes ("Raw memory is never considered canonical knowledge... Raw memory (stays local) ... Synthesized knowledge (goes to vault)"); reconciliation is squarely a synthesized-knowledge operation. Two consequences fall out of this for free:

1. **Nothing is destructively lost.** The raw episodic entries backing any reconciled prose still exist regardless of what reconciliation decides to shorten, generalize, or drop.
2. **Two independent undo layers exist when a vault is configured.** The raw episodic store is one (always present, per §17.1.1); the reconciled document's own git history (§18.5) is the other — every pre-reconciliation version of the prose is a prior commit, recoverable without touching memory internals at all. Without a vault, only the first layer exists — the raw episodic entries remain the fallback audit trail, but there's no browsable prose-level history until a vault is connected.

## 18.2 The Workstream Primitive

**Definition:** a workstream is a graph cluster — computed by the already-implemented `InProcessGraph.computeClusters()` (§6.6, community detection over the entity graph) — that has been promoted to a durable, named page once it's active or large enough to be worth naming.

**Why reuse `computeClusters()` rather than building new clustering logic:** this is the same principle used everywhere else in this document (§8's "No Separate GraphStore," §16.4's "don't build a second graph store") — the entity graph already clusters related activity; a workstream is that clustering made durable and readable, not a new derivation.

**Correction from the 2026-09-22 consolidation pass (§2.15): `computeClusters()` alone does not give the promotion criteria below.** The actual signature is `computeClusters(): Map<string, number>` — an entity-ID → cluster-number _assignment_ only. It has no notion of cluster size, member `MemoryEntry` count, or activity recency. Evaluating "≥5 linked entries and active within 14 days" requires new aggregation logic layered on top: group entities by their assigned cluster number, resolve each entity to the `MemoryEntry` rows that reference it (via `entities`/`related_to`), then count and date-check that set. `computeClusters()` supplies the grouping; it does not supply the metric. This aggregation step belongs in `WorkstreamManager.checkPromotions()` (§18.7's files table) and should be listed there as real new logic, not implied to come for free from the existing method.

**Promotion criteria** (proposed defaults, tunable): a cluster is promoted to a workstream page once it has ≥5 linked entries **and** has been active (new entries added) within the last 14 days, per the aggregation above. Below that bar, the cluster exists only implicitly in the graph — exactly as it does today.

**Representation:** a workstream is a `MemoryEntry { type: 'artifact', tags: ['workstream-page'] }`, materialized the same way wiki pages already are (§8's storage layout) — not a new store, not a new `MemoryType`. It gets a slug, a title (LLM-composed from the cluster's dominant entities), and body content that reconciliation maintains over time.

**Dedup against existing wiki pages before creating a new one.** Wiki pages (§8, from pasted/uploaded documents) and workstreams (from graph-cluster promotion) both materialize as `type: 'artifact'` pages — without a check, the same real-world topic could end up with two pages: one from a document someone pasted about "Project Foo," another from the graph cluster that formed independently around the same entities. Promotion must first query for an existing wiki page already linked (via the `related_to`/`entity_of` edges Pass 1 wiki ingestion already creates, §8) to the cluster's entities. If one covers the cluster, **adopt it** — add the `workstream-page` tag alongside its existing `wiki-page` tag rather than creating a second page. Only create a new page when no existing wiki page covers the cluster. This is the same check-before-create pattern §8's own "Duplicate Detection" section already uses for raw-entry ingestion (check slug, update in place rather than duplicate) — applied here to entity-overlap instead of slug match, since "workstream" ends up being a promotable _role_ a page can carry, not a second page-creation path.

**Linking:** moving a "temporary detail into a workstream" means adding a `part_of` relation from the detail's entry to the workstream page. `part_of` already exists in the `GraphEdgeType` union (`types.ts`) and is currently unused — this is its first real consumer.

**Lifecycle:** a workstream goes dormant the same way anything else does — `lifecycleState: 'archived'` once its cluster stops accumulating new entries for a configurable period, using the existing lifecycle field rather than a workstream-specific status.

## 18.3 The Five Behaviors, Mechanically

Given a target document (a Profile section, the one-pager, or a workstream page) and its backing durable facts, a single reconciliation pass over that document performs all five in one LLM call — the same way a person tidying notes does several of these at once, which is presumably why they were originally listed together rather than as five separate features:

1. **Correct** — re-read the current `parent`/`child` chain state for every fact the document quotes; if any has been superseded since the document was last written, replace the quoted claim and note the correction inline with its date (`"Works at Stripe (corrected 2026-09-22, was Google)"` — mirroring how the version chain itself already carries this information, just surfacing it in prose).
2. **Generalize** — if the backing facts include 2+ specific examples supporting the same underlying trait, collapse them into one general statement, the way `InsightProcessor` already does at the entity-cluster level, scoped instead to this document's content.
3. **Shorten + link** — if a fact's `restatementCount` (§16.3) has grown, that's a signal it's well-established; compress its prose representation and add a pointer to the workstream or one-pager holding the specifics, rather than letting the section grow.
4. **Prune** — the one genuinely new, non-mechanical judgment: ask the LLM whether a given detail is still worth keeping in this durable document, versus having been incidental noise. This is the only step with no existing entry-level analog, and it's the only one of the five gated at a stricter confidence bar (§18.4's VALIDATE step) rather than the shared default — see the reasoning there.
5. **Reorganize** — identify content that reads as temporary/project-specific rather than durable-identity material, and propose moving it out to its workstream page (creating one via §18.2's promotion criteria if none exists yet) rather than letting it bloat what's supposed to be a stable section.

### 18.3.1 Tiered Execution: T1 (Mobile) vs. T2 (Desktop)

Reconciliation's judgment calls are harder than what a small on-device T1 model reliably does well, but gating the whole feature to desktop-only would violate the mobile-self-sufficiency principle (§2.3) for this specific piece of the system. The fix is not a new mechanism — it's the same **Option C synthesis strategy** (§2.3) already used for everything else GuideAxon synthesizes: mobile does a lighter pass, desktop upgrades it when available, tracked via the `synthesisQuality: 'T1' | 'T2'` field that already exists (§5.5) for exactly this purpose.

- **T1 (mobile, default):** runs `correct`, `generalize`, and `shorten + link` only — the three behaviors with the most existing entry-level precedent (§18.0's table) and the least room for a bad call to be hard to notice. **Skips `prune` and `reorganize` entirely at T1** — both require weighing "is this still worth keeping" or "does this belong somewhere else," judgment calls a small model is least reliable at, and reconciliation is not a per-turn interactive feature, so there's no responsiveness cost to deferring them.
- **T2 (desktop, when available):** detects `synthesisQuality: 'T1'`-tagged reconciled documents (the same detection mechanism already used for T1→T2 synthesis upgrades, §2.3/§7.2) and runs the full five behaviors, including `prune`/`reorganize`, upgrading the document in place and re-tagging it `synthesisQuality: 'T2'`.

This means a mobile-only user still gets ongoing correction and compression (the two most valuable, most mechanical behaviors) with zero desktop dependency, while pruning/reorganizing — the two behaviors with no existing precedent to lean on — only ever run where there's a model capable enough to be trusted with them.

## 18.4 The Reconciliation Pipeline

```text
ReconciliationEngine.run() — per document, triggered by §18.6's rules
    │
    ├─ 1. GATHER    current document prose + its backing durable facts
    │                (facts tagged to this Profile header / linked to this workstream's cluster)
    ├─ 2. PROPOSE    one LLM pass performs all five §18.3 behaviors, returns:
    │                { newContent: string, changes: ChangeSummary[] }
    │                where each ChangeSummary carries its OWN confidence (not one
    │                overall score) - needed because VALIDATE below applies a
    │                different bar per behavior, not a single global cutoff
    ├─ 3. VALIDATE   per-change confidence gate, applied change-by-change, not to
    │                the proposal as a whole:
    │                  - correct / generalize / shorten+link / reorganize >= 0.7
    │                    (same threshold ProcedureEvolutionProcessor uses for
    │                    patch validation, §16.2/designMemory.md §7)
    │                  - prune >= 0.85 (stricter - see reasoning below)
    │                a change below its bar is dropped individually; the rest of
    │                the proposal still applies - one over-cautious prune
    │                shouldn't block an otherwise-good correction in the same pass
    └─ 4. APPLY      write the new content to the local MemoryEntry artifact
                      (§17.1.1 - unconditional, no vault required); log the
                      reconciliation event to the existing mutation log
                      (designMemory.md §3); if a vault is configured, additionally
                      push via IVaultProvider.updatePage() with a structured
                      commit message (§18.5), cross-referenced in the mutation log
```

**Why `prune` alone gets a stricter bar:** the other four behaviors are self-correcting if wrong — an over-cautious generalization or an unnecessary reorganization just gets fixed next cycle, and nothing is lost in the meantime. Pruning is asymmetric: silently dropping a detail the user actually cared about erodes trust in a way that's hard to notice (nothing points at what's missing) and isn't cheaply reversible in effect, even though the raw episodic entry backing it is never touched (§18.1's invariant). It's also the one behavior with zero precedent elsewhere in this system (§18.0's table) — the newest, least-validated judgment call is the right place to spend extra caution, not a blanket change to the threshold everywhere else.

**Two caveats added in the 2026-09-22 consolidation pass (§2.15), both worth being honest about before this is implemented:**

1. **0.7 and 0.85 are unvalidated shared defaults, not evidence of calibration.** Both numbers are reused from `ProcedureEvolutionProcessor`'s patch validation "for consistency," but consistency of _citation_ isn't consistency of _calibration_ — nobody has tested whether an LLM's self-reported 0.7 confidence means the same thing when classifying a fact update as it does when judging whether a life-context detail is incidental. Treat these as reasonable starting points to tune against real usage, not as validated thresholds that happen to coincide across four different judgment types.
2. **Per-change confidence is an unproven mechanism, not just an unimplemented one.** Step 2 (PROPOSE) asks a single LLM call to return five independently-scored `ChangeSummary` confidences rather than one holistic score. Splitting self-reported confidence across multiple sub-judgments within one generation pass is a harder, less-studied ask than the single overall confidence `ProcedureEvolutionProcessor` uses today — there's no evidence yet that an LLM produces well-calibrated _per-item_ confidence in this setting, as opposed to just producing five plausible-looking numbers. This needs empirical validation before the stricter `prune` bar above can be trusted to actually behave more conservatively in practice, not just on paper.

## 18.5 Git-Commit Mechanics (Vault-Configured Case Only)

**This section applies only when a vault is connected — per §17.1.1, reconciliation's core operation (rewriting the local artifact) succeeds unconditionally regardless of vault state. The git commit described here is the additive audit-trail step, not the mechanism by which reconciliation works.**

**No new git plumbing needed for the additive step.** `GitHubVaultProvider.updatePage()` already implements the real mechanism: fetch the current file's SHA, then `PUT` the new content via GitHub's Contents API, using the SHA for optimistic-concurrency (a stale SHA means someone else — e.g. a desktop-tier T2 upgrade, §7.2/§8.3 — wrote to the same page since; the PUT fails and must be retried against a fresh read rather than force-overwritten, standard git-conflict handling).

**One gap to close:** `IVaultProvider.updatePage(slug, content, frontmatter)` doesn't currently accept a commit message — `GitHubVaultProvider` hardcodes `"vault: update ${slug}"`. Add an optional fourth parameter:

```typescript
updatePage(slug: string, content: string, frontmatter: PageFrontmatter, commitMessage?: string): Promise<void>
```

Backward compatible (existing callers that omit it keep the current generic message); reconciliation supplies a structured one summarizing what changed, e.g.:

```text
reconcile(profile/autonomy): generalize 3 examples into trait; drop incidental detail
reconcile(profile/life_context): correct employer (Google -> Stripe, dated 2026-09-22)
reconcile(workstream/project-foo): absorb 4 temporary details moved from profile/life_context
```

This gives the vault's own git log a second, independent audit trail of _why_ prose changed, readable without touching the memory store at all — exactly the kind of history a person browsing the vault repo directly (§5.1's git-tracked-markdown model) would want to see.

**Failure handling:** a SHA conflict (concurrent write) or a sub-threshold confidence result (§18.4 step 3) both result in the same outcome — skip this cycle, leave the document as it was, try again next trigger. Reconciliation is never allowed to force-push over content it hasn't freshly read.

## 18.6 Where Reconciliation Sits Relative to §17

```text
Write-time pipeline (§16)          — every entry, continuous
    ↓ feeds
Profile / one-pager regeneration (§17.2.5 / §17.3.6)  — per-section or scheduled,
    │                                                    ADDITIVE: re-derive a section's
    │                                                    content from current facts
    ↓ accumulates over many regeneration cycles
Reconciliation (§18)                — weekly, or size/age-triggered,
                                       REWRITE: restructure across documents,
                                       compress, generalize, prune
```

**The key distinction from §17's own regeneration:** §17.2.5/§17.3.6 regenerate a section _from_ its current backing facts — each run is a fresh derivation, scoped to one document, and never touches another document. Reconciliation is different in kind, not just frequency: it can **move content across documents** (Profile → workstream) and make a **judgment call with no fact-level trigger** (pruning incidental detail isn't a response to any single new fact, the way §17's regeneration is). Running reconciliation at §17's per-section cadence would be wasteful — most weeks, a Profile section has nothing worth restructuring — so reconciliation is deliberately a separate, lower-frequency tier rather than an extra step folded into §17.2.5/§17.3.6's existing regeneration.

**Trigger relationship:** §17's regeneration can itself request reconciliation out-of-band — if a section's rendered prose exceeds a size threshold (e.g. 150 tokens for a Profile section that's supposed to stay a short paragraph), that's a signal it's accumulated content reconciliation should look at, rather than waiting for the fixed weekly schedule. This keeps the weekly schedule as a ceiling on staleness (matching the same principle already used for the one-pager's early-invalidation rule, §17.3.6), not the only path to running.

**Scheduling: reuse the existing weekly hook, don't build a second scheduler.** `PruningProcessor` (`designMemory.md` §9) already has a working weekly trigger, including "missed cycle" catch-up logic on app open. `ReconciliationEngine.run()` should be invoked _from_ that same weekly hook (or `MaintenanceCycle`'s existing cadence, §7.2/§13/§14), not given its own independent timer — there's no value in a second scheduling mechanism when one already exists and already handles the edge cases (app not opened for a while, etc.). This is a scheduling reuse only: the two remain separate code paths and separate operations (§18.1's tier table) — `PruningProcessor` creates new episodic-summary `MemoryEntry` rows, `ReconciliationEngine` rewrites existing vault documents via `IVaultProvider.updatePage()` — sharing a trigger doesn't mean sharing an implementation. Reconciliation should NOT run on `PruningProcessor`'s _daily_ trigger, only its weekly one — daily would be wasteful compute and noisy git history for content that rarely needs restructuring more than once a week (§18.1's own reasoning for why reconciliation is a distinct, lower-frequency tier still applies to cadence, just not to scheduling infrastructure).

## 18.7 Files (proposed)

| File                                          | Purpose                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/reconciliation/ReconciliationEngine.ts` | Orchestrates Gather → Propose → Validate → Commit (§18.4)                                                                                                                                                                                                                                   |
| `core/reconciliation/WorkstreamManager.ts`    | Cluster promotion/demotion (§18.2): `checkPromotions()` (new aggregation over `computeClusters()`'s output — group by cluster number, resolve to `MemoryEntry` counts/dates, since `computeClusters()` itself provides neither), `renderWorkstreamPage()`, `linkEntry()` (writes `part_of`) |
| `interfaces/IVaultProvider.ts`                | Add optional `commitMessage` parameter to `updatePage()` (§18.5)                                                                                                                                                                                                                            |
| `core/audit/MutationLogStore.ts`              | No schema change — reconciliation events use the existing `MutationEvent` shape (`designMemory.md` §3), with `metadata.vaultCommitMessage` cross-referencing the git commit                                                                                                                 |

## 18.8 Verification Checklist

| Feature                   | Test                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw memory untouched      | Run reconciliation on a Profile section; verify no episodic `MemoryEntry` is modified or deleted, only the vault artifact                                                                                        |
| Workstream promotion      | Grow a graph cluster to 5+ linked entries active within 14 days; verify a workstream page is created; verify a 4-entry cluster is not                                                                            |
| `part_of` linking         | Move a temporary detail into a workstream; verify a `part_of` relation is added from the detail to the workstream page                                                                                           |
| Correction surfacing      | Supersede a fact via `ContradictionResolutionProcessor` after a Profile section already quotes the old value; run reconciliation; verify the section's prose reflects the new value with a dated correction note |
| Generalization            | Back a section with 3 examples of the same underlying trait; verify reconciliation collapses them into one general statement                                                                                     |
| Pruning                   | Include an incidental, non-recurring detail among backing facts; verify reconciliation's proposal omits it, and verify the source `MemoryEntry` is unaffected                                                    |
| Confidence gate           | Force a sub-0.7 confidence proposal; verify the document is left unchanged and the cycle is skipped, not partially applied                                                                                       |
| Concurrent-write conflict | Simulate a stale SHA (another writer updated the page first); verify reconciliation re-fetches and retries rather than overwriting                                                                               |
| Commit message            | Verify the resulting vault commit message summarizes the actual changes made, not a generic "update" string                                                                                                      |
| Size-triggered early run  | Grow a Profile section past the token threshold via normal §17.2.5 regeneration; verify reconciliation runs before the next scheduled weekly cycle                                                               |

## 18.9 Known Limitation: Prose Is Not Derived From Logic

> **This is an acknowledged, unresolved limitation of the design specified above — not a solved problem, and not covered by §18.8's verification checklist.** The three mitigations at the end of this section are proposed follow-on work, not yet designed in the depth the rest of §18 is.

**The general critique** (applies to markdown/wiki-based memory systems broadly, GuideAxon's LLM Wiki and §18's Reconciliation included, not a GuideAxon-specific flaw): learning happens by an agent editing previously-written prose. This risks two compounding failure modes — **drift** (each edit is a small, possibly-wrong LLM judgment call, and errors compound across repeated reconciliation cycles) and **loss to compression** (`generalize`, §18.3 #2, discards the specific examples it summarized; once compressed, the original reasoning chain isn't reconstructible from the prose alone). Compounding both: there is no explicit **logical chain** connecting a downstream synthesized claim back to the specific upstream fact it depends on — the classic shape being customer complaint → identified problem → feature → requirement. When the upstream fact changes or is compressed away, nothing downstream is notified, and an agent editing the downstream document doesn't know the chain exists, so it can make an edit that looks locally reasonable while silently breaking a dependency.

An external system, "Tortoise," addresses this by building an explicit logical world model — typed, **quantified** relationships (support, contradict, and others) such that current state is _derived_ from the relationship graph rather than independently free-written by an LLM. The framing worth keeping: the difference between a filing cabinet (documents get refiled and rewritten by whoever's handling them) and a system that understands _why_ a claim holds, and can therefore act on it without drifting or regressing.

**Where §18 is concretely exposed:** `ReconciliationEngine`'s PROPOSE step (§18.4) is, structurally, exactly "an agent edits previous data." The confidence thresholds (§18.4's per-change gate, §18.3's stricter 0.85 bar on `prune`) and T1/T2 tiering (§18.3.1) reduce the _probability_ and _blast radius_ of a bad edit — they do not make the edit _derived from a formal model_. An LLM can self-report high confidence while missing a dependency it was never shown. Concretely: if `generalize` collapses a specific customer complaint into a broader trait, and some other document holds a `derived_from` edge pointing at that original complaint, nothing today notices the dependent has gone stale — the edge is present in the graph but plays no role in constraining what reconciliation is allowed to write.

**Partial existing mitigations (real, but not sufficient on their own):**

1. **The raw episodic layer is immutable and never touched by reconciliation** (§18.1's invariant, inherited from §5.1). Synthesized prose can drift, but the ground truth it was derived from is never lost, and could in principle be re-synthesized from scratch. Most prose-only wiki systems don't have this split — they edit the only copy.
2. **One class of fact-level relation is already typed and confidence-scored.** `ContradictionResolutionProcessor`'s `updates`/`extends` classification (§16.2) is a directional, confidence-scored relation — closer in spirit to a quantified support/contradict edge than to free-text editing.
3. **`EdgeType` already has an unused `depends_on` member** (`types.ts`, scoped narrowly in its own comment to "system depends on system"). The primitive a dependency chain needs already exists in the type union — it has no consumer today.

**The actual gap:** these typed relations exist _alongside_ the prose, not _underneath_ it. Synthesis reads some facts and free-writes a paragraph; the graph supplies raw material, it does not constrain or generate the output. The relations are decorative, not load-bearing.

**Scoping honesty:** adopting Tortoise's full formal-world-model machinery (belief revision / argumentation-framework-style reasoning over quantified relations) is a materially larger undertaking than anything else in this document, and it is a genuinely open question whether GuideAxon's domain — personal life-context, preferences, goals — needs that level of rigor the way a product-requirements-traceability tool does, where a missed dependency means a shipped feature misses a real customer need. The three mitigations below close the gap in spirit, without committing to the full apparatus.

### Proposed Mitigations (follow-on work)

1. **Make reconciliation graph-first, prose-second.** Before generating any new paragraph, `correct`/`generalize`/`prune` should first update typed, confidence-scored relations — extending the mechanism `ContradictionResolutionProcessor` already has — and only then render prose as a constrained pass over the _current_ relation state, rather than an independent creative act that happens to have read some facts. This is the core fix, and it's the concrete answer to "make typed relations load-bearing instead of decorative": prose becomes a _view_ of the graph, not a parallel, independently-driftable artifact. Load-bearing means the prose cannot assert something the current graph state doesn't support; decorative (today's design) means the graph is background reading material an LLM is free to disregard, misweigh, or miss the implications of.
2. **Activate `depends_on` (or a new `requires` edge) with propagation.** When a fact that something else depends on is pruned or meaningfully reshaped, flag the dependent for review in the next reconciliation cycle instead of silently leaving it referencing something that no longer says what it used to. Flag, not auto-edit — an automatic cascading edit is its own drift risk and compounds the underlying concern rather than resolving it.
3. **Tie a generalized claim's validity to its sources' current state, not just its `sourceIds` at synthesis time.** If enough of an insight's or trait's supporting facts are later individually superseded, that should surface as "this generalization needs re-verification" rather than sitting unreviewed until the next scheduled reconciliation pass happens to touch it.

None of the three above is designed to the depth of §18.1-§18.8 — they're recorded here as the identified shape of the fix, not a specification ready to implement.

---

# 19. Memory Taxonomy Cross-Reference: WHO / HOW / WHAT / WHEN / WHY (2026-09-22)

> **Status: organizing reference, not a new subsystem.** This section adds no new mechanism. It re-maps everything already built or proposed in §5-§18 onto a functional taxonomy — what job does a given memory serve, independent of how it's implemented — and records where the mapping is clean, where it's asymmetric, and where it exposes a real gap. Intended use going forward: check a new memory-related addition against these boxes before building it, the same way a new fact gets checked against existing `MemoryType`/`EdgeType` values before a new one is added.

## 19.1 Why a Functional Taxonomy, Not an Implementation One

Vendor terminology in this space is fragmented in a specific way: "RAG," "context windows," "session replay," "skills," "knowledge graphs," and "vector databases" each name a _mechanism_, and different providers use different mechanisms to serve the same underlying function, or the same mechanism to serve several different functions. GuideAxon's own documentation has the same conflation — `MemoryType` (`episodic`/`semantic`/`insight`/`procedure`/...) mixes a compression-level axis (L0/L1/L2, `designMemory.md`'s core organizing idea) with a functional one, and this document has at various points described L0/L1/L2, the `MemoryType` enum, and specific storage/retrieval mechanisms (Orama, `InProcessGraph`) somewhat interchangeably.

The taxonomy below cuts along function instead: **short-term memory keeps an agent oriented while work is happening; long-term memory lets it accumulate knowledge across tasks and time.** Long-term splits further into five questions a memory serves an answer to — WHO, HOW, WHAT, WHEN, WHY.

**Relationship to the existing Reddit-cognitive-science taxonomy already in `designMemory.md` V3** (Episodic / Semantic / Procedural / Working / Prospective, §"V3 — Cognitive Science Audit"): that one is a real, useful, but narrower cut — it names four of the five long-term categories (missing WHO and WHY entirely, which is exactly what V3's own gap analysis flagged as "almost no AI system handles this" for Prospective, and what §18.9 independently flagged for WHY) and doesn't separate short-term into working memory / session replay / coordination. The taxonomy below supersedes it as the organizing reference for _this_ document without invalidating V3's specific content — `prospective` memory (V3 §9.1) still exists and still matters, it's just positioned below as a forward-pointing case of WHEN rather than treated as a sixth independent category.

### 19.1.1 Three Components, Orthogonal to the Eight Types

Before the WHO/HOW/WHAT/WHEN/WHY split, a second, orthogonal axis is worth naming explicitly because GuideAxon's own docs have historically organized around it instead of function: any memory _type_ below is implemented via three components, and until recently which component a system emphasized was treated as the core differentiator (it no longer is, now that most systems combine several):

| Component           | Question it answers                                                                                                                                         | Where GuideAxon's own docs already describe this, per type                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ingestion**       | How does data get loaded, and is it transformed/mined into a target shape on the way in?                                                                    | The write-time pipeline (§16): entity extraction, durability classification, salience, summarization/insight promotion — all ingestion-time transforms, not raw storage                                                                   |
| **Storage**         | Where does it live — local or cloud, short- or long-term?                                                                                                   | SQLite/IndexedDB (local, always-on per §17.1.1), optional git-tracked vault (cloud/cross-device, additive)                                                                                                                                |
| **Retrieval & use** | How is the right information found and brought back — keyword/semantic search, temporal queries, graph traversal, logical inference, or automated triggers? | `HybridMemoryIndex` (keyword+vector+RRF), `InProcessGraph.expandNeighbors()` (graph traversal), `ProspectiveMemoryChecker` (automated trigger), and — per §18.9 — logical inference is the one retrieval mode GuideAxon does not yet have |

This is why §19.1's critique of implementation-driven organization isn't a claim that mechanism doesn't matter — it's that mechanism (which of these three components a system leans on) is a different, orthogonal question from function (which of the eight types below it serves). A single `MemoryType` like `procedure` has its own ingestion (patch proposals), storage (versioned `MemoryEntry` chain), and retrieval (search + `getRelated()` chain walk) — the type answers _what job it does_; the components answer _how that job gets done_.

## 19.2 Short-Term Memory

| Layer              | What it answers                                                                                                                                              | GuideAxon mechanism                                                                                                | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Working memory** | What am I doing right now?                                                                                                                                   | `WorkingMemoryManager` — token-budget-aware, per-type eviction caps (`designMemory.md` §4)                         | Solid, mature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Session replay** | What happened during previous _runs_ — execution history itself (messages, tool calls, intermediate steps, outputs), not meaningful events extracted from it | `IWorkflowPersistence.loadWorkflowHistory()`/`loadWorkflowResult()` (§6.10) for Nemilia agent workflow runs        | Real, but scoped only to agentic workflows. Plain chat has no dedicated replay abstraction — just re-reading episodic entries in session order. Worth being precise about the distinction from `episodic` (§19.3): episodic memory stores _meaningful events already extracted_ from experience ("user asked about X"), session replay stores the _raw execution trace_ itself (every tool call, every intermediate step) — GuideAxon has the former for chat but only the latter for workflow runs, and doesn't extract meaningful episodic entries _from_ workflow execution traces today |
| **Coordination**   | What are other agents or humans doing?                                                                                                                       | `agentMemory` (`MEMORY[key]: value` tokens, shared within one workflow run) + `hitlOverrides` (WorkflowDefinition) | The thinnest of the three. Scoped narrowly inside the Nemilia workflow system — no general "what's happening elsewhere" layer available outside it (e.g. to the plain chat orchestrator). Real gap, currently small only because GuideAxon doesn't yet have much multi-agent surface area for it to bite                                                                                                                                                                                                                                                                                    |

## 19.3 Long-Term Memory

| Category             | What it answers                                       | GuideAxon mechanism                                                                                                                                                                                                                                                                                                                                   | Assessment                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WHO (identity)**   | Who am I and what can I do?                           | Split asymmetrically — see §19.4                                                                                                                                                                                                                                                                                                                      | Rich for the _user_, thin for the _agent_                                                                                                                                     |
| **HOW (procedural)** | How should I do this?                                 | Full SMRITI procedure system (`designMemory.md` §7) — versioned steps, 11-action patch system, `candidate→experimental→active→stable` status promotion                                                                                                                                                                                                | Genuinely strong, and rarer industry-wide than it should be — confirmed earlier in this document's Supermemory comparison (§16) that Supermemory has essentially none of this |
| **WHAT (semantic)**  | What do I know?                                       | L1 `semantic` summarization, L2 `insight` synthesis, `HybridMemoryIndex` (vector + BM25 + RRF), entity graph, Wiki pages (§8)                                                                                                                                                                                                                         | Mature, table-stakes territory, well-built                                                                                                                                    |
| **WHEN (episodic)**  | What happened?                                        | L0 raw episodic capture (immutable per §5.1), salience-scored, session-scoped; `prospective` (V3 §9.1) as the forward-pointing case — "what will happen / what should I remember to bring up"                                                                                                                                                         | Mature. `prospective`'s dual-pathway trigger model (time-based + topic-cue-based) is a genuine differentiator noted earlier against Supermemory, which has no equivalent      |
| **WHY (epistemic)**  | Why do I believe this, or why was this decision made? | Almost nothing general-purpose. The one real instance: `ProcedurePatch.rationale` (`designMemory.md` §7) — an LLM's stored explanation for _why_ a procedure changed. `ContradictionResolutionProcessor` (§16.2) produces a confidence score but was never designed to store _why_ something was classified `updates` vs. `extends` — only the number | **The clear weak point** — see §19.5                                                                                                                                          |

## 19.4 The WHO Asymmetry

GuideAxon's WHO-memory is lopsided in an interesting, specific way: it has a rich, actively-designed memory of who the **user** is (§17.2's Profile — life context, autonomy calibration, communication style, all dynamically maintained), but a comparatively thin, mostly-static memory of who the **agent itself** is. The closest equivalent to an agent self-model is the base system prompt plus the SKILL.md registry (§6.9/§6.13) — both configuration, neither a memory that _accumulates_ the way the user profile does. There's no dynamic self-model that learns, for example, "I've been getting this specific kind of request wrong" the way procedural memory already learns from execution outcomes. Whether this asymmetry needs closing is a genuinely open product question (a user-facing personal assistant plausibly needs the user side far more than an evolving self-model), not a design conclusion — recorded here so it's a deliberate choice rather than an unnoticed gap.

## 19.5 WHY Is the Connecting Thread to §18.9

The WHY gap identified here and the "typed relations are decorative, not load-bearing" limitation recorded in §18.9 are the same underlying gap described from two directions:

- Named functionally (this section): GuideAxon has no general representation of _why_ a belief holds — the evidence, assumptions, and tradeoffs behind it, or what would change if new evidence arrived.
- Named structurally (§18.9): GuideAxon's typed relations (`updates`/`extends`, the unused `depends_on` edge) exist alongside synthesized prose but don't constrain what that prose is allowed to say.

An evidence/assumption/tradeoff layer _is_ what would make those relations load-bearing — and it's also what would let `ProcedurePatch.rationale`'s pattern (storing the LLM's reasoning, not just its output) generalize from one subsystem to every subsystem that makes a judgment call: `ContradictionResolutionProcessor`, `ReconciliationEngine` (§18), and any future addition. §18.9's three proposed mitigations are, in this framing, a WHY-memory built incrementally into the one subsystem that most acutely needs it (reconciliation) rather than as a separate, general-purpose epistemic layer — a reasonable place to start, not a claim that the gap is closed by starting there.

**Worth being precise about a common conflation here:** the existing mutation log (`designMemory.md` §3, `MutationLogStore`) is an _audit_ trail — it records that a change happened and when. It is not epistemic memory — it doesn't record _why_ the change was justified, what evidence supported it, or what would need to change for the decision to be revisited. The two are easy to mistake for each other because both look like "history," but an audit log answers WHEN/WHAT-changed, not WHY.

## 19.6 Boundary Cases That Don't Map Cleanly

Three existing/proposed constructs sit across categories rather than in one box — noted so future work doesn't force a clean mapping that doesn't actually exist:

- **`goal`** — a forward-looking commitment (`GoalManager`), closer to a hybrid of WHO (what the user/agent is committed to doing) and Coordination (tracking status against an implicit "what's in progress" board, §17.5) than a pure long-term knowledge category.
- **`prospective`** — positioned in §19.3 as forward-pointing WHEN, but it also functions partly as Coordination-with-your-future-self ("remind me to check X") — the taxonomy's cleanest fit is still WHEN, but it's worth naming the overlap.
- **Workstream (§18.2, proposed)** — a graph cluster promoted to a durable page for "what's currently active." This reads as Working-memory-that-persists-longer-than-a-session — genuinely between the short-term and long-term halves of the taxonomy, not cleanly in either.

## 19.7 `MemoryType` → Taxonomy Mapping

| `MemoryType`  | Primary box                    | Notes                                                                   |
| ------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `working`     | Short-term: Working memory     |                                                                         |
| `episodic`    | WHEN                           |                                                                         |
| `prospective` | WHEN (forward-pointing)        | see §19.6                                                               |
| `semantic`    | WHAT                           |                                                                         |
| `insight`     | WHAT (generalized)             |                                                                         |
| `entity`      | WHAT (entity-scoped)           |                                                                         |
| `procedure`   | HOW                            |                                                                         |
| `goal`        | WHO / Coordination hybrid      | see §19.6                                                               |
| `artifact`    | WHAT or HOW, content-dependent | wiki pages (§8) skew WHAT; synthesized profile/one-pager (§17) skew WHO |

No `MemoryType` maps to WHY today — consistent with §19.3/§19.5's finding that WHY has no general-purpose representation yet, only the narrow `ProcedurePatch.rationale` instance.

## 19.8 Where GuideAxon Sits on the Provider Landscape

Memory tooling clusters into recognizable bundles by which parts of the stack a given provider covers. Placing GuideAxon against each is more informative than treating it as sui generis:

| Category                                                    | What it typically covers                                                                                                                                                          | Does GuideAxon fit?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Models** (raw weights)                                    | Knowledge baked into training, not writable at runtime                                                                                                                            | No — GuideAxon is model-agnostic by design (T0-T3 tiered inference, §5.4); it's a consumer of models, not one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Coding harnesses** (Claude Code, Cursor, etc.)            | Short-term memory + Procedural memory (Skills as Markdown) + configurable Identity (AGENTS.md); Semantic/Episodic/Epistemic generally bolted on externally                        | Partial overlap, not a match — `cognitive-brain`'s Nemilia workflow layer (§6.1.1, vendored from `page-agent`) has real harness-like DNA (SKILL.md, agent archetypes), but GuideAxon's _primary_ product surface is the personal-assistant memory system, not a general coding harness                                                                                                                                                                                                                                                                                                           |
| **Databases** (Neo4j, Postgres, GitHub)                     | Underlying storage only, not a memory system by itself                                                                                                                            | No — `InProcessGraph`, SQLite/IndexedDB, and the git vault are GuideAxon's _storage layer_, analogous to what these provide underneath a memory system, not the product itself                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Consumer Agents** (Claude Web, ChatGPT, Muse)             | Native short-term memory + Identity + some Semantic; architecture rarely disclosed                                                                                                | **Closest surface-level match.** GuideAxon is explicitly personal-use, mobile-first (§2.3), and — unlike this category's norm — the architecture is fully disclosed and designed deliberately rather than left opaque (the entire point of §16's Supermemory comparison and §17.2.7's "auditable, not opaque" argument)                                                                                                                                                                                                                                                                          |
| **Company Brains** (Glean, Lore)                            | Short-term + Identity + Semantic/Episodic/Procedural + harness + integrations; Epistemic generally absent                                                                         | No — multi-tenant/organizational by design; GuideAxon is single-user-per-install (§17.2.8's reasoning for why bucket config is per-user, not per-org)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Knowledge Management Systems** (Obsidian, Confluence)     | Human-first Semantic/Procedural via Markdown + relational DBs; agent access via APIs, bolted on                                                                                   | Adjacent, not a match — GuideAxon's vault (§5.1, §6.11) deliberately reuses this category's substrate (git-tracked Markdown, Obsidian as one supported provider) but the vault is a _sync target_ for an agent-first system (§17.1.1), not a human-first tool with agent access added on                                                                                                                                                                                                                                                                                                         |
| **Agent Memory providers** (Mem0, Zep, Supermemory, GBrain) | Semantic + Episodic first-class; sometimes Session Replay; no Working Memory, Coordination, Procedural, or Identity; Epistemic generally absent                                   | **Second-closest match**, and where most of §16's comparison work sits — GuideAxon's core memory system (§16, `designMemory.md`) is architecturally this category's shape. Where GuideAxon diverges from the category norm: it _does_ have first-class Procedural memory (§7, unusual for this category per §16's own findings) and Identity/WHO memory (§17.2) that most providers in this category lack                                                                                                                                                                                        |
| **Computational Memory providers** (Tortoise, RSIAgent)     | Epistemic memory as a first-class capability — processes relationships between evidence, beliefs, decisions, and outcomes so new information can update more than one stored fact | **Not yet, and honestly so** — this is exactly §18.9's and §19.5's finding restated as a category label. GuideAxon has the _raw material_ this category is built on (typed relations, a confidence-scored `updates`/`extends` classification, `ProcedurePatch.rationale`) but hasn't made those relations load-bearing the way this category requires. §18.9's three proposed mitigations are, in this framing, the concrete path from "Agent Memory provider with unusually good Procedural/Identity coverage" toward "Computational Memory provider" — not a claim that GuideAxon is there yet |

**The honest summary:** GuideAxon is best described today as an **Agent Memory provider with Consumer Agent framing** (personal-use, mobile-first, fully-disclosed architecture) **and unusually strong Procedural + Identity coverage** for that category — reaching toward, but not yet a member of, the Computational Memory provider category, specifically blocked on the Epistemic gap §18.9/§19.5 already named. That's a meaningfully different, more precise position than "GuideAxon vs. Supermemory," the framing most of §16 was written against — Supermemory is the right comparison for the Agent Memory provider core, but the more relevant comparison for where GuideAxon is _headed_ is Tortoise's category, not Supermemory's.
