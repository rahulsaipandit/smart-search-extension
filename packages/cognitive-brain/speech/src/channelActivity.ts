/**
 * Voice activity on the two capture channels (the user's microphone and the tab's audio), and what
 * it says about who is speaking. Pure, so it is tested without audio hardware; `capture.ts` feeds it
 * from Web Audio in the offscreen document.
 *
 * No audio is kept. Each channel reduces to a list of "speaking from t0 to t1" intervals, which is
 * all the attribution needs and is small enough to hold for a whole call.
 *
 * Why this exists: Meet labels the signed-in user's captions "You" and translates the word, so
 * "which caption turn is mine" depends on language and on the name entered in settings. The mic
 * channel is the user by construction. See docs/designMeetingCoach.md §3.1.
 */

export interface Interval {
	start: number
	end: number
}

export interface ActivityOptions {
	/** Never treat anything quieter than this RMS as speech, however quiet the room is. */
	minThreshold: number
	/** Speech is a frame this many times louder than the running noise floor. */
	floorMultiplier: number
	/** Keeps an interval open this long after the last loud frame, so pauses between words do not split it. */
	hangoverMs: number
	/** Intervals kept per channel; the oldest are dropped, so memory is bounded however long the call runs. */
	maxIntervals: number
}

export const DEFAULT_ACTIVITY_OPTIONS: ActivityOptions = {
	minThreshold: 0.01,
	floorMultiplier: 3,
	hangoverMs: 400,
	maxIntervals: 20_000,
}

/** Root-mean-square level of one audio frame, 0 to 1. */
export function rms(samples: Float32Array | readonly number[]): number {
	if (samples.length === 0) return 0
	let sum = 0
	for (const v of samples) sum += v * v
	return Math.sqrt(sum / samples.length)
}

/** Turns a stream of per-frame levels into speaking intervals, with an adaptive noise floor. */
export class ActivityTracker {
	private readonly done: Interval[] = []
	private open: Interval | null = null
	private lastLoudAt = 0
	private noiseFloor = 0
	private lastLevel = 0

	private readonly options: ActivityOptions

	constructor(options: ActivityOptions = DEFAULT_ACTIVITY_OPTIONS) {
		this.options = options
	}

	/** Feed one frame. `nowMs` is epoch ms, on the same clock as the caption turns. */
	push(level: number, nowMs: number): void {
		this.lastLevel = level
		const threshold = Math.max(
			this.options.minThreshold,
			this.noiseFloor * this.options.floorMultiplier
		)
		if (level >= threshold) {
			this.lastLoudAt = nowMs
			if (this.open) this.open.end = nowMs
			else this.open = { start: nowMs, end: nowMs }
			return
		}
		// Quiet frame: the noise floor follows it slowly, and a long enough silence closes the interval.
		this.noiseFloor = this.noiseFloor === 0 ? level : this.noiseFloor * 0.98 + level * 0.02
		if (this.open && nowMs - this.lastLoudAt >= this.options.hangoverMs) {
			this.done.push(this.open)
			this.open = null
			if (this.done.length > this.options.maxIntervals) this.done.shift()
		}
	}

	/** Closed intervals plus the one still open, optionally only those that end at or after `since`. */
	intervals(since = -Infinity): Interval[] {
		const all = this.open ? [...this.done, { ...this.open }] : this.done
		return all.filter((i) => i.end >= since)
	}

	get level(): number {
		return this.lastLevel
	}
}

/** Milliseconds of `intervals` that fall inside [from, to]. */
export function overlapMs(intervals: readonly Interval[], from: number, to: number): number {
	let total = 0
	for (const i of intervals) {
		const overlap = Math.min(i.end, to) - Math.max(i.start, from)
		if (overlap > 0) total += overlap
	}
	return total
}

export type ChannelVerdict = 'self' | 'remote'

export interface AttributionOptions {
	/** Captions trail the speech by a second or two, so the turn's window starts this much earlier. */
	captionLagMs: number
	/** A channel must be active for at least this share of the window to count. */
	minShare: number
	/** When both channels are active, the louder-in-time one must beat the other by this factor. */
	dominance: number
}

export const DEFAULT_ATTRIBUTION_OPTIONS: AttributionOptions = {
	captionLagMs: 2000,
	minShare: 0.3,
	dominance: 2,
}

/**
 * Who spoke during [startedAt, updatedAt] of a caption turn, or null when the audio cannot say.
 *
 * null is a real answer, not a failure: with speakers instead of headphones the remote voice leaks
 * into the microphone and both channels are active. Then neither side is claimed, and the caller
 * keeps the name Meet gave the turn.
 */
export function attributeTurn(
	mic: readonly Interval[],
	tab: readonly Interval[],
	startedAt: number,
	updatedAt: number,
	options: AttributionOptions = DEFAULT_ATTRIBUTION_OPTIONS
): ChannelVerdict | null {
	const from = startedAt - options.captionLagMs
	const to = Math.max(updatedAt, startedAt)
	const window = to - from
	if (window <= 0) return null

	const micMs = overlapMs(mic, from, to)
	const tabMs = overlapMs(tab, from, to)
	const micOn = micMs / window >= options.minShare
	const tabOn = tabMs / window >= options.minShare

	if (micOn && !tabOn) return 'self'
	if (tabOn && !micOn) return 'remote'
	if (micOn && tabOn) {
		if (micMs >= tabMs * options.dominance) return 'self'
		if (tabMs >= micMs * options.dominance) return 'remote'
	}
	return null
}
