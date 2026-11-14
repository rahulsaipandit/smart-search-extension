# Native Mobile Voice Architecture — GuideAxon "Vantage" App

**Status:** Implemented; §7 documents further hardening and a list of open improvements
**Date:** August 2026; updated September 2026
**Scope:** `app/screens/voice.jsx`, `app/(tabs)/home.jsx`, `packages/app-core/hooks/speech/`, `packages/app-core/kokoro/adapters/`, `packages/app-core/hooks/useChatSpeech.js`, `modules/expo-audio-tap/`, `packages/app-core/services/LLM/LlamaService.native.ts`, `packages/app-core/hooks/ChatModeOrchestrator.native.ts` — paths updated 2026-09-12 for the September 2026 restructuring (`lib/` → `packages/app-core/`, imported the same way via the unchanged `@/lib/...` alias — see `docs/SharedCodeRestructuring.md`); `modules/expo-audio-tap/` was not moved.

This document is about the native mobile app's speech-to-text pipeline (React Native/Expo, `whisper.rn`) — unrelated to `designVoice.md`, which covers the web-based Executive Twin chat card (`packages/website`, Web Speech API). Different app, different stack, different STT engine. Do not conflate the two.

It documents an incident: the native mic was first found silently non-functional, two separate root-cause fixes were needed to make it actually work, and a third bug (two independent voice sessions racing for the same mic) caused production-reproducible crashes. Recorded in full because the failure modes were not obvious from the JS logic alone — each required inspecting native source and parsing crash reports directly.

## 1. Problem Statement

The app has three independent entry points into speech-to-text:

- The inline `MicButton` in the chat input row (`app/(tabs)/home.jsx`) — dictates into the text box.
- The hands-free `VoiceScreen`, opened via the header `PixelOrb` (`app/screens/voice.jsx`) — full voice conversation loop with TTS.
- A quiz/learn-mode hands-free flow (`packages/app-core/hooks/useChatSpeech.js`).

All three call the same `useSpeechRecognition()` hook. On native (iOS/Android), that hook drives `whisper.rn`'s realtime transcription — a deliberate choice, not an accident (Metro resolves `useSpeechRecognition.native.js` over the platform-less variant). **Update (2026-09-11):** that platform-less `useSpeechRecognition.js` — a complete but unreachable `expo-speech-recognition` implementation — and a stray `useSpeechRecognition.native.txt` were both deleted as confirmed-dead code (§7.6 item #16); only `.native.js`/`.web.js` remain in `packages/app-core/hooks/speech/` today.

The mic did not work on real device (not just the Simulator, as an earlier, incorrect diagnosis had assumed). Fixing it surfaced two distinct, unrelated native bugs.

## 2. Incident Timeline & Diagnosis

### 2.1 Symptom 1 — Mic does nothing, no crash

```
LOG  [SpeechRecognition] Starting real-time transcription...
LOG  [SpeechRecognition] Transcriber status: ACTIVE
LOG  [SpeechRecognition] Real-time transcription started successfully
[AudioToolboxCore] AudioConverter.cpp:1077  Failed to create a new in process converter ->
    from  0 ch, 16000 Hz, .... (0x00000000) 0 bits/channel, 0 bytes/packet, 0 frames/packet, 0 bytes/frame
    to    1 ch,  16000 Hz, Int16, with status -50
[AudioToolbox] AudioQueueObject.cpp:1898  BuildConverter: AudioConverterNew returned -50
LOG  [SpeechRecognition] Stopping transcription...
LOG  [SpeechRecognition] Transcriber status: INACTIVE
```

No `[SpeechRecognition] Transcription received:` line ever appeared — `onTranscribe` never fired, so no result ever reached the UI.

**Commands used to diagnose:**

```bash
# Trace the actual native audio path whisper.rn's RealtimeTranscriber delegates to
grep -rn "LiveAudioStream\|AVAudioEngine\|AudioQueue" \
  node_modules/whisper.rn/lib/module/realtime-transcription/adapters/AudioPcmStreamAdapter.js

# Read the real native implementation directly — this is a compiled dependency,
# not something visible from JS-level reasoning
cat node_modules/@fugood/react-native-audio-pcm-stream/ios/RNLiveAudioStream.m
```

**What we found:** `RNLiveAudioStream.m`'s `start()` sets the `AVAudioSession` category (`.playAndRecord`) but never calls `session.setActive(true)`. `AudioQueueNewInput` is then created against an input hardware route that was never actually engaged, so it reads a zeroed/invalid `AudioStreamBasicDescription` (`0 ch`, `0 bits/channel`) — hence `AudioConverterNew status -50` on every buffer. This is a pure logic omission, not a Simulator-only artifact, which is consistent with it failing on real device too.

**Independent confirmation:** cloned [`cris-m/expo-whisper-app`](https://github.com/cris-m/expo-whisper-app) (a separate, more mature whisper.cpp-on-Expo project) to compare. Its `AudioBufferManager.swift` does exactly this, back to back, as a matter of course:

```swift
try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
```

An independent, more mature implementation treating `setActive` as mandatory is strong confirmation, not just a plausible guess.

**First fix attempted:** patched `RNLiveAudioStream.m` via `patch-package` to add the missing `setActive(true)` call. This is where it got worse, not better — see 2.2.

### 2.2 Symptom 2 — Heap corruption crash after the `setActive` fix

Applying the `setActive` fix didn't make the mic work — it made the app crash:

```
[AudioToolbox] AQMEIO_HAL.cpp:2942  Waiting for Stop to be signaled timed out. Forcing Stop.
[AudioToolbox] iOSSimulatorAudioDevice-42815-1: Abandoning I/O cycle because reconfig pending
[CoreAudio] HALC_ProxySystem.cpp:175  HALC_ProxySystem::GetObjectInfo: got an error from the server, Error: 560947818 (!obj)
```

**Commands used to get the real fault** (console noise alone doesn't show what actually crashed):

```bash
find ~/Library/Logs/DiagnosticReports -iname "*Vantage*" -newermt "-30 min"

python3 -c "
import json
with open('<path>.ips') as f:
    lines = f.read().split('\n', 1)
body = json.loads(lines[1])
print(body.get('exception'))       # {'type': 'EXC_CRASH', 'signal': 'SIGABRT'}
print(body.get('termination'))     # SIGNAL / Abort trap: 6
print(body.get('faultingThread'))  # which thread actually aborted
"
```

**What we found:** `EXC_CRASH` / `SIGABRT`, `malloc`'s own guard-page corruption detector (`nanov2_guard_corruption_detected`) tripping during an unrelated allocation (Reanimated's shadow-tree cloning) — the actual memory-safety violation happened earlier, in different code, and was only _detected_ wherever malloc's guard check next happened to run. The PID in the crash report matched the `iOSSimulatorAudioDevice-<pid>` string in the console log, confirming it was the same session.

The proximate cause: activating the session (correctly!) let the Simulator's virtual audio device actually attempt real I/O for the first time. Its `HandleInputBuffer` C callback in `RNLiveAudioStream.m` copies `inBuffer->mAudioDataByteSize` into an `NSData` with **no bounds check** against the buffer's real capacity — harmless while the queue was inert (before the fix), but a heap-corrupting over-read once the Simulator's flaky virtual device started actually delivering (and mid-teardown, sometimes inconsistent) buffers. **The correct fix uncovered a second, previously-unreachable bug.**

**Decision:** revert the `setActive` patch immediately (a crash is strictly worse than a silent no-op) and rebuild the audio-capture layer on a safer API rather than continuing to patch a fragile raw `AudioQueue Services` callback.

### 2.3 Options considered for the audio-capture architecture

| Option                                                                                     | Finding                                                                                                                                                                                                                                                                                                                 | Decision                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Upgrade `whisper.rn` 0.5.5 → 0.7.2                                                         | Verified directly against the `v0.7.2` tag: `AudioPcmStreamAdapter.ts` is unchanged and still wraps `@fugood/react-native-audio-pcm-stream@^1.1.4` — same missing `setActive`, same unbounded buffer callback, unfixed upstream in either package's newest release.                                                     | ❌ Rejected — absorbs a JSI-migration's risk for zero fix |
| Adopt `cris-m/expo-whisper-app` wholesale                                                  | Its `AVAudioEngine`-based capture is genuinely more robust, but the whole module means owning a full whisper.cpp binding with no upstream releases to lean on.                                                                                                                                                          | ❌ Rejected — overshoots the actual problem               |
| Patch `@fugood/react-native-audio-pcm-stream` further (add bounds check to the C callback) | Possible, but still built on the older `AudioQueue Services` C API that Apple no longer recommends for new work, and still a third-party dependency to keep re-patching.                                                                                                                                                | ❌ Rejected                                               |
| **Build a new local Expo module using `AVAudioEngine`**                                    | `RealtimeTranscriber`'s `audioStream` is a pluggable constructor dependency (confirmed via `whisper.rn`'s own `AudioStreamInterface` type) — no patching of `whisper.rn` or `@fugood`'s module required. `AVAudioPCMBuffer.frameLength` is authoritative by construction, so the equivalent buffer read can't over-run. | ✅ **Chosen** — `modules/expo-audio-tap/`                 |

