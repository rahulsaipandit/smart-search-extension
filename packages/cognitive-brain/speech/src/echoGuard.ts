/**
 * Spots the microphone hearing the call through the speakers. With speakers instead of headphones the
 * remote voice reaches the mic, so without this the same sentence is transcribed twice: once as the
 * call ("Others") and once as the user ("You").
 *
 * Pure (no Web Audio). The tab channel is reduced to a loudness envelope of 30 ms frames as it
 * arrives; a finished microphone utterance is then compared with the tab's envelope at the same
 * time. An utterance whose loudness follows the call's closely, while the call was speaking, and
 * which has almost no speech the call cannot explain, is echo and is dropped. When the user talks
 * over the call, the utterance is kept and cropped to the stretch that is theirs.
 *
 * The method (envelope correlation over a short lag, echo gain from the quietest ratios, "own"
 * frames louder than the echo explains) follows call-coach-ai's segmenter worklet
 * (github.com/ZeroGold/call-coach-ai, public/segmenter.worklet.js), rewritten for epoch-ms timing
 * because here the two channels arrive as separate blocks. Not tuned on real calls: the thresholds
 * are theirs, and the first live test with speakers is the check (docs/designMeetingCoach.md §4.4).
 */
import { rms } from './channelActivity'
import { SAMPLE_RATE } from './utteranceCutter'
import type { Utterance } from './utteranceCutter'

export const FRAME_SAMPLES = 480 // 30 ms at 16 kHz
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000

export interface EchoOptions {
	/** Correlation of the two loudness envelopes at or above which the mic is following the call. */
	minCorr: number
	/** Share of the utterance's speech frames during which the call was also speaking. */
	minOverlap: number
	/** Speech frames the call cannot explain; fewer than this means the utterance is only echo. */
	minOwnFrames: number
	/** Echo can arrive this many frames after the call audio. */
	maxLagFrames: number
	/** A room keeps ringing this many frames after the call audio stops. */
	reverbFrames: number
	/** A frame this much louder than the echo explains is the user talking. */
	ownMargin: number
	/** Frames kept before and after the user's own speech when cropping. */
	cropPadFrames: number
	minThreshold: number
	/** Tab history kept, in frames. Bounded so a long call does not grow it. */
	historyFrames: number
}

export const DEFAULT_ECHO_OPTIONS: EchoOptions = {
	minCorr: 0.6,
	minOverlap: 0.6,
	minOwnFrames: 10,
	maxLagFrames: 12,
	reverbFrames: 8,
	ownMargin: 2.5,
	cropPadFrames: 10,
	minThreshold: 0.01,
	historyFrames: 2000,
}

export interface EchoVerdict {
	action: 'keep' | 'drop' | 'crop'
	corr: number
	overlap: number
	/** Frames the call audio cannot explain. */
	own: number
	/** For `crop` only: the utterance cut down to the user's own speech. */
	utterance?: Utterance
}

const KEEP: EchoVerdict = { action: 'keep', corr: 0, overlap: 0, own: 0 }
const EPS = 1e-5

