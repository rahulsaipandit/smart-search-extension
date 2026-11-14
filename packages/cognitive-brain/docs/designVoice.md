# Voice Interface Design — Executive Twin

**Status:** Implemented  
**Date:** May 2026  
**Scope:** `packages/website` — home-v2 chat card

---

## 1. Problem Statement

The Executive Twin is a digital representation of Rahul — available to recruiters, peers, and collaborators as a fully async AI proxy. The original chat UI required hands on a keyboard: type a question, read a response, type again. This friction breaks two important use cases:

1. **Mobile visitors reviewing from a phone** — typing long questions is slow and error-prone on a small touchscreen.
2. **Ambient exploration** — someone who wants to _talk_ to the twin while commuting, multitasking, or during a genuine conversation-style interaction cannot do so with a text box.

The goal was to add a **speech-first, hands-free conversation mode** where the visitor can speak naturally, hear the response, and continue the conversation without touching the keyboard.

---

## 2. Constraints & Non-Negotiables

Before evaluating options, the constraints of this project narrowed the solution space significantly:

| Constraint                                                             | Implication                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **No server** — everything runs in-browser via WebLLM + WebGPU         | Any voice solution must also run client-side with no cloud calls |
| **No new npm dependencies** (bundle size matters for GitHub Pages)     | Must use native browser APIs                                     |
| **Privacy-first positioning**                                          | No audio sent to any external service                            |
| **Chrome/Edge primary target** (WebGPU itself requires these browsers) | Okay to degrade gracefully on Firefox/Safari                     |
| **Existing design language** — inline styles, `--twin-*` CSS tokens    | Voice UI must feel native to the card, not a bolt-on             |

---

## 3. Technology Decisions

### 3.1 Web Speech API over third-party STT

**Decision:** Use the native `SpeechRecognition` browser API for speech-to-text.

**Alternatives considered:**

| Option                              | Pros                                   | Cons                                  | Decision                      |
| ----------------------------------- | -------------------------------------- | ------------------------------------- | ----------------------------- |
| `transformers` (Whisper in-browser) | Fully offline, high accuracy           | 150 MB+ voice + WebLLM model loading  | ❌ Rejected — double download |
| OpenAI Whisper API                  | Very high accuracy                     | API key + Privacy posture             | ❌ Rejected                   |
| Web Speech API (native)             | Zero bundle cost, instant, no download | Web only; accuracy varies with accent | ✅ Chosen                     |
| AssemblyAI / Deepgram streaming     | High accuracy                          | Cloud calls,APIkey,cost per request   | ❌ Rejected                   |

The Web Speech API is already the choice of the target browser (Chrome) and works without any model download. Since WebLLM + WebGPU already requires Chrome 113+, the audience overlap is nearly 100%. Firefox users are already blocked by WebGPU; the degradation path (hide mic button, show tooltip) is acceptable.

### 3.2 Web Speech Synthesis over third-party TTS

**Decision:** Use the native `speechSynthesis` browser API for text-to-speech.

**Alternatives considered:**

| Option                        | Pros                                     | Cons                                                 | Decision    |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------------- | ----------- |
| ElevenLabs / Play.ht          | Natural, voice-cloned output             | Cloud API call per response, cost, latency, privacy  | ❌ Rejected |
| `transformers` (Kokoro, etc.) | Local, good quality                      | Another multi-MB model, added complexity             | ❌ Rejected |
| Web Speech Synthesis          | Zero cost, instant, available everywhere | System-voice quality varies; browser-specific quirks | ✅ Chosen   |

For a first version, the goal is **working, not perfect**. System voices are familiar to users (screen readers, navigation apps) and introduce no latency. A voice-cloned version of Rahul could be a v2 feature once the interaction pattern is validated.

**Known quirk handled:** Chromium pauses `speechSynthesis` after ~15 seconds of continuous playback — a documented Chrome bug. Mitigated in `useVoiceOutput` with a `setInterval` that calls `speechSynthesis.resume()` every 10 seconds while speech is active.

### 3.3 Voice Command Shortcuts — annyang considered, custom implementation chosen

While building the conversation voice loop, a natural follow-on need emerged: **discrete voice shortcuts** — deterministic commands like "stop", "go hands free", or "read that again" that should execute instantly without an LLM round-trip.

#### What annyang offers