**Implementation:** `modules/expo-audio-tap/ios/ExpoAudioTapModule.swift` — an Expo local module (autolinked via `use_expo_modules!`, already in `ios/Podfile`, no manual Podfile edits needed) using `AVAudioEngine.inputNode.installTap` + `AVAudioConverter`, with the `setActive(true)` call the original module was missing, plus the retry/silence-detection defensiveness borrowed from `cris-m`'s reference implementation. `packages/app-core/kokoro/adapters/IOSAudioTapAdapter.ts` implements whisper.rn's `AudioStreamInterface` around it and is injected into `RealtimeTranscriber` on iOS; Android is untouched (its `AudioRecord`-based capture in `@fugood`'s module never showed the same class of bug).

**Verification, not assumption:** `pod install` confirmed autolinking picked it up (`135→136` pods), then a full `xcodebuild` was run to actually compile it — the first attempt failed on an **unrelated** disk-space crisis (328MB free out of 233GB; traced with `du -sh` and fixed by clearing ~32GB of stale Xcode `DerivedData`), and the rerun succeeded, confirmed by checking the build output directly for `ExpoAudioTapModule.o` (both architectures) and `ExpoAudioTap.framework`, not just trusting `BUILD SUCCEEDED` in isolation.

### 2.4 Symptom 3 — A second, unrelated crash: two voice sessions at once

Repro: tap the inline `MicButton`, then tap the header `PixelOrb` (opening `VoiceScreen`) while the first is still listening.

Same diagnostic technique as 2.2 — pulled the fresh `.ips` crash report, matched its PID against the console log's `iOSSimulatorAudioDevice-<pid>` string. Same `SIGABRT` / `nanov2_guard_corruption_detected` signature, but this time detected on the **Hermes/JS thread** rather than the Reanimated thread — consistent with the same _class_ of bug (a real native memory-safety violation, detected wherever the allocator's guard check next fires), not the same specific line of code.

**What we found**, by reading the actual code rather than assuming:

```bash
grep -n "mic\|PixelOrb\|useSpeechRecognition\|useVoiceRecording" "app/(tabs)/home.jsx"
grep -n "visible\|isRendered\|_shouldShowModal" node_modules/react-native/Libraries/Modal/Modal.js
```

- `home.jsx` mounts its **own** `useSpeechRecognition()` instance for the inline `MicButton`.
- `VoiceScreen` is wrapped in `<Modal visible={showVoiceModal}>`. React Native's own `Modal.js` (`_shouldShowModal()` / `state.isRendered`) confirms children are not mounted until `visible` becomes `true` — so tapping the header `PixelOrb` is the exact moment a **second**, fully independent `useSpeechRecognition()` mounts and calls `initWhisper()` again.
- A third caller, `packages/app-core/hooks/useChatSpeech.js` (quiz/learn-mode hands-free flow), does the same thing.

None of the three had any "is the mic already in use" check. On iOS, all three independently wrapped the same singleton `ExpoAudioTapModule` — one shared `AVAudioEngine`, one shared `isTapRecording` flag, never designed for concurrent consumers. Two `whisper.cpp`/ggml contexts (each with its own Metal/Accelerate thread pool) initializing and running concurrently, both racing one singleton native module with no locking, is the plausible source of the heap corruption.

### 2.5 Options considered for the concurrency fix

| Option                                                                                         | Coverage                                                                                                                                                                                                            | Decision                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| UI-layer proxy check (e.g. `home.jsx` checks its own `showVoiceModal` boolean before starting) | Only guards one direction (inline mic vs. hands-free); doesn't cover `useChatSpeech.js`'s flow; duplicated logic if a fourth entry point is ever added.                                                             | Implemented as an interim stopgap, then superseded |
| A "mic busy" flag/lock at the `expo-audio-tap` native-module level only                        | Would prevent double-capture at the audio-tap layer, but **not** the other contended resource — `initWhisper()` runs independently of audio-tap start, so two `whisper.cpp` contexts could still load concurrently. | Kept, but as a backstop only (see below)           |
| **A single, app-wide singleton engine, all consumers as thin clients**                         | Structurally prevents the bug rather than reacting to it — see §3.                                                                                                                                                  | ✅ **Chosen**                                      |

## 3. Architecture — the long-term fix

```
   home.jsx MicButton        VoiceScreen (voice.jsx)       useChatSpeech.js (quiz mode)
        │                          │                                │
        └───────────────┬──────────┴───────────────┬────────────────┘
                         │  useSpeechRecognition()   │   (same hook, 3 independent call sites)
                         ▼                           ▼
              ┌────────────────────────────────────────────────┐
              │      SpeechRecognitionEngine (singleton)        │
              │  packages/app-core/hooks/speech/SpeechRecognitionEngine.native.js
              │                                                  │
              │  • warm()    — one cached whisper.cpp context,   │
              │                deduped across every consumer     │
              │  • acquire() — exclusive session; throws         │
              │                SpeechEngineBusyError if busy     │
              │  • release() — frees the session for the next    │
              │                consumer                          │
              └───────────────────┬──────────────────────────────┘
                                   ▼
                    one RealtimeTranscriber + one
                    IOSAudioTapAdapter → ExpoAudioTapModule
                    (native singleton, AVAudioEngine)
```

This mirrors the `MCPRegistry` singleton already established in this codebase (`packages/cognitive-brain/core/src/mcp/registry.ts` — session management + status subscriptions via `subscribe()`/`getMCPRegistry()`), applied to the same structural problem: a scarce, exclusive, device-wide resource that multiple independent screens want to use.

**Division of responsibility:**

- **`SpeechRecognitionEngine.native.js`** (new) — owns the shared `whisper.cpp` context (loaded once, cached for the app's lifetime) and enforces that only one realtime-transcription session exists at a time.
- **`useSpeechRecognition.native.js`** (rewritten) — thin per-consumer wrapper: registers its own `onResult`/`onError`/`onTimeout` callbacks with the engine, owns per-session UI feedback (ticking sound, countdown timer). **Public API unchanged** — `home.jsx`, `voice.jsx`, `useChatSpeech.js` needed no call-site signature changes.
- **`home.jsx` / `voice.jsx`** — both now check `err.code === 'SPEECH_ENGINE_BUSY'` in their `onError` callback and show a toast (`react-native-toast-notifications`, matching the existing convention elsewhere in the app): _"Pause or stop other voice chat before using this!"_ — symmetric in both directions, not just the originally-reported one.
- **`ExpoAudioTapModule.swift`** — `start()` now throws `AudioTapError.alreadyRecording` instead of silently no-op'ing on a double-start. This is a **backstop**, not the primary mechanism — with the JS-level engine in place, the native module should structurally never receive two concurrent `start()` calls, but if a future bug ever causes it to, this makes that loud (a catchable JS error) instead of silent (a caller believing it got the mic when it didn't).

