import { describe, expect, it } from 'vitest'

import { DEFAULT_ECHO_OPTIONS, EchoGuard, FRAME_SAMPLES } from './echoGuard'
import { SAMPLE_RATE } from './utteranceCutter'

const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000

/** A deterministic, speech-like loudness pattern: syllables of varying strength with gaps. */
const syllable = (k: number) => (k % 7 === 6 ? 0.002 : 0.05 + (0.1 * ((k * 37) % 11)) / 10)
const pattern = (n: number) => Array.from({ length: n }, (_, k) => syllable(k))

function frames(levels: number[]): Float32Array {
	const out = new Float32Array(levels.length * FRAME_SAMPLES)
	levels.forEach((lv, k) => out.fill(lv, k * FRAME_SAMPLES, (k + 1) * FRAME_SAMPLES))
	return out
}

describe('EchoGuard', () => {
	it('drops a microphone utterance that is only the call heard through the speakers', () => {
		const guard = new EchoGuard()
		const call = pattern(60)
		guard.observeTab(frames(call), 10_000)
		const echo = call.map((v) => v * 0.3) // quieter, same shape
		const verdict = guard.review({
			samples: frames(echo),
			startedAt: 10_000 - 60 * FRAME_MS,
			endedAt: 10_000,
		})
		expect(verdict.action).toBe('drop')
		expect(verdict.corr).toBeGreaterThan(0.9)
	})

	it('keeps the user speaking while the call is silent', () => {
		const guard = new EchoGuard()
		guard.observeTab(frames(new Array(60).fill(0.001)), 10_000)
		const verdict = guard.review({
			samples: frames(pattern(60)),
			startedAt: 10_000 - 60 * FRAME_MS,
			endedAt: 10_000,
		})
		expect(verdict.action).toBe('keep')
	})

	it('keeps the user when there is no tab audio at all (headphones)', () => {
		const verdict = new EchoGuard().review({
			samples: frames(pattern(40)),
			startedAt: 0,
			endedAt: 1200,
		})
		expect(verdict.action).toBe('keep')
	})

	it("does not drop the user's own words said right after the call audio", () => {
		const guard = new EchoGuard()
		const call = [...pattern(30), ...new Array(40).fill(0.001)]
		guard.observeTab(frames(call), 10_000)
		const echoThenUser = [
			...call.slice(0, 30).map((v) => v * 0.3),
			// the user takes over with a loud, very different pattern once the call has gone quiet
			...Array.from({ length: 40 }, (_, k) => (k % 5 === 4 ? 0.003 : 0.4)),
		]
		const verdict = guard.review({
			samples: frames(echoThenUser),
			startedAt: 10_000 - 70 * FRAME_MS,
			endedAt: 10_000,
		})
		expect(verdict.action).not.toBe('drop')
		if (verdict.action === 'crop') {
			expect(verdict.utterance!.samples.length).toBeLessThan(echoThenUser.length * FRAME_SAMPLES)
		}
	})

	it('keeps bounded history however long the call runs', () => {
		const guard = new EchoGuard({ ...DEFAULT_ECHO_OPTIONS, historyFrames: 100 })
		for (let i = 0; i < 50; i++) guard.observeTab(frames(pattern(20)), (i + 1) * 600)
		expect(guard.heldFrames).toBe(100)
	})
})
