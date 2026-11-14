import { describe, expect, it } from 'vitest'

import { ActivityTracker, attributeTurn, overlapMs, rms } from './channelActivity'

const FRAME = 50

/** Feeds `tracker` loud frames over [from, to) and quiet ones around it. */
function speak(tracker: ActivityTracker, from: number, to: number, quietUntil = to + 1000) {
	for (let t = from; t < to; t += FRAME) tracker.push(0.2, t)
	for (let t = to; t < quietUntil; t += FRAME) tracker.push(0.001, t)
}

describe('rms', () => {
	it('is 0 for silence and for no samples', () => {
		expect(rms([0, 0, 0])).toBe(0)
		expect(rms([])).toBe(0)
	})
	it('measures a constant signal', () => {
		expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5)
	})
})

describe('ActivityTracker', () => {
	it('records one interval for continuous speech and ends it after the hangover', () => {
		const t = new ActivityTracker()
		speak(t, 1000, 3000)
		expect(t.intervals()).toHaveLength(1)
		const [i] = t.intervals()
		expect(i.start).toBe(1000)
		expect(i.end).toBeGreaterThanOrEqual(2900)
	})

	it('does not split speech on a short pause between words', () => {
		const t = new ActivityTracker()
		speak(t, 1000, 2000, 2200) // 200 ms pause, shorter than the hangover
		speak(t, 2200, 3000)
		expect(t.intervals()).toHaveLength(1)
	})

	it('splits on a long pause', () => {
		const t = new ActivityTracker()
		speak(t, 1000, 2000, 4000)
		speak(t, 4000, 5000)
		expect(t.intervals()).toHaveLength(2)
	})

	it('adapts to a noisy room: steady hiss is not speech, louder speech still is', () => {
		const t = new ActivityTracker()
		for (let ms = 0; ms < 5000; ms += FRAME) t.push(0.02, ms) // hiss above the fixed minimum
		const hissOnly = t.intervals()
		for (let ms = 5000; ms < 6000; ms += FRAME) t.push(0.3, ms)
		expect(hissOnly.length).toBeLessThanOrEqual(1)
		expect(t.intervals().some((i) => i.end >= 5900)).toBe(true)
	})

	it('keeps memory bounded on a long call', () => {
		const t = new ActivityTracker({
			minThreshold: 0.01,
			floorMultiplier: 3,
			hangoverMs: 100,
			maxIntervals: 10,
		})
		for (let k = 0; k < 100; k++) speak(t, k * 2000, k * 2000 + 500, k * 2000 + 2000)
		expect(t.intervals().length).toBeLessThanOrEqual(11)
	})

	it('filters by end time', () => {
		const t = new ActivityTracker()
		speak(t, 1000, 2000, 4000)
		speak(t, 6000, 7000)
		expect(t.intervals(5000)).toHaveLength(1)
	})
})

describe('overlapMs', () => {
	it('counts only the part inside the window', () => {
		expect(overlapMs([{ start: 0, end: 1000 }], 500, 2000)).toBe(500)
		expect(overlapMs([{ start: 0, end: 100 }], 500, 2000)).toBe(0)
	})
})

describe('attributeTurn', () => {
	const mic = [{ start: 10_000, end: 14_000 }]
	const tab = [{ start: 20_000, end: 24_000 }]

	it('says "self" when only the microphone was active during the turn', () => {
		expect(attributeTurn(mic, tab, 11_000, 14_000)).toBe('self')
	})

	it('says "remote" when only the tab audio was active', () => {
		expect(attributeTurn(mic, tab, 21_000, 24_000)).toBe('remote')
	})

	it('allows for captions trailing the speech', () => {
		// The caption appeared 1.5 s after the user started talking.
		expect(attributeTurn(mic, tab, 11_500, 14_000)).toBe('self')
	})

	it('says nothing when neither channel was active', () => {
		expect(attributeTurn(mic, tab, 30_000, 33_000)).toBeNull()
	})

	it('says nothing when both channels carry the same voice (speakers, not headphones)', () => {
		const both = [{ start: 40_000, end: 44_000 }]
		expect(attributeTurn(both, both, 40_500, 44_000)).toBeNull()
	})

	it('picks the clearly dominant channel when the other leaks a little', () => {
		const loud = [{ start: 50_000, end: 54_000 }]
		const leak = [{ start: 50_000, end: 51_500 }]
		expect(attributeTurn(loud, leak, 50_500, 54_000)).toBe('self')
	})
})