```javascript
// The core exclusivity guarantee — SpeechRecognitionEngine.native.js
async acquire(consumerId, { locale, callbacks }) {
  if (this._session) {
    throw new SpeechEngineBusyError(this._session.consumerId);
  }
  const whisperContext = await this.warm();      // cached — real work only once
  if (this._session) {                            // re-check: another acquire() could
    throw new SpeechEngineBusyError(this._session.consumerId);  // have won the race during warm()
  }
  const audioStream = Platform.OS === 'ios' ? new IOSAudioTapAdapter() : new AudioPcmStreamAdapter();
  const transcriber = new RealtimeTranscriber({ whisperContext, audioStream, fs: RNFS }, { /* ... */ }, callbacks);
  this._session = { consumerId, transcriber, release: /* ... */ };
  return { transcriber, release: this._session.release };
}
```

## 4. UX decision: block-and-toast, not auto-handoff

Considered letting the second entry point automatically stop the first and take over the mic (seamless, no toast) versus the current behavior (block with a warning toast, user manually stops the other session first). **Chose block-and-toast, as the permanent design, not a stopgap:**

Auto-handoff would silently discard state the user may care about — `home.jsx`'s accumulated dictation text (`accumulatedVoiceRef`) or `voice.jsx`'s in-flight AI response/TTS (`isProcessing`, `orb.setThinking()`) would be killed with no chance to finish or recover. Given the whole incident was caused by _uncoordinated_ concurrent access, the fix intentionally keeps the coordination boundary simple and explicit — the user decides, nothing is silently lost.

## 5. Before / After — `app/(tabs)/home.jsx`

The inline `MicButton`'s hook call originally had no error channel at all — a busy engine (or any other `startListening` failure) had nowhere to surface. Two edits were made across this incident; the first (a proactive `showVoiceModal` check inside `handleVoiceInputToggle`) was later removed in favor of the second, more general fix once the engine's error code became available. What's below is the net original-vs-final diff.

**Before** — no `onError`, no toast import, no busy-state awareness:

```javascript
import PremiumStarBadge from '@/packages/ui-kit/common/PremiumStarBadge';
// (no toast import)

export default function ChatAIScreen() {
  // ...
  const [micHovered, setMicHovered] = useState(false);

  // Voice state — inline STT (MicButton) and hands-free modal (VoiceScreen)
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  // ...

  // Speech recognition — accumulated-ref pattern matches chat.jsx
  const { startListening, stopListening, isListening } = useSpeechRecognition({
    onResult: (text, isFinal) => {
      if (isFinal) {
        accumulatedVoiceRef.current = accumulatedVoiceRef.current
          ? accumulatedVoiceRef.current + ' ' + text
          : text;
      }
      const display = isFinal
        ? accumulatedVoiceRef.current
        : (accumulatedVoiceRef.current ? accumulatedVoiceRef.current + ' ' + text : text);
      setVoiceInputText(display);
    },
  });
```

Calling `startListening()` while `VoiceScreen` already held the engine would previously reach the (now-reverted) buggy audio-capture path directly, with nothing in `home.jsx` to catch or surface the conflict — the root cause of the crash in §2.4.

**After** — `onError` surfaces the engine's busy signal as a toast:

```javascript
import PremiumStarBadge from '@/packages/ui-kit/common/PremiumStarBadge';
import { useToast } from 'react-native-toast-notifications';

export default function ChatAIScreen() {
  // ...
  const [micHovered, setMicHovered] = useState(false);

  // Voice state — inline STT (MicButton) and hands-free modal (VoiceScreen)
  const toast = useToast();
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  // ...

  // Speech recognition — accumulated-ref pattern matches chat.jsx
  const { startListening, stopListening, isListening } = useSpeechRecognition({
    onResult: (text, isFinal) => {
      if (isFinal) {
        accumulatedVoiceRef.current = accumulatedVoiceRef.current
          ? accumulatedVoiceRef.current + ' ' + text
          : text;
      }
      const display = isFinal
        ? accumulatedVoiceRef.current
        : (accumulatedVoiceRef.current ? accumulatedVoiceRef.current + ' ' + text : text);
      setVoiceInputText(display);
    },
    // The shared SpeechRecognitionEngine only allows one active voice session app-wide
    // (see SpeechRecognitionEngine.native.js) — this fires if VoiceScreen or another
    // voice flow already holds it.
    onError: (err) => {
      if (err?.code === 'SPEECH_ENGINE_BUSY') {
        toast.show('Pause or stop other voice chat before using this!', { type: 'warning' });
      }
    },
  });
```

`handleVoiceInputToggle` itself (the tap handler that calls `startListening`) is unchanged — the interim `if (showVoiceModal) { ... return; }` guard that briefly lived there was removed once this `onError` path landed, since it only covered one direction (inline mic → hands-free) where the engine's error code covers both, for every current and future consumer.

`app/screens/voice.jsx` received the mirror-image change: same `useToast` import, same `err?.code === 'SPEECH_ENGINE_BUSY'` check added to its existing `onError` callback.

## 6. Files Changed

| File                                                               | Type      | Summary                                                                                                                                          |
| ------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/app-core/hooks/speech/SpeechRecognitionEngine.native.js` | New       | Singleton engine — cached whisper.cpp context, exclusive session `acquire()`/`release()`, `SpeechEngineBusyError`                                |
| `packages/app-core/hooks/speech/useSpeechRecognition.native.js`    | Rewritten | Thin per-consumer wrapper around the engine; same public API                                                                                     |
| `modules/expo-audio-tap/`                                          | New       | Local Expo module — `AVAudioEngine`-based mic tap replacing `@fugood/react-native-audio-pcm-stream`'s raw `AudioQueue` capture on iOS            |
| `packages/app-core/kokoro/adapters/IOSAudioTapAdapter.ts`          | New       | `AudioStreamInterface` implementation wrapping `expo-audio-tap`, injected into `RealtimeTranscriber` on iOS                                      |
| `app/(tabs)/home.jsx`                                              | Modified  | `onError` handler shows a toast on `SPEECH_ENGINE_BUSY`                                                                                          |
| `app/screens/voice.jsx`                                            | Modified  | Same `onError` handling, symmetric with `home.jsx`                                                                                               |
| `patches/@fugood+react-native-audio-pcm-stream+*.patch`            | Removed   | The `setActive` patch was reverted after it uncovered the heap-corruption bug in 2.2 — superseded by the `expo-audio-tap` rebuild, not reapplied |

## 7. Further hardening (docs/debugWhisper.md, docs/Native_SpeechFlowAnalysis.md, docs/OGAM.md)

Two later investigations picked up where §1–6 left off — one chased a second
crash class and a "no transcript ever generated" bug all the way through the
native audio tap into whisper.rn itself (`docs/debugWhisper.md`), the other
compared this app's whole STT/TTS/session-ownership design against three
external references and traced a downstream LLM-response bug that looked
speech-related but wasn't (`docs/Native_SpeechFlowAnalysis.md`). This section
summarizes both plus the OGAM prior-art review (`docs/OGAM.md`), and closes
with a consolidated improvements list. Read the three source docs for full
diagnostic detail (crash logs, patch diffs, CDP-driving mechanics); this
section only records outcomes and what's still open.

### 7.1 Fixes landed since §6

Beyond the singleton-engine fix in §3, the following were found and fixed on
real hardware (full detail in `docs/debugWhisper.md`):

- **`IOSAudioTapAdapter` start/stop race** leaking the native `isTapRecording`
  flag when `stop()` ran while a `start()` was still in flight — fixed by
  tracking the in-flight start as an awaited promise.
- **Timeout countdown armed before the mic actually started** — could fire
  `stopListening()` mid-start, hitting the race above. Fixed by moving
  countdown setup to after `transcriber.start()` resolves.
- **Mic left running through AI processing + TTS playback** in `voice.jsx` —
  fixed by calling `stopListening()` as soon as an utterance is final, before
  `processVoiceInput`/TTS.
- **Heap corruption from a stale tap callback + an `AVAudioConverterInputBlock`
  contract violation** in `ExpoAudioTapModule.swift`'s `process()` — a
  `captureGeneration` token (checked lock-free on the real-time audio thread)
  plus correct `.noDataNow`/`nil` handling on repeat converter input-block
  calls.
- **Crash-on-load regression** from an unsynchronized route-change/
  configuration-change recovery handler — fixed with a serial `DispatchQueue`
  around all setup/teardown mutation, keeping `process()` itself lock-free.
- **A native listener leak**: `SpeechRecognitionEngine.native.js`'s `release`
  called `transcriber.stop()` instead of `.release()`, so every session's 4
  native event subscriptions (`onData`/`onError`/`onStatusChange`/`onDebug`)
  stayed registered forever. Fixed by calling `.release()`.
- **The real "no transcript" root cause**: `whisperContext.transcribeData()`'s
  `ArrayBuffer`/JSI path hangs forever on real hardware; forcing the base64
  bridge path fixed the hang, but that path expects **float32** PCM, not the
  int16 PCM the tap produces — feeding it raw int16 bytes produced confident,
  fully hallucinated transcripts (`"sitting on a throne."`) rather than an
  error. Fixed by converting int16 → normalized float32 before base64-encoding.
  Persisted via `patches/whisper.rn+0.5.5.patch` (whisper.rn's
  `RealtimeTranscriber.js` lives in gitignored `node_modules/`).
- **Route-change recovery was wired to the wrong notification** —
  `AVAudioEngineConfigurationChangeNotification` was handled, but the
  notification actually firing mid-session was
  `AVAudioSession.routeChangeNotification`. Fixed by routing it to the same
  recovery path, then fixing `reinstallTapLocked()` itself, which logged
  success but never resumed delivery because it only called `engine.start()`
  when `!engine.isRunning` — always false when recovering an _active_ session.
  Now always `pause()` → reinstall → `prepare()` + `start()`.
- **Whisper hallucinating bracketed captions** (`"(upbeat music)"`) on silence
  — mitigated (not root-fixed) with a regex filter; the real fix is VAD (§7.4).

All of the above diagnostic instrumentation (`#if DEBUG` in
`ExpoAudioTapModule.swift`, `if (__DEV__)` in `IOSAudioTapAdapter.ts` and the
patched `RealtimeTranscriber.js`, `global.__router`/`global.__homeMicTap` dev
hooks) is **kept in the codebase intentionally**, not stripped — native
audio/speech bugs proved hard enough to reproduce on demand that the same
visibility will be needed again, especially for VAD work.

