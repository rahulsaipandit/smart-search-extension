/**
 * Cuts one channel's 16 kHz audio into utterances: from when speech starts to a pause. Whisper takes
 * whole utterances, not a stream, so this decides when there is something to transcribe.
 *
 * Pure (no Web Audio), so it is tested with synthetic samples. The offscreen document feeds it.
 * Speech is a block louder than the running noise floor, the same idea as `ActivityTracker`, kept
 * separate because it also has to hold on to the samples.
 */
import { rms } from './channelActivity'

export const SAMPLE_RATE = 16_000

export interface Utterance {
	samples: Float32Array
	startedAt: number
	endedAt: number
}

export interface CutterOptions {
	/** A pause this long ends an utterance. */
	silenceMs: number
	/** Less loud audio than this is a cough or a click, not an utterance. */
	minSpeechMs: number
	/** Longest utterance; longer speech is cut here so a monologue is still transcribed in pieces. */
	maxUtteranceMs: number
	/** Audio kept from before speech was noticed, so the first word is not clipped. */
	prerollMs: number
	minThreshold: number
	floorMultiplier: number
}

export const DEFAULT_CUTTER_OPTIONS: CutterOptions = {
	silenceMs: 700,
	minSpeechMs: 300,
	maxUtteranceMs: 25_000,
	prerollMs: 200,
	minThreshold: 0.01,
	floorMultiplier: 3,
}

const msOf = (samples: number) => (samples / SAMPLE_RATE) * 1000

export class UtteranceCutter {
	private chunks: Float32Array[] = []
	private chunkSamples = 0
	private speaking = false
	private speechStartedAt = 0
	private lastLoudEndAt = 0
	private loudSamples = 0
	private noiseFloor = 0

	private readonly options: CutterOptions

	constructor(options: CutterOptions = DEFAULT_CUTTER_OPTIONS) {
		this.options = options
	}

	/**
	 * @param samples one block of audio at 16 kHz mono
	 * @param endMs epoch ms of the END of this block
	 * @returns utterances that this block completed (zero or one)
	 */
	push(samples: Float32Array, endMs: number): Utterance[] {
		const level = rms(samples)
		const threshold = Math.max(
			this.options.minThreshold,
			this.noiseFloor * this.options.floorMultiplier
		)
		const loud = level >= threshold
		// The floor follows quiet blocks only, so speech does not raise it and get ignored.
		if (!loud)
			this.noiseFloor = this.noiseFloor === 0 ? level : this.noiseFloor * 0.95 + level * 0.05

		if (!this.speaking) {
			this.keepPreroll(samples)
			if (!loud) return []
			this.speaking = true
			// Start of the pre-roll that is kept, which is when the audio held so far began.
			this.speechStartedAt = endMs - msOf(this.chunkSamples)
			this.lastLoudEndAt = endMs
			this.loudSamples = samples.length
			return []
		}

		this.chunks.push(samples)
		this.chunkSamples += samples.length
		if (loud) {
			this.lastLoudEndAt = endMs
			this.loudSamples += samples.length
		}

		const quietFor = endMs - this.lastLoudEndAt
		if (
			quietFor >= this.options.silenceMs ||
			msOf(this.chunkSamples) >= this.options.maxUtteranceMs
		) {
			return this.finish(endMs)
		}
		return []
	}

	/** Ends the utterance in progress, for when capture stops. */
	flush(endMs: number): Utterance[] {
		return this.speaking ? this.finish(endMs) : []
	}

	private keepPreroll(samples: Float32Array): void {
		this.chunks.push(samples)
		this.chunkSamples += samples.length
		const keep = Math.round((this.options.prerollMs / 1000) * SAMPLE_RATE)
		while (this.chunks.length > 1 && this.chunkSamples - this.chunks[0].length >= keep) {
			this.chunkSamples -= this.chunks.shift()!.length
		}
	}

	private finish(endMs: number): Utterance[] {
		const enough = msOf(this.loudSamples) >= this.options.minSpeechMs
		const samples = new Float32Array(this.chunkSamples)
		let at = 0
		for (const c of this.chunks) {
			samples.set(c, at)
			at += c.length
		}
		const startedAt = this.speechStartedAt
		this.chunks = []
		this.chunkSamples = 0
		this.speaking = false
		this.loudSamples = 0
		return enough ? [{ samples, startedAt, endedAt: endMs }] : []
	}
}
