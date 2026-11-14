/**
 * @page-agent/speech - platform-neutral speech-to-text logic.
 *
 * Engines are injected through the `SttEngine` contract (types.ts): the browser one is
 * `@page-agent/speech-web` (Whisper via transformers.js); an Android engine would implement the
 * same contract. Nothing here touches the DOM, `chrome.*` or Web Audio.
 */
export * from './channelActivity'
export * from './dictation'
export * from './echoGuard'
export * from './outputDevice'
export * from './presets'
// punctuationScore is deliberately not re-exported: it is evaluation tooling (benchmarks, fixture tests) with generic
// names (f1, sumScores) that could clash with a runtime export. Import it from '@page-agent/speech/punctuation-score'.
export * from './sttSession'
export * from './sttTurns'
export * from './transcript'
export * from './types'
export * from './utteranceCutter'