### 7.2 Downstream bug: STT worked, but the AI response pipeline was broken

A separate investigation (`docs/Native_SpeechFlowAnalysis.md` §7–§9) found
that once STT was fixed, `voice.jsx` still produced no AI response — a bug
entirely downstream of speech, in `ChatModeOrchestrator.native.ts` /
`LlamaService.native.ts`. Chain of root causes, each masking the next:

1. `ChatModeOrchestrator.native.ts#handleTextMessage()` had no `callbacks`
   parameter at all (unlike its web equivalent), so streamed tokens never
   reached `voice.jsx`'s `onData`/`onComplete`.
2. Once streaming was wired up, responses rendered as the literal string
   `<end_of_utterance>` — `generateCompletion()`/`generateCompletionWithImages()`
   hardcoded DeepSeek's stop token as the only default, not SmolVLM's actual
   one.
3. Fixing the stop token produced silence — `generateCompletionWithImages()`
   unconditionally prepended vision-analysis instructions to the first user
   message even with zero images, self-contradicting a small model into
   producing nothing.
4. Native turned out to have **four** separate context-holding objects
   (`LlamaService.context`, `LlamaService.visionContext`,
   `ChatModeOrchestrator.llmAdapter` (a separate `LlamaLlm` instance),
   `ChatModeOrchestrator`'s own duplicate `visionContext` field) where web has
   one (`this.currentEngine`). The duplicate `visionContext` field was
   eliminated; `LlamaService.native.ts` is now the single source of truth for
   vision-model state. `llmAdapter`/`LlamaLlm` retiring the same way is
   deferred as its own effort (§7.5).
5. A separate, small model (SmolVLM-256M, a _vision_ model pressed into
   service as the default text/persona model) was found reciting its own
   system prompt back as its answer rather than role-playing the persona —
   a model-capability ceiling, not a bug; `MODEL_REGISTRY` already lists
   larger dedicated text-instruct models sized for this.
6. Alongside that, character personas (stored as `Skill` records tagged
   `character-persona`) were found eligible as `detectSkill()` candidates,
   so a message matching the _active_ persona's own tags could get that
   persona's instructions appended a second time to an already-small prompt.
   Fixed via `excludeCharacterSkills()`.

### 7.3 OGAM prior art (`docs/OGAM.md`, `docs/Native_SpeechFlowAnalysis.md` §2)

`off-grid-ai/OGAM` is a mature (2.9k★), shipped app on the same stack
(`whisper.rn` + `llama.rn`, GGUF/SmolVLM, Metal). Two takeaways adopted into
this doc's thinking:

- Its `patches/whisper.rn+0.5.5.patch` fixes **Android-only** native race
  conditions in whisper.rn's realtime pipeline (a double-run guard on
  `finishRealtimeTranscribe()`, `release()` joining background handler
  threads before freeing the native context, a null-pointer guard for an
  already-removed job) — independent confirmation that whisper.rn's
  `stop()`/`release()` lifecycle has genuine native races, the same category
  as this doc's own fixes. Its iOS-side equivalent has not been specifically
  re-audited (open item, §7.6).
- Its `src/services/audioSessionManager.ts` centralizes **every**
  `AVAudioSession` transition between STT and TTS behind one serialized
  queue, with `ensureRecording()`/`ensurePlayback()`/
  `restorePlaybackAfterRecording()` — each side asserts the state it needs,
  right when it needs it, rather than one side guessing what to leave behind
  for the other. This app's own session-handoff bug (silent/inaudible TTS
  right after STT, root-caused to `stopCaptureLocked()` never deactivating
  the `.measurement`-mode session) was fixed the same _shape_ —
  `ExpoSpeechEngine.speak()` now asserts a playback-ready session via
  `expo-audio`'s `setAudioModeAsync()` right before speaking — but without
  OGAM's shared serialization queue. Fine for today's strictly sequential
  STT-then-TTS flow; not race-safe if STT and TTS are ever triggered close
  together. See §7.6, item 1.
- OGAM uses `.maestro/` for UI-automation E2E testing — the tooling this
  investigation lacked (no `idb`/`maestro`/`detox` available); installation
  was completed (`brew install openjdk`, the Maestro installer,
  `idb-companion` for Simulator control) but no flow file has been written
  yet.

### 7.4 VAD — deliberately deferred, but scoped

Enabling real VAD (`RealtimeTranscriber`'s `vadContext`, never supplied
today) is the actual fix for the hallucination-on-silence mitigation in §7.1
and would replace the current fixed ~0.5s slicing with real speech-end-based
slicing. **Full design: `docs/designVAD.md`** — model sourcing (the exact
Hugging Face repo/file, `ggml-org/whisper-vad`'s `ggml-silero-v6.2.0.bin`),
the `vadPreset`/`vadOptions` tuning table read directly from whisper.rn's
source, the wiring change to `SpeechRecognitionEngine.native.js`'s
`acquire()`, and a concrete rollout/test plan reusing the harness in §8.3.
Summary of that doc's key points, scoped but not implemented:

1. Needs a new bundled Silero VAD GGML model asset.
2. `WhisperVadContext.detectSpeechData()` has the same `ArrayBuffer`(JSI)
   vs. base64(bridge) split as `transcribeData()` — very likely hits the same
   hang, and the same "verify the expected sample format, don't assume"
   lesson applies. `docs/designVAD.md` §5 has the proactive patch to land
   _before_ first on-device test, rather than rediscovering the hang the
   hard way a second time.
3. Use the existing persistent-MMKV + CDP debug trail from the start rather
   than rebuilding it.
4. Revisit whisper.rn's own `accumulateAudioData()` units bug (compares a
   byte count against a sample-count threshold, so slices trigger at ~0.5s
   not the intended 1s) alongside VAD, since VAD's timing options interact
   with it.