[annyang](https://github.com/TalAter/annyang) is a 2 KB, zero-dependency MIT library that wraps `SpeechRecognition` with a command DSL. It supports three pattern types:

| Pattern syntax          | Example                  | Captures            |
| ----------------------- | ------------------------ | ------------------- |
| Exact phrase            | `'stop'`                 | nothing             |
| Named variable (1 word) | `'search for :query'`    | `"batman"`          |
| Splat (n words)         | `'tell me about *topic'` | `"the dark knight"` |
| Optional words          | `'(please) stop'`        | nothing             |

It also provides `addCallback('resultNoMatch', ...)` — a hook that fires when no registered command matches, which would be the natural fallthrough point to our LLM pipeline.

#### Why annyang was not adopted

| Factor                                        | Detail                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **We already wrap SpeechRecognition**         | `useVoiceInput.ts` is our own hook. annyang would be a second, parallel wrapper around the same browser API — two recognition instances competing, or a full rewrite to delegate to annyang instead. Neither is clean.                                                       |
| **annyang is input-only**                     | It has no TTS side. Our conversation loop (STT → LLM → TTS → loop) is already built; annyang would cover only a slice of it.                                                                                                                                                 |
| **The pattern DSL is ~30 lines to implement** | The core of annyang's value is `(optional)`, `:named`, `*splat` → regex. That is not a 2 KB problem worth a dependency.                                                                                                                                                      |
| **Bundle philosophy**                         | The project explicitly avoids new npm dependencies to keep the GitHub Pages bundle lean. annyang is small, but the principle matters more than the size.                                                                                                                     |
| **No state machine integration**              | annyang fires callbacks but knows nothing about `voiceState`. Our commands need to call `setHandsFreeMode`, `voiceOutput.stop()`, `setAutoSpeak` — all of which live in the component. A wrapper we own is cleaner than forcing annyang callbacks to close over React state. |

#### The hybrid insight

The right mental model is: **commands are a pre-filter on `onFinalTranscript`**, not a parallel recognition system. Every transcript goes through command matching first. If it matches, the command fires and the LLM is never called. If it doesn't match, it falls through to the existing conversation pipeline unchanged.

```
transcript (from SpeechRecognition)
      ↓
commandMatcher.match(text)
      ├── true  → command fires, return early (no LLM call)
      └── false → handleVoiceFinal(text) → LLM → TTS → loop
```

annyang's `resultNoMatch` callback is this exact pattern — we are implementing the same architecture, just owning the code.

---

## 4. Architecture

### 4.1 Module structure

```
packages/website/src/
├── hooks/
│   ├── useVoiceInput.ts    ← SpeechRecognition wrapper
│   └── useVoiceOutput.ts   ← SpeechSynthesis wrapper
└── pages/home-v2/
    ├── index.tsx            ← Voice state machine + orchestration
    └── PixelOrb.tsx         ← Canvas-based animated state indicator (pre-existing)
```

The voice logic is deliberately split across two layers:

- **Hooks** own the browser API lifecycle (start/stop, error handling, event wiring). They are stateless from the caller's perspective — exposing clean imperative handles (`start`, `stop`, `speak`) and reactive values (`isListening`, `isSpeaking`, `interimText`).
- **Page component** owns the **conversation state machine** — what happens when speech ends, when the LLM finishes, when TTS ends, whether to loop. This keeps the hooks general-purpose (reusable in other contexts) while keeping sequencing logic colocated with the chat logic it orchestrates.

### 4.2 Circular dependency resolution with refs

The hands-free loop creates a logical cycle:

```
STT end → sendMessage → LLM done → TTS speak → TTS end → STT start → ...
```

In React, wiring this naively via `useCallback` with dependency arrays creates stale closure problems: `handleTtsEnd` needs to call `voiceInput.start()`, but `voiceInput` is a hook result that changes identity on re-render. `handleVoiceFinal` needs `voiceOutput.speak()`, but `voiceOutput.onEnd` needs `handleTtsEnd`.

**Solution:** Stable mutable refs updated on every render:

```typescript
const voiceInputStartRef = useRef<() => void>(() => {})
const voiceSpeakRef = useRef<(text: string) => void>(() => {})

// After each hook call, sync refs:
voiceInputStartRef.current = voiceInput.start
voiceSpeakRef.current = voiceOutput.speak

// Callbacks that need to call across the cycle read from refs, not closures:
const handleTtsEnd = useCallback(() => {
    if (handsFreeModeRef.current) {
        setTimeout(() => voiceInputStartRef.current(), 900)
    }
}, []) // empty deps — reads only stable refs
```

This breaks the cycle without any `useEffect` chains or forced re-renders. It follows the same principle as React's own `useEvent` RFC: stable function identity, always-fresh captured values.

`autoSpeak` and `handsFreeMode` state are mirrored into refs (`autoSpeakRef`, `handsFreeModeRef`) so that async callbacks (e.g., inside `sendMessage`'s `finally`) always read current values, not the values captured at callback creation time.

### 4.3 `sendMessage` returns full response content

The original `sendMessage` was `async (text: string) => void`. It was changed to return `Promise<string>` — the complete assistant response text after streaming finishes.

This was the key design unlock for voice orchestration. Instead of a `useEffect` watching `isStreaming` go false (which introduces timing uncertainty and extra renders), the voice handler simply `await`s the send and acts on the response synchronously:

```typescript
const content = await sendMessage(text)
if (autoSpeakRef.current) {
    voiceSpeakRef.current(content) // TTS speaks it; onStart sets voiceState → 'speaking'
} else {
    setVoiceState('idle')
}
```

This keeps the happy path as a simple linear `async/await` flow rather than a reactive state machine spread across multiple effects.

### 4.4 Voice Command Matcher

#### Module

```
packages/website/src/
└── utils/
    └── voiceCommands.ts    ← pure pattern compiler + matcher, no React
```

The matcher is a **plain object factory, not a hook**. It has no React lifecycle dependency because it neither reads from the DOM nor calls browser APIs — it only does string matching. This keeps it independently testable with plain `import` in a Jest test.

#### API

```typescript
const matcher = createCommandMatcher()

matcher.addCommands({
    '(please) stop': () => {
        voiceOutput.stop()
        setVoiceState('idle')
    },
    'go hands free': () => setHandsFreeMode(true),
    '(exit) hands free': () => setHandsFreeMode(false),
    'read that (again)': () => voiceSpeakRef.current(lastResponseRef.current ?? ''),
    mute: () => setAutoSpeak(false),
    unmute: () => setAutoSpeak(true),
})

matcher.match('please stop') // → true, fires callback
matcher.match('tell me about React') // → false, falls through to LLM
```

`match()` returns `boolean` so the caller decides what "no match" means. `removeCommands(patterns)` is available for dynamic command sets (e.g. page-specific shortcuts registered by child components).

#### Pattern compilation

Each pattern is compiled once to a `RegExp` at registration time:

```
(please) stop     →  /^(?:please )?stop$/i
search for :term  →  /^search for (\S+)$/i
tell me about *t  →  /^tell me about (.+)$/i
```

Rules in order of application:

1. `(optional words)` → `(?:optional words )?` — non-capturing optional group, trailing space inside
2. `:name` → `(\S+)` — single non-whitespace token, captured
3. `*name` → `(.+)` — greedy multi-word capture to end of string
4. Internal whitespace → `\s+` — tolerates irregular spacing in recognised text

`RegExp` flags: `i` (case-insensitive). Anchored `^…$` so partial matches don't fire.

#### Integration in `home-v2/index.tsx`

```typescript
// Stable across renders — no deps needed because callbacks read from refs
const commandMatcher = useMemo(() => {
    const m = createCommandMatcher()
    m.addCommands({/* ... see above ... */})
    return m
}, [])

// Pre-filter wired into useVoiceInput
onFinalTranscript: useCallback(
    (text: string) => {
        if (commandMatcher.match(text)) return // handled — no LLM call
        handleVoiceFinal(text) // falls through to existing pipeline
    },
    [commandMatcher]
)
```

`useMemo` with `[]` deps is used rather than a bare `useRef` initialiser because it is semantically correct (the value is derived, not mutated) and survives React StrictMode's double-invocation cleanly.

Command callbacks close over refs (`voiceSpeakRef`, `lastResponseRef`) rather than state values, for the same reason described in §4.2 — async callbacks always need to read current values, not captured ones.

---

## 5. Voice State Machine

The voice interaction lifecycle is a six-state machine. State drives both the PixelOrb animation and all UI feedback throughout the chat card.

```
                 ┌──────────────────────────────────────────┐
                 │                                          │
         ┌───── ▼ ─────┐                                   │
         │             │  user clicks mic / enters          │
         │    idle     │  hands-free mode                   │
         │             │ ────────────────────────────────►  listening
         └─────────────┘                                    │
               ▲                                            │ STT final transcript
               │                                            ▼
               │                                         thinking
               │                                            │
               │                                            │ LLM starts streaming
               │                                            ▼
               │                                         thinking
               │                                     (orb → processing)
               │                                            │
               │                                            │ streaming complete
               │                            autoSpeak?      ▼
               │                       yes ◄────────── [branch] ────────────► no (idle)
               │                       │
               │                       ▼
               │                    speaking
               │                       │ TTS ends
               │       handsFreeMode?  ▼
               │     yes ◄────────── [branch] ────────────────────────────► no (idle)
               │     │
               │     ▼
               │   waiting  ──(900ms)──►  listening ──► (loop)
               │
               └────────── (user exits) ──────────────────────────────────── idle
```

| State                      | PixelOrb State | Colour           | Label shown    |
| -------------------------- | -------------- | ---------------- | -------------- |
| `idle`                     | `idle`         | Gray             | _(Live badge)_ |
| `listening`                | `listening`    | Green `#4ade80`  | Listening…     |
| `thinking` (pre-stream)    | `thinking`     | Purple `#a78bfa` | Thinking…      |
| `thinking` + `isStreaming` | `processing`   | Amber `#fbbf24`  | Generating…    |
| `speaking`                 | `responding`   | Mint `#86efac`   | Speaking…      |
| `waiting`                  | `idle`         | Gray             | Waiting…       |

The `processing` sub-state is not a separate `VoiceState` enum value — it is derived by checking `voiceState === 'thinking' && isStreaming`. This avoids an extra state variable while giving the PixelOrb a distinct high-energy animation during token generation.

---

## 6. The PixelOrb as State Indicator

### Why the PixelOrb, not just a status badge

A text badge (`● Listening…`) communicates state but is **passive** — it sits in the corner and requires conscious reading. The PixelOrb communicates state through **motion energy and colour**, which is peripherally perceptible without focused attention.

This matters in a hands-free context: the user may not be looking at the screen, and a glance should immediately convey whether the system is waiting for them, computing, or speaking — the same role an LED plays on a smart speaker.

The PixelOrb was already built with exactly these states in mind:

| PixelOrb State | Animation Speed    | Colour       | What it signals                          |
| -------------- | ------------------ | ------------ | ---------------------------------------- |
| `idle`         | Very slow (0.24)   | Blue-gray    | Standby — nothing happening              |
| `listening`    | Fast (0.88)        | Green        | Alert, receptive — speak now             |
| `thinking`     | Medium (0.52)      | Purple       | Processing input, not yet generating     |
| `processing`   | Very fast (1.92)   | Amber        | Maximum activity — LLM generating tokens |
| `responding`   | Medium-fast (1.28) | Bright green | Speaking the response                    |

Animation speed directly encodes cognitive load — faster means more is happening. This is an intuitive physical metaphor requiring no instruction.

### Placement strategy

**Hands-free mode:** The text input is hidden and the PixelOrb (`medium` size, 120 px) occupies the entire input area. It becomes the primary interaction affordance. The card border also tints to match the current state colour, making the card feel "alive" as a whole.

**Standard voice mode** (mic toggled, not hands-free): The text input remains visible with interim transcript. The PixelOrb is not shown — only the mic button colour changes and a state badge appears in the card header. This avoids visual clutter for users who just want a quick voice question.

---

## 7. UX Design Decisions

### 7.1 Two entry points: toggle voice vs. hands-free mode

Users are given two explicit entry points:

- **Mic button** (in the input row) — familiar push-to-talk metaphor. The user stays in control, can read the response, and can switch back to typing at any time. For one-off voice questions.
- **Hands-free button** (in the voice controls strip below the input) — replaces the input UI with the PixelOrb and starts the conversation loop. Entering hands-free automatically enables auto-speak, because a loop that listens, generates, and then stays silent is broken UX.

Separating these avoids the uncanny valley of a "hands-free" mode that still requires the user to read text responses.

### 7.2 Auto-speak is decoupled from hands-free

A user might want TTS without the full loop — e.g., they type a question but want to hear the response while multitasking. So `Auto-speak` is a separate toggle. It can be turned on without enabling the hands-free loop.

However, **entering hands-free mode force-enables auto-speak** in code. A loop without speech output is silent and confusing.

### 7.3 Interim transcript in the input field

While the user speaks, the partial transcript (`interimResults`) appears grayed-out in the input field. This gives confidence that the microphone is working and words are being captured. The grayed colour (using `var(--twin-muted)`) signals the text is temporary, not committed — matching the existing design language of placeholder text.

### 7.4 The mic button is context-aware, not multiplied

Rather than adding a separate "stop" button, the mic button changes meaning based on the current state:

| Voice State | Icon shown                   | Click action    |
| ----------- | ---------------------------- | --------------- |
| `idle`      | `Mic` (gray)                 | Start listening |
| `listening` | `Mic` (green, pulse ring)    | Stop listening  |
| `thinking`  | `Loader2` (spinning, purple) | Disabled        |
| `speaking`  | `Volume2` (mint)             | Stop TTS        |

This follows **progressive affordance change** — one control, one location, context-appropriate action — rather than multiplying buttons that are only sometimes relevant.

### 7.5 The 900 ms gap before re-listening

After TTS finishes, the system waits 900 ms before reopening the microphone. This is intentional:

1. `speechSynthesis.onend` can fire slightly before audio playback physically ends (particularly on Windows with certain system voices). The gap prevents the mic from capturing TTS tail audio as user speech.
2. A brief pause gives the user a natural moment to form their next thought, rather than feeling like the system is immediately demanding a response.

This value mirrors the post-response gap in consumer voice assistants (Siri, Google Assistant), which empirically settled on 700–1000 ms.

---

## 8. Browser Compatibility Strategy

| Feature             | Chrome | Edge | Firefox | Safari         |
| ------------------- | ------ | ---- | ------- | -------------- |
| `SpeechRecognition` | ✅     | ✅   | ❌      | ✅ (iOS 14.5+) |
| `speechSynthesis`   | ✅     | ✅   | ✅      | ✅             |
| WebLLM / WebGPU     | ✅     | ✅   | ❌      | ⚠️ partial     |

Firefox cannot use WebLLM (no WebGPU) and cannot use STT (no `SpeechRecognition`). The voice feature's audience is therefore entirely within the Chrome/Edge user base — the same users who can use the chat at all. This means the STT limitation is not a real narrowing of reach.

**Degradation behaviour:**

- `isSttSupported = false` → mic button hidden, voice controls strip hidden, a small note `🎤 Voice requires Chrome or Edge` appears at the bottom of the card.
- `isTtsSupported = false` → auto-speak toggle hidden. In practice, `speechSynthesis` is universal across Chrome/Edge/Firefox/Safari, so this path is never hit for the target audience.

---

## 9. What's Not In V1 (and Why)

| Feature                      | Why deferred                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Voice-cloned TTS**         | Requires ElevenLabs API (cloud + cost) or Kokoro/XTTS model (100 MB+ additional download). The interaction pattern should be validated with system voices first.                       |
| **Wake word** ("Hey Rahul")  | Requires always-on mic processing. Significant privacy, power, and UX implications. Users explicitly opt into hands-free instead — opt-in is cleaner.                                  |
| **Voice selection UI**       | `speechSynthesis.getVoices()` returns platform-specific lists. Useful but adds settings surface area. The hook already accepts `rate`/`pitch` props; voice selection is one prop away. |
| **Multilingual STT**         | `SpeechRecognition.lang` is already exposed as a `language` prop in `useVoiceInput`. Exposing language selection to users is a UI change, not a code change.                           |
| **Noise cancellation / VAD** | The browser's SpeechRecognition handles this natively. More sophisticated VAD (e.g., Silero) would require a WASM model — over-engineering for v1.                                     |

---

## 10. Files Changed

| File                             | Type      | Summary                                                                                                                                            |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useVoiceInput.ts`     | New       | SpeechRecognition hook with interim transcript, error handling, and abort-on-unmount                                                               |
| `src/hooks/useVoiceOutput.ts`    | New       | SpeechSynthesis hook with Chromium 15-second pause workaround                                                                                      |
| `src/utils/voiceCommands.ts`     | New       | Pure pattern compiler + matcher (annyang-compatible DSL). No React dependency; used as a pre-filter on `onFinalTranscript` before the LLM pipeline |
| `src/pages/home-v2/index.tsx`    | Modified  | Voice state machine, ref-based circular dependency resolution, ChatCard voice UI, PixelOrb integration, hands-free loop, command pre-filter        |
| `src/pages/home-v2/PixelOrb.tsx` | Unchanged | Already had all five required animation states                                                                                                     |
