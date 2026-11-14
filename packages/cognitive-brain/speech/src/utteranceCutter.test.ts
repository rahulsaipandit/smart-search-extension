import { describe, expect, it } from 'vitest'

import { DEFAULT_CUTTER_OPTIONS, SAMPLE_RATE, UtteranceCutter } from './utteranceCutter'
import type { Utterance } from './utteranceCutter'

const BLOCK_MS = 100
const block = (level: number) => new Float32Array((SAMPLE_RATE * BLOCK_MS) / 1000).fill(level)

/** Feeds `ms` of audio at `level` in 100 ms blocks, returning every utterance cut. */
function feed(
	cutter: UtteranceCutter,
	clock: { t: number },
	ms: number,
	level: number
): Utterance[] {
	const out: Utterance[] = []
	for (let i = 0; i < ms / BLOCK_MS; i++) {
		clock.t += BLOCK_MS
		out.push(...cutter.push(block(level), clock.t))
	}
	return out
}

describe('UtteranceCutter', () => {
	it('emits one utterance after speech followed by a pause, with its start time', () => {
		const cutter = new UtteranceCutter()
		const clock = { t: 1_000_000 }
		feed(cutter, clock, 1000, 0.001) // room noise
		const speechStart = clock.t
		expect(feed(cutter, clock, 1500, 0.1)).toEqual([])
		const out = feed(cutter, clock, 1000, 0.001)
		expect(out).toHaveLength(1)
		// Starts at the speech, a little earlier because of the pre-roll
		expect(out[0].startedAt).toBeGreaterThanOrEqual(speechStart - 300)
		expect(out[0].startedAt).toBeLessThanOrEqual(speechStart + 100)
		// 1.5 s of speech, a 0.7 s pause, and some pre-roll
		const seconds = out[0].samples.length / SAMPLE_RATE
		expect(seconds).toBeGreaterThan(1.5)
		expect(seconds).toBeLessThan(2.6)
	})

	it('does not split on a short pause between words', () => {
		const cutter = new UtteranceCutter()
		const clock = { t: 0 }
		const out = [
			...feed(cutter, clock, 800, 0.1),
			...feed(cutter, clock, 300, 0.001),
			...feed(cutter, clock, 800, 0.1),
			...feed(cutter, clock, 1000, 0.001),
		]
		expect(out).toHaveLength(1)
	})

	it('ignores a click shorter than the minimum speech length', () => {
		const cutter = new UtteranceCutter()
		const clock = { t: 0 }
		expect([...feed(cutter, clock, 100, 0.1), ...feed(cutter, clock, 1500, 0.001)]).toEqual([])
	})

	it('cuts a long monologue instead of holding it forever', () => {
		const cutter = new UtteranceCutter({ ...DEFAULT_CUTTER_OPTIONS, maxUtteranceMs: 5000 })
		expect(feed(cutter, { t: 0 }, 12_000, 0.1).length).toBeGreaterThanOrEqual(2)
	})

	it('flush ends an utterance in progress, and returns nothing when idle', () => {
		const cutter = new UtteranceCutter()
		const clock = { t: 0 }
		expect(cutter.flush(0)).toEqual([])
		feed(cutter, clock, 1000, 0.1)
		expect(cutter.flush(clock.t)).toHaveLength(1)
	})

	it('stays silent on a constant quiet room', () => {
		expect(feed(new UtteranceCutter(), { t: 0 }, 10_000, 0.004)).toEqual([])
	})
})