5. Android is completely unverified for either the original JSI-hang bug or
   its fix — everything found so far is iPhone X/iOS 16.7 specific.

### 7.5 Kokoro TTS — now wired, phonemization still open

A later session (`docs/Native_SpeechFlowAnalysis.md` §10) fully wired the
previously-stubbed "Kokoro" toggle in `voice.jsx`, bundling a default ~88MB
quantized model and adding a settings-screen picker. It surfaced two real
bugs in code this doc had previously assumed was "fully functional but
orphaned": native playback was never actually implemented (a `setInterval`
faking timing, no real audio-output call), and the ONNX feed used the wrong
input tensor name (`tokens` instead of `input_ids`), meaning every prior run
had silently fallen back to a sine-wave mock. Both fixed, along with sourcing
the model from a verified-public repo after the originally-hardcoded
HuggingFace source started returning `401`. **Still open:** real
grapheme-to-phoneme conversion — the app's hand-rolled `Phonemizer` doesn't
produce anything resembling the model's real IPA vocabulary, so output is
expected to be unintelligible even though inference now runs correctly.
Deliberately out of scope for that session; tracked in
`assets/models/kokoro/README.md`.

### 7.6 Consolidated list of improvements to incorporate

**Audio session ownership**

1. Port OGAM's serialized `AudioSessionManager` pattern (§7.3) — today's fix
   has STT and TTS each assert state independently with no shared
   serialization; fine for the current sequential flow, not race-safe if a
   future change lets STT/TTS trigger close together.
2. Add `.mixWithOthers` to `ExpoAudioTapModule.swift`'s `AVAudioSession`
   options — an untested native-level candidate for the mic+TTS-overlap
   crash hypothesis, independently corroborated by external prior art.
3. Evaluate `react-native-audio-api`'s `AudioManager` as a maintained
   replacement for the hand-rolled session/interruption/route-change
   handling — as its own scoped spike, not folded into a routine change;
   keep `ExpoAudioTapModule.swift`'s mic tap as-is until that spike proves
   out.

**Open crash/reliability hypotheses** 4. Test Variation C's GPU/CPU decode toggle with real speech to rule in/out
a ggml Metal-backend issue on older hardware (iPhone X/A11). 5. Audit whisper.rn's iOS-native `stop()`/`release()` for the same
in-flight-job race OGAM's Android patch fixed (§7.3) — not yet
specifically re-checked on iOS. 6. Root-cause the recurring "Download already in progress" model-auto-load
error (seen twice, never fixed). 7. Rule out Jetsam `SIGKILL` from concurrent model contexts (vision + whisper)
on lower-RAM devices.

**VAD** — see §7.4 in full; the single biggest lever against hallucinated
transcripts and fixed-interval slicing latency.

**Model selection** 8. Offer a user-selectable STT model catalog (OGAM ships 10, tiny→large-v3)
instead of the single hardcoded `ggml-tiny.en.bin`. 9. **Done (2026-09-11), superseded (2026-09-11, later same day):** stopped
defaulting voice/text chat to SmolVLM-256M-Instruct — first by leading
`app.config.js`'s `defaultNativeModels` with `Qwen2-VL-2B-Instruct-Q4_K_M.gguf`
(the app owner's explicit call, over this doc's initial suggestion, chosen
for staying vision-capable at ~8x SmolVLM's parameter count for persona
reliability, and over the larger `Qwen2.5-VL-3B-Instruct` for its smaller
~1.7GB download), **then replaced the same day** by `Qwen3.5-2B-Q4_K_M.gguf`
(1.28GB + 668MB `mmproj-F16`, `recommended: true` in `MODEL_REGISTRY`) —
confirmed current: `defaultNativeModels` is now
`"Qwen3.5-2B-Q4_K_M.gguf,gemma-3-270m-it-Q4_K_M.gguf,Qwen3-0.6B-Q8_0.gguf,
   SmolVLM-256M-Instruct-Q8_0.gguf,gemma-4-E2B-it-Q4_K_M.gguf,
   Llama-3.2-1B-Instruct-Q4_K_M.gguf"`. Landed alongside an `llama.rn`
`^0.12.6` → `^0.12.9` bump specifically chosen to post-date upstream
`cui-llama.rn`/llama.cpp fixes for Qwen3.5 multimodal (mtmd) loading _and_
a Hexagon-NPU crash (full detail:
`docs/LLM-Model/OGAM-vs-GuideAxon-LlamaRN-Comparison.md` §2.7/end). **Not
yet verified on-device** — the same commit that made this change flagged
"an actual on-device load test of Qwen3.5-2B (per the earlier Hexagon-NPU
crash history)" as the next required step before shipping; added to the
§7.7 on-device checklist below. `Qwen3-0.6B-Q8_0.gguf` and
`SmolVLM-256M-Instruct-Q8_0.gguf` remain further down the list as
confirmed-loadable fallbacks. See `docs/LLM-Model/ModelLoadingLogic.md`.

**Native LLM plumbing** 10. **Done (2026-09-11):** retired `LlamaLlm`/`llmAdapter` (§7.2 item 4) —
`LlamaLlm.ts` itself is deleted from the codebase (confirmed: no longer
exists anywhere under `packages/`). Plain-text models now load through
`LlamaService.native.ts`'s own `initializeModel()` (`this.context`),
matching web's single-engine shape. **Current names, for anyone
searching the code by the old ones:** `ChatModeOrchestrator.native.ts`'s
`llmAdapter` field is renamed `appleIntelligenceAdapter` and now holds
_only_ that backend (confirmed in code); every old `!this.llmAdapter`
check is replaced by a new `hasActiveTextModel()` method, and plain-text
generation goes through a new `generateText()` method — both confirmed
present and in active use across `loadForMode`/`handleTextMessage`/
`handleAgenticMessage`/`handleRAGMessage`/`switchModel`/`initializeModel`/
`cleanup`/`initBrainEngine`. `LlamaService.native.ts` gained a matching
`unloadTextModel()`. The two blockers a first attempt found (native's
`generateCompletion()` silently dropping the caller's system message;
`llmAdapter` also holding an unrelated Apple Intelligence adapter) were
both fixed rather than worked around — see
`docs/Native_SpeechFlowAnalysis.md` §7.7 for the full before/after.
**Implemented on Windows — needs real on-device testing**
(persona/skill/memory context reaching the model, vision↔text mode
switching, Apple Intelligence on iOS 26+) before merging with confidence;
`npx tsc --noEmit` confirms no new type errors, nothing more. 11. Add a way to selectively delete/clear memory entries (`IBrainEngine` has
no `delete`/`clear`) — needed to purge entries contaminated during the
period the `<end_of_utterance>` bug was live; a full reinstall is
currently the only reset. 12. Audit new model-loading branches against every field `getState()`
exposes rather than just the ones that branch's author needed — the
`SettingsModal` stale-`modelName` bug (§9 of
`docs/Native_SpeechFlowAnalysis.md`) is the same "vision model loaded
through a different path than plain text" gap recurring a third time.

**Kokoro TTS** 13. Implement real phonemization (G2P) — the single largest remaining
blocker to intelligible bundled-voice output (§7.5). 14. Reconcile the three now-live Kokoro consumers (`voice.jsx`,
`voice-kokoro.jsx`, `ChatWindow.tsx`) — the latter two remain orphaned
from navigation. 15. Fix `OrbSpeechAdapter.speak()` bypassing `useSpeech()`'s `engineRef`/state
tracking, so `voice.jsx`'s Stop button reliably stops TTS started via
`onComplete`.

