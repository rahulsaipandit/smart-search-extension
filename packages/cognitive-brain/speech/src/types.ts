/**
 * Speech-to-text for calls whose captions cannot be read (docs/designMeetingCoach.md §4.4).
 *
 * An engine turns one utterance (16 kHz mono samples) into text. Everything else (capture, cutting
 * speech into utterances, turning text into caption turns, download and cache UI) does not depend
 * on which model does it, so a better model is a new engine and not a rewrite.
 */

export type SttEngineId = 'whisper'

/** What the user chose, stored in `UnifiedSettings.sttModel`. */
export interface SttModelSetting {
	engine: SttEngineId
	/** A preset id of that engine, e.g. `tiny.en`. */
	model: string
}

export interface SttPreset {
	id: string
	label: string
	/** The model repository the weights come from. */
	repo: string
	/** Approximate download size in MB. An estimate, not a measurement. */
	approxSizeMb: number
	/** One line about speed and accuracy, shown next to the size. */
	speedNote: string
	/** Hidden unless WebGPU is available: too slow to keep up with a live call without it. */
	needsWebGpu: boolean
	englishOnly: boolean
}

export interface DownloadProgress {
	/** `idle` until a download or load starts. */
	state: 'idle' | 'downloading' | 'ready' | 'failed'
	/** 0 to 100 over all files of the model. */
	percent: number
	/** The last failure, never hidden. */
	error: string | null
}

export interface TranscribeResult {
	text: string
	/** Reserved for engines that separate speakers. Whisper does not set it. */
	speaker?: string
}

/** Implemented once per model family. Runs in the offscreen document only. */
export interface SttEngine {
	readonly id: SttEngineId
	/** Loads the model. Downloads it first when it is not cached and `allowDownload` is true. */
	load(
		preset: SttPreset,
		opts: { allowDownload: boolean; onProgress: (percent: number) => void }
	): Promise<void>
	transcribe(samples16k: Float32Array): Promise<TranscribeResult>
	dispose(): Promise<void>
}

export type SttChannel = 'mic' | 'tab'

/** One transcribed stretch of speech. */
export interface SttSegment {
	id: string
	/** Increases by one per segment, so a poll can ask for "everything after this". */
	seq: number
	channel: SttChannel
	text: string
	/** Epoch ms when the speech started and ended. */
	startedAt: number
	endedAt: number
	/**
	 * Anonymous speaker label ("Speaker 2") from speaker separation, set for the call tab only and only when
	 * the model had scored enough of the stretch. Absent means "not told apart": the shared "Others" applies.
	 */
	speaker?: string
}

/** State of speaker separation next to a transcription session. */
export interface DiarizationPollState {
	/** Why separation stopped, or null. Never swallowed. */
	error: string | null
	/** Call audio waiting for the model, in ms. */
	backlogMs: number
	/** Distinct speakers heard so far. */
	speakersSeen: number
	/** Set while the call audio is being stored for the pass after the call: seconds recorded so far. */
	recordedSeconds?: number
}

export interface SttPollResult {
	segments: SttSegment[]
	/** Utterances thrown away because the model could not keep up. Shown to the user, never silent. */
	dropped: number
	/** Times two waiting utterances were joined into one request because the model was behind. Nothing is lost. */
	merged: number
	/** Microphone utterances discarded because they were the call heard through the speakers. */
	echoDropped: number
	/** Utterances waiting for the model right now. */
	backlog: number
	/** Set when transcription failed; it is stopped until restarted. */
	error: string | null
	/** Present while speaker separation is running or has stopped with an error. */
	diarization?: DiarizationPollState
}