function pearson(a: readonly number[], b: readonly number[]): number {
	const n = a.length
	let ma = 0
	let mb = 0
	for (let i = 0; i < n; i++) {
		ma += a[i]
		mb += b[i]
	}
	ma /= n
	mb /= n
	let num = 0
	let da = 0
	let db = 0
	for (let i = 0; i < n; i++) {
		const x = a[i] - ma
		const y = b[i] - mb
		num += x * y
		da += x * x
		db += y * y
	}
	return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

export class EchoGuard {
	/** Parallel arrays, oldest first: when each tab frame ended, how loud it was, and whether it was speech. */
	private times: number[] = []
	private levels: number[] = []
	private speaking: boolean[] = []
	private tabFloor = 0

	private readonly options: EchoOptions

	constructor(options: EchoOptions = DEFAULT_ECHO_OPTIONS) {
		this.options = options
	}

	/** Number of tab frames held; exposed so the bound can be tested. */
	get heldFrames(): number {
		return this.times.length
	}

	/** One block of the tab channel. `endMs` is epoch ms at its end. */
	observeTab(samples: Float32Array, endMs: number): void {
		const frames = Math.floor(samples.length / FRAME_SAMPLES)
		for (let f = 0; f < frames; f++) {
			const level = rms(samples.subarray(f * FRAME_SAMPLES, (f + 1) * FRAME_SAMPLES))
			const threshold = Math.max(this.options.minThreshold, this.tabFloor * 3)
			const loud = level >= threshold
			if (!loud) this.tabFloor = this.tabFloor === 0 ? level : this.tabFloor * 0.95 + level * 0.05
			this.times.push(endMs - (frames - 1 - f) * FRAME_MS)
			this.levels.push(level)
			this.speaking.push(loud)
		}
		const extra = this.times.length - this.options.historyFrames
		if (extra > 0) {
			this.times.splice(0, extra)
			this.levels.splice(0, extra)
			this.speaking.splice(0, extra)
		}
	}

	/** Index of the stored tab frame nearest to `t`, or -1 when there is none within a frame of it. */
	private frameAt(t: number): number {
		const times = this.times
		if (times.length === 0 || t < times[0] - FRAME_MS || t > times[times.length - 1] + FRAME_MS)
			return -1
		let lo = 0
		let hi = times.length - 1
		while (lo < hi) {
			const mid = (lo + hi) >> 1
			if (times[mid] < t) lo = mid + 1
			else hi = mid
		}
		if (lo > 0 && t - times[lo - 1] < times[lo] - t) lo--
		return lo
	}

	private levelAt(t: number): number {
		const i = this.frameAt(t)
		return i < 0 ? 0 : this.levels[i]
	}

	/** Judges a finished microphone utterance. Anything the tab cannot account for is kept. */
	review(utterance: Utterance): EchoVerdict {
		const o = this.options
		const { samples, startedAt } = utterance
		const n = Math.floor(samples.length / FRAME_SAMPLES)
		if (n < 3 || this.times.length === 0) return KEEP

		const mic: number[] = []
		for (let k = 0; k < n; k++)
			mic.push(rms(samples.subarray(k * FRAME_SAMPLES, (k + 1) * FRAME_SAMPLES)))
		const peak = Math.max(...mic)
		const activeAt = (k: number) => mic[k] >= Math.max(o.minThreshold, peak * 0.2)
		const frameTime = (k: number) => startedAt + (k + 1) * FRAME_MS
		const speakingAt = (t: number) => {
			const i = this.frameAt(t)
			return i >= 0 && this.speaking[i]
		}

		const own = mic.map((v) => Math.log10(v + EPS))
		let corr = -1
		let overlap = 0
		let lag = 0
		for (let l = 0; l <= o.maxLagFrames; l++) {
			const other: number[] = []
			let hits = 0
			let spoken = 0
			for (let k = 0; k < n; k++) {
				const t = frameTime(k) - l * FRAME_MS
				other.push(Math.log10(this.levelAt(t) + EPS))
				if (activeAt(k)) {
					spoken++
					if (speakingAt(t)) hits++
				}
			}
			const c = pearson(own, other)
			if (c > corr) {
				corr = c
				overlap = spoken > 0 ? hits / spoken : 0
				lag = l
			}
		}
		if (corr < o.minCorr || overlap < o.minOverlap) return { ...KEEP, corr, overlap }

		// Echo gain: how loud the mic is relative to the call when it only hears the echo, read from the
		// quietest 20% of the ratios so the user's own speech does not inflate it.
		const ratios: number[] = []
		for (let k = 0; k < n; k++) {
			const t = frameTime(k) - lag * FRAME_MS
			if (activeAt(k) && speakingAt(t)) ratios.push(mic[k] / (this.levelAt(t) + 1e-6))
		}
		ratios.sort((a, b) => a - b)
		const gain = ratios.length > 0 ? ratios[Math.floor(0.2 * (ratios.length - 1))] : 0

		let ownFrames = 0
		let first = -1
		let last = -1
		for (let k = 0; k < n; k++) {
			if (!activeAt(k)) continue
			let recent = 0
			for (let r = 0; r <= o.reverbFrames; r++)
				recent = Math.max(recent, this.levelAt(frameTime(k) - (lag + r) * FRAME_MS))
			if (mic[k] > o.ownMargin * gain * recent) {
				ownFrames++
				if (first < 0) first = k
				last = k
			}
		}

		if (ownFrames < o.minOwnFrames) return { action: 'drop', corr, overlap, own: ownFrames }
		const from = Math.max(0, first - o.cropPadFrames)
		const to = Math.min(n, last + o.cropPadFrames + 1)
		return {
			action: 'crop',
			corr,
			overlap,
			own: ownFrames,
			utterance: {
				samples: samples.slice(from * FRAME_SAMPLES, to * FRAME_SAMPLES),
				startedAt: startedAt + from * FRAME_MS,
				endedAt: startedAt + to * FRAME_MS,
			},
		}
	}
}