**Cleanup** 16. Remove dead code: `packages/app-core/hooks/speech/useSpeechRecognition.js` (unreachable
third STT variant) and the stray `useSpeechRecognition.native.txt`. 17. Move `.ips` crash logs out of `docs/` once analyzed — large and
device-specific, not meant to live in the repo long-term.

**Tooling** 18. Write the first Maestro flow (installation already complete, §7.3) to
push through the two system dialogs CDP driving cannot: the Speech
Recognition permission prompt and `simctl openurl`'s confirmation dialog.

### 7.7 Status update (2026-09-11) and what's pending on macOS

Items #1, #2, #8, #9, #10, #11, #12, #15, #16, #17 above are now implemented
(JS/TS + one Swift line) as of this session:

- **#9** — `defaultNativeModels` reordered; see `docs/LLM-Model/ModelLoadingLogic.md`.
- **#8** — STT model catalog: `whisperModels.ts`, `sttSettings.ts`,
  `app/screens/stt-models.jsx`.
- **#1/#2** — `AudioSessionManager.ts` (new) + `.mixWithOthers` added to
  `ExpoAudioTapModule.swift`. **The only Swift/native change in this session** —
  everything else below is pure JS/TS.
- **#11/#12** — confirmed already fixed in the codebase (`excludeCharacterSkills`,
  `loadVisionModel()`'s `modelName` sync) — no new work needed.
- **#15** — `voice.jsx` now speaks through `useSpeech()`'s own `speak()` instead
  of a separate `createOrbSpeechAdapter` instance.
- **#16/#17** — dead `useSpeechRecognition.js`/`.native.txt` removed; no
  committed `.ips` logs existed to move.
- **#10** — `LlamaLlm`/`llmAdapter` retired, both blockers a first attempt
  found (native `generateCompletion()` dropping the caller's system message;
  `llmAdapter` also holding an Apple Intelligence adapter) fixed rather than
  worked around. Pure JS/TS — no Swift/native rebuild needed, but still needs
  real app-runtime testing (see the pending list below). See
  `docs/Native_SpeechFlowAnalysis.md` §7.7 for the full before/after.
- **#3, #4–7, VAD (§7.4), #13, #14, #18** — not attempted; #14 left alone per
  an explicit decision (orphaned Kokoro screens kept as-is, not deleted or wired).

**This session ran entirely on a Windows machine — nothing native/iOS was
built, linked, or run.** Everything below needs a macOS + Xcode environment
before it can be trusted, in rough order of what to check first. Items 1–3 are
the genuinely **Swift/native-side** pending work (require a real
`pod install`/`xcodebuild`/device or Simulator run); item 6 (`LlamaLlm`
retirement) is pure JS/TS — no native rebuild needed, just a real app run —
listed here because it still needs on-device/runtime verification before
trusting it, not because it touches Swift:

1. **Does it even build.** `pod install` + a real `xcodebuild` (or
   `npx expo run:ios`) has not been run since the `.mixWithOthers` addition to
   `ExpoAudioTapModule.swift` (marked in-line in that file). Confirm it
   compiles and links before anything else. **Update (2026-09-12): see §7.8
   — two real blockers found and fixed (an Intel-Mac Simulator ABI mismatch,
   a Metro `blockList` bug breaking Expo Router), `pod install`/prebuild
   evidence looks clean, but a full `xcodebuild`/app-launch success is
   still unconfirmed and the fixes are uncommitted.**
2. **`AudioSessionManager` end-to-end, on real hardware, not just the
   Simulator** (this codebase's own history — `docs/debugWhisper.md`'s
   Simulator-vs-device divergence — is explicit that Simulator audio is
   unreliable for this class of change): a full STT→TTS cycle, TTS with no
   preceding STT, back-to-back STT sessions, and STT immediately re-triggered
   right after TTS. Watch specifically for whether `.mixWithOthers` changes
   any route-change/interruption recovery timing (`reinstallTapLocked()`,
   unmodified but downstream of the option change).
3. **The still-open native crash hypotheses** (§ this file's earlier "Status"
   history, and `docs/debugWhisper.md`'s Status section): mic+TTS overlap
   with the new `.mixWithOthers` option in place (hypothesis 1), the GPU/CPU
   decode toggle on the test page's Variation C with real speech input
   (hypothesis 3), memory pressure from concurrent model contexts on
   lower-RAM devices (hypothesis 4), and whisper.rn's iOS-native
   `stop()`/`release()` lifecycle for an in-flight-job race analogous to
   OGAM's Android patch (hypothesis 5).
4. **The new STT model catalog's non-bundled downloads** (`whisperModels.ts`):
   confirm the `ggerganov/whisper.cpp` HuggingFace `resolve/main/*.bin` URLs
   for `ggml-base.en.bin`/`ggml-small.en.bin`/`ggml-tiny.bin` actually resolve
   and download correctly, and that whisper.rn loads each without issue
   (context size/memory, and whether the multilingual `ggml-tiny.bin` needs a
   non-`'en'` `transcribeOptions.language` wired in somewhere — not currently
   done, out of scope for this pass).
5. **VAD (§7.4)** and **Maestro flow authoring (#18)** — both explicitly need
   a Mac (Xcode build for VAD's native testing; `idb-companion` + Simulator
   for Maestro) and were not attempted at all this session.
6. **`LlamaLlm` retirement (#10) — JS/TS only, no Swift/native rebuild
   required, but untested at runtime.** Verify: plain text chat with a
   non-vision GGUF model loaded (confirm persona/active-skill/memory context
   now actually reaches the model — the main behavior change from
   blocker-1's fix); vision chat via `switchMode('vision')` unaffected;
   switching between a vision-flagged default model and a plain text model;
   `handleAgenticMessage()`/RAG mode with a plain-text model loaded; an Apple
   Intelligence-eligible device (iOS 26+) still routes correctly and unloads
   correctly when a GGUF model is explicitly switched to. See
   `docs/Native_SpeechFlowAnalysis.md` §7.7 for the full verification list.
7. **New since the above (§7.6 item #9): `Qwen3.5-2B-Q4_K_M.gguf` as the new
   default `defaultNativeModels` entry has never been loaded on a real
   device.** The commit that made it the default explicitly flagged this as
   its own required next step, citing "the earlier Hexagon-NPU crash
   history" (`docs/LLM-Model/OGAM-vs-GuideAxon-LlamaRN-Comparison.md`
   §2.7/end) as the specific risk `llama.rn ^0.12.9` is meant to have fixed —
   confirm a real load-and-generate cycle actually succeeds on both Android
   (Hexagon NPU / HTP path) and iOS before trusting this default in
   production, not just that `npm install` completed cleanly.

### 7.8 Native build toolchain — two blockers found and fixed, uncommitted (2026-09-12)

A later session picked up item 1 above ("does it even build") and got
further, but the honest answer is still not a confirmed yes — two real
blockers were found and fixed at the toolchain level; nothing in the
working tree shows an actual `xcodebuild`/`expo run:ios` completing
end-to-end or the app launching since. Recorded here because both fixes
touch exactly the resolution machinery §8.2 already flags as fragile (the
deep-relative-path `whisper.rn` import, `whisper.rn`'s own package
exports) — this is now the authoritative account of that interaction, and
that section should be read alongside this one.

**Blocker 1 — iOS Simulator link failure, machine-specific, not caused by
this doc's changes.** The dev Mac is genuinely Intel (x86_64, confirmed via
`uname -m`), and React Native 0.86's `React-Core-prebuilt` binary
distribution ships an x86_64 Simulator slice missing the out-of-line
`facebook::react::Sealable::Sealable()` constructor symbol (confirmed via
`nm` on the extracted slice — RTTI symbols exist, the constructor itself
was inlined away when that slice was built). Expo's locally-compiled
`ExpoFabricViewObjC.o` expects that symbol out-of-line, so linking fails
only on x86_64 — arm64 (real-device) builds are unaffected, so this never
blocked the §8.3 on-device harness, only Simulator runs. **Fix:**
`ios/Podfile.properties.json`'s `"ios.buildReactNativeFromSource"` is now
`"true"` — `ios/Podfile:17-18` already read this flag and skip
`React-Core-prebuilt` entirely, compiling RN Core from source instead.
Slower iOS builds, but eliminates the ABI mismatch. Not yet added to
§6/§7.6 as a Files Changed entry — do that once a full build is confirmed
working.

**Blocker 2 — Metro's native `blockList` broke Expo Router resolution.**
Attempting a native build with the fix above surfaced a second, unrelated
bug: `metro.config.Native.js`'s (and, since the two were reconciled during
the same session, `metro.config.js`'s) `blockList` entries for `scripts/`,
`dist/`, `build/`, `tasks/` were unanchored regexes (`/scripts\/.*/` etc.)
— matching not just this repo's own directories but any dependency
shipping compiled output under those names, including
`node_modules/expo-router/build/qualified-entry.js`. Blocking Expo
Router's own entry point breaks routing entirely under the native config.
**Fix:** all four regexes are now anchored against `node_modules`
(`/^(?!.*\/node_modules\/).*\/scripts\/.*/` and the equivalent for the
other three), mirroring the anchoring already used for the `test-` prefix
rule elsewhere in the same file.

**A third, connected change — `unstable_enablePackageExports` is now
platform-conditional** (`config.resolver.unstable_enablePackageExports`),
`true` only for `platform === 'web'`, where it was previously
unconditionally `true` for every platform (per that file's own RPToDo
comment, added to fix a Firebase Auth entrypoint bug under Metro's strict
`exports` resolution). Turning it off for native makes one chunk of
`patches/whisper.rn+0.5.5.patch` unnecessary: the working copy of that
patch file has already dropped the part that added a root `"."` entry to
`whisper.rn/package.json`'s own `exports` field (confirmed via `git diff`
against the committed version — only the `RealtimeTranscriber.js` fixes
from §7.1 remain). **That `"."`-exports patch chunk was never documented
anywhere in this doc, §6, or `docs/debugWhisper.md`**, despite being
present in the committed patch as of §7's last update — it was very
likely the thing making `SpeechRecognitionEngine.native.js`'s bare
`import { initWhisper } from 'whisper.rn'` (§8.2) resolve correctly under
package-exports-strict resolution in the first place. Moot as long as
native package-exports stays off; but if it's ever re-enabled for native,
that patch chunk (or an equivalent) needs to come back — this is now an
implicit dependency between two unrelated-looking files that wasn't
written down anywhere until now.

**Evidence this got further than before, not proof it fully works:**
`ios/Podfile.lock` and `ios/vantage.xcodeproj/project.pbxproj` are both
substantially regenerated in the working tree (2,011 and 262 lines
changed respectively) with `ExpoAudioTap` (the module from §2.3),
`llama-rn` (the `0.12.9` pinned in §7.6 item 9), and `whisper-rn` all
present and resolving — consistent with a `pod install`/`expo prebuild`
completing cleanly. **All of this is currently uncommitted.** Nothing in
the working tree shows the subsequent `xcodebuild`/`npx expo run:ios`
step completing, the app actually launching, or any STT/TTS exercise
since these fixes landed — no new entries in `docs/debugWhisper.md`, no
changes to `app/test-whisper-tts.jsx` or any speech source file itself, no
fresh `.ips` crash reports. **§7.7 item 1 is further along than "not
attempted," but still not "confirmed."** Re-run the §8.3 harness once a
full build succeeds, and commit the `Podfile.lock`/`project.pbxproj`/
`Podfile.properties.json` changes once verified — right now a `git status`
check before trusting any of this is not optional, it's the only way to
know whether the build state described here is still present.

## 8. How to test this

Short answer: **there is no automated test that exercises real speech
logic today.** Everything below documents exactly what exists (so it isn't
mistaken for coverage it doesn't provide), the one thing that has actually
verified real on-device behavior throughout §2–§7, and a concrete path to
real automated tests if that's ever prioritized.

**Re-verified 2026-09-12, unchanged:** §8.1's mocks (`home.test.jsx`),
§8.2's mocks (`jest.setup.js`) and the deep-relative-path import they miss
(`SpeechRecognitionEngine.native.js` line 65), and §8.3's harness (the test
screen, `cdp-drive.js`, the MMKV debug trail) were all re-checked directly
against the current working tree, not just re-read — no drift, no new
speech-related test file exists anywhere in the repo (`.maestro/` still
doesn't exist; no flow file has been written), and the `git status` above
turned up nothing under any speech-source path. The one thing that _did_
change is upstream of all of this: §7.8 documents two native-build
blockers found and fixed since §7.7 — until a full `xcodebuild`/app launch
is confirmed working again, §8.3's harness cannot actually be run on this
machine to re-verify anything below.

### 8.1 What `npm test` actually covers — mocked away, not tested

The only test file that touches speech at all is
`app/(tabs)/__tests__/home.test.jsx`, and it stubs the entire speech stack
out rather than exercising it:

```js
jest.mock('@/packages/ui-kit/buttons/MicButton', () => () => null)
jest.mock('@/app/screens/voice', () => () => null)
jest.mock('@/packages/app-core/hooks/speech/useSpeechRecognition', () => ({
    useSpeechRecognition: () => ({
        startListening: jest.fn(),
        stopListening: jest.fn(),
        isListening: false,
    }),
}))
```

Run it with:

```bash
npx jest "app/(tabs)/__tests__/home.test.jsx"
```

This confirms `home.jsx` renders without crashing while speech is a no-op —
it exercises **zero** logic in `useSpeechRecognition.native.js`,
`SpeechRecognitionEngine.native.js`, `IOSAudioTapAdapter.ts`,
`AudioSessionManager.ts`, `ExpoAudioTapModule.swift`, or the patched
`RealtimeTranscriber.js`. No other file in the repo's `.test.*`/`.spec.*`
suite (Jest or Playwright) mentions speech, whisper, VAD, or STT at all —
confirmed by grepping the whole tree, not assumed.

### 8.2 Partial mock infrastructure already exists, but doesn't reach this code — know the gap before relying on it

`jest.setup.js` already carries generic mocks that _look_ like they'd cover
whisper.rn:

```js
jest.mock('whisper.rn', () => require('./__mocks__/whisper.rn'))
jest.mock(
    'whisper.rn/realtime-transcription',
    () => ({
        RealtimeTranscriber: require('./__mocks__/whisper.rn').RealtimeTranscriber,
    }),
    { virtual: true }
)
jest.mock(
    'whisper.rn/realtime-transcription/adapters',
    () => ({
        AudioPcmStreamAdapter: jest
            .fn()
            .mockImplementation(() => ({ start: jest.fn(), stop: jest.fn() })),
    }),
    { virtual: true }
)
jest.mock('expo-asset', () => ({
    Asset: { fromModule: () => ({ downloadAsync: jest.fn(), uri: 'test.mp3' }) },
}))
```

**These only partially apply, and the gap matters:**

- `jest.mock('whisper.rn', ...)` _does_ cover
  `SpeechRecognitionEngine.native.js`'s `import { initWhisper } from
'whisper.rn'` (a bare module specifier) — `initWhisper()` would be safely
  mocked in a test.
- `jest.mock('whisper.rn/realtime-transcription', ..., { virtual: true })`
  does **not** cover it. `SpeechRecognitionEngine.native.js` imports
  `RealtimeTranscriber` via a **deep relative path straight into the real,
  patched file**:
    ```js
    import { RealtimeTranscriber } from '../../../../node_modules/whisper.rn/lib/module/realtime-transcription'
    ```
    A `jest.mock()` on the specifier `'whisper.rn/realtime-transcription'`
    (marked `virtual: true` precisely _because_ the installed package doesn't
    ship that subpath as a real, resolvable file) does not intercept a
    different import specifier that resolves to a real file on disk. Import
    `SpeechRecognitionEngine.native.js` in a test today and you get the
    **real** patched `RealtimeTranscriber.js` (§7.1, `patches/whisper.rn+0.5.5.patch`),
    not a mock — which then tries to construct a real `whisperContext`/
    `audioStream` and will not behave under Jest/Node the way it does on a
    real device.
- **`modules/expo-audio-tap` (the native `ExpoAudioTap` module
  `IOSAudioTapAdapter.ts` wraps) has no Jest mock at all.** `acquire()`
  constructs `Platform.OS === 'ios' ? new IOSAudioTapAdapter() : new
AudioPcmStreamAdapter()` — under `jest-expo`'s default test platform,
  that's the iOS branch, which touches a real native module Jest can't
  execute.

**Net effect: don't assume these mocks make `SpeechRecognitionEngine.native.js`
or `useSpeechRecognition.native.js` safely testable as-is — verify by
running the specific test you're adding, not by reading the mock list and
extrapolating.** §8.4 below lays out what would need to be added to close
this gap for real.

### 8.3 The only thing that has actually verified real speech behavior: the manual on-device harness

Every fix in §2–§7 was verified this way, not via `npm test`. This is the
harness to reach for right now if you need to confirm real speech behavior
works — full mechanics in `docs/debugWhisper.md`'s "How the testing was
automated" section; summarized here for direct use:

1. **The test screen** — `app/test-whisper-tts.jsx` (linked from Settings →
   🎙️ Whisper STT / TTS Tests, tester-gated), with three isolated
   variations (Whisper realtime — the shared production engine; OS Speech
   Recognition; Whisper record-then-transcribe with a GPU/CPU toggle) plus a
   shared TTS section (`expo-speech` and Kokoro engines) for exercising the
   mic+TTS overlap directly.
2. **Drive it without physically tapping**, over CDP — the same tooling
   this whole investigation was built on (`scripts/cdp-drive.js`, still in
   the repo):
    ```bash
    curl -s http://localhost:8081/status                 # confirm Metro is up
    npx expo run:ios --device <udid>                      # build+install+launch on a real device
    curl -s http://localhost:8081/json/list | python3 -m json.tool   # find the CDP target
    node scripts/cdp-drive.js --ws "<webSocketDebuggerUrl>" \
      --eval "globalThis.__router.push('/test-whisper-tts')" --delay 3000 \
      --eval "globalThis.whisperTest.startWhisperRealtime()" --duration 15000
    ```
    `global.whisperTest` (`__DEV__`-only, exposed by the test screen itself)
    and `global.__router` (`__DEV__`-only, in `app/_layout.jsx`) are both
    still in the codebase specifically so this keeps working without a
    rebuild.
3. **Read back diagnostic output even if the CDP connection drops** — a
   real, repeated problem on physical devices (Wi-Fi related,
   `docs/debugWhisper.md` Fix 6). Native/JS diagnostic logging
   (`ExpoAudioTapModule.swift`'s `#if DEBUG` `debugEvent()`,
   `IOSAudioTapAdapter.ts`'s `if (__DEV__)` `pushAudioTapDebugLog()`, the
   patched `RealtimeTranscriber.js`'s `if (__DEV__)` `RT-DEBUG` logs) is
   persisted to MMKV and survives a dropped connection or a full relaunch:
    ```bash
    node scripts/cdp-drive.js --ws "<webSocketDebuggerUrl>" \
      --eval "JSON.stringify(globalThis.__audioTapDebugLog || [])" --duration 5000
    ```
4. **For a real crash** (not just "no transcript"), pull the actual `.ips`
   report rather than guessing from console noise — **Settings → Privacy &
   Security → Analytics & Improvements → Analytics Data** → newest
   `Vantage-*` entry, then parse it directly (see `docs/debugWhisper.md`
   Fix 4 for the exact Python one-liner). Move it out of `docs/` once
   analyzed (item #17, §7.6) — large and device-specific, not meant to live
   in the repo.

**Scriptable, but not automated — the distinction matters.** Steps 1–4 above
are genuinely _scriptable_: `cdp-drive.js` can drive every
`global.whisperTest`/`global.__router` action from the command line, with no
human tapping the screen, and the sequence is repeatable run to run. But
nothing about this loop is _automated_ in the CI sense, and conflating the
two is exactly how this kind of harness ends up mistaken for real coverage:

- **No pass/fail assertion exists anywhere in it.** `cdp-drive.js` streams
  console output back to the terminal; a human reads it and judges whether
  the transcript/crash/audio behavior looks right. There's no oracle that
  says "this transcript should equal X" — the entire reason this harness
  exists is that the _correct_ output (a real spoken sentence transcribed
  accurately, TTS actually audible) can't be checked by a JS assertion at
  all, only by a person listening or reading the log.
- **It requires a live, manually-started environment every time**: Metro
  running, a real device built and installed via `npx expo run:ios --device
<udid>` (or, per `docs/debugWhisper.md`, a Simulator whose audio behavior
  is explicitly documented as unreliable for this exact class of bug), and
  the CDP target's `webSocketDebuggerUrl` re-discovered per session — it
  changes on every relaunch. None of this survives unattended in a CI
  runner, which has no physical/simulated audio device and no Xcode-built
  app to attach to.
- **It only tolerates one connected debugger at a time**
  (`NEW_DEBUGGER_OPENED` silently kicks out the previous connection —
  `docs/debugWhisper.md`) — a hard constraint against parallelizing this or
  running it unattended alongside anything else touching the same device.

So: reach for this harness as the current, real way to verify a
speech-pipeline change works — it's the only thing that has, throughout
§2–§7 — but don't mistake "there's a script for it" for "this runs
unattended in CI." §8.4 is what actually closing that gap would require.

This harness is the actual regression test for anything touching the
native speech pipeline until §8.4 changes that — run it, don't assume a
fix works from code review alone. Every "confirmed fixed" in this document
and in `docs/debugWhisper.md` came from a real pass through this loop, on
real hardware, not from reasoning about the diff.

### 8.4 What real automated unit tests would need — not yet built

If/when it's worth investing in, the genuinely mockable, pure-logic pieces
— the ones that don't require a real native module or a real whisper.cpp
context — are:

- **`useSpeechRecognition.native.js`'s finality/text-stability logic**
  (`TRANSCRIPT_STABILITY_MS` debounce, the hallucination regex filter) —
  pure JS given a fake `onTranscribe` event stream; no native module
  involved at all.
- **`SpeechRecognitionEngine.native.js`'s exclusivity guarantee** —
  `acquire()`/`SpeechEngineBusyError`/`release()` — the core invariant
  fixed in §3, and the one most worth a real regression test given it's
  fixed a real production crash once already. Needs, at minimum:
    1. A proper mock at the exact resolved path
       (`'../../../../node_modules/whisper.rn/lib/module/realtime-transcription'`,
       relative to wherever the test file lives — or mock
       `RealtimeTranscriber` at its real file location directly, which
       survives the engine file being moved again more robustly than
       matching a relative path) — the `virtual: true` specifier mocks in
       `jest.setup.js` don't reach it (§8.2).
    2. A mock for `IOSAudioTapAdapter`/`modules/expo-audio-tap` (or force
       `Platform.OS = 'android'` in the test to exercise the already-mocked
       `AudioPcmStreamAdapter` path instead, sidestepping the native module
       entirely — the more practical near-term option, since Android's
       capture path was never the one under active investigation in §2–§7
       and the exclusivity logic being tested is platform-agnostic).
- **Not practically unit-testable at all**: anything inside
  `ExpoAudioTapModule.swift` (real `AVAudioEngine`, needs an actual device/
  Simulator — see §8.3), and anything inside the patched
  `RealtimeTranscriber.js` that depends on a real whisper.cpp/JSI call
  (the base64/float32 conversion math _is_ pure and testable in isolation;
  whether `transcribeData()`/`detectSpeechData()` actually settle is not,
  by definition — that's exactly what needed a real device to discover in
  the first place, per `docs/debugWhisper.md` Fix 11).
