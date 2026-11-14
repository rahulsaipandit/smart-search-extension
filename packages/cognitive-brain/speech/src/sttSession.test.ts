import { describe, expect, it, vi } from 'vitest'

import { MAX_BACKLOG, SttSession, isNonSpeech } from './sttSession'
import type { SttEngine } from './types'
import { SAMPLE_RATE } from './utteranceCutter'

/** A block of loud audio then a quiet one, ending at `endMs`, so the cutter closes an utterance. */
function speak(session: SttSession, channel: 'mic' | 'tab', startMs: number) {
	const block = (level: number) => new Float32Array(SAMPLE_RATE / 2).fill(level)
	session.feed(channel, block(0.001), startMs)
	session.feed(channel, block(0.2), startMs + 500)
	session.feed(channel, block(0.2), startMs + 1000)
	session.feed(channel, block(0.001), startMs + 1500)
	session.feed(channel, block(0.001), startMs + 2000)
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('SttSession', () => {
	it('transcribes an utterance into a segment on the right channel', async () => {
		const engine: SttEngine = {
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(async () => ({ text: ' Can we talk pricing? ' })),
			dispose: vi.fn(async () => {}),
		}
		const session = new SttSession(engine)
		speak(session, 'tab', 10_000)
		await flush()
		const out = session.poll(-1)
		expect(out.segments).toHaveLength(1)
		expect(out.segments[0]).toMatchObject({ channel: 'tab', text: 'Can we talk pricing?', seq: 0 })
		expect(session.poll(0).segments).toEqual([])
	})

	it("drops Whisper's silence markers instead of showing them as speech", async () => {
		const engine: SttEngine = {
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(async () => ({ text: '[BLANK_AUDIO]' })),
			dispose: vi.fn(async () => {}),
		}
		const session = new SttSession(engine)
		speak(session, 'mic', 0)
		await flush()
		expect(session.poll(-1).segments).toEqual([])
	})

	it('joins waiting speech instead of dropping it when the model is slower than speech', async () => {
		let release: () => void = () => {}
		const engine: SttEngine = {
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(
				() => new Promise<{ text: string }>((r) => (release = () => r({ text: 'late' })))
			),
			dispose: vi.fn(async () => {}),
		}
		const session = new SttSession(engine)
		for (let i = 0; i < MAX_BACKLOG + 3; i++) speak(session, 'tab', i * 10_000)
		await flush()
		const out = session.poll(-1)
		expect(out.merged).toBeGreaterThan(0)
		expect(out.dropped).toBe(0)
		expect(out.backlog).toBeLessThanOrEqual(MAX_BACKLOG + 1)
		release()
	})

	it('joins across the other side when the waiting speech alternates between the mic and the call', async () => {
		let release: () => void = () => {}
		const engine: SttEngine = {
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(
				() => new Promise<{ text: string }>((r) => (release = () => r({ text: 'late' })))
			),
			dispose: vi.fn(async () => {}),
		}
		const session = new SttSession(engine)
		for (let i = 0; i < MAX_BACKLOG + 4; i++) speak(session, i % 2 ? 'mic' : 'tab', i * 10_000)
		await flush()
		const out = session.poll(-1)
		expect(out.merged).toBeGreaterThan(0)
		expect(out.dropped).toBe(0)
		release()
	})

	it('drops, and counts it, only when no two waiting utterances of a channel fit together', async () => {
		let release: () => void = () => {}
		const engine: SttEngine = {
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(
				() => new Promise<{ text: string }>((r) => (release = () => r({ text: 'late' })))
			),
			dispose: vi.fn(async () => {}),
		}
		const session = new SttSession(engine)
		// Each utterance is about 14 s, so two of the same channel pass the 25 s limit.
		const speakLong = (channel: 'mic' | 'tab', startMs: number) => {
			const block = (level: number, seconds: number) =>
				new Float32Array(SAMPLE_RATE * seconds).fill(level)
			session.feed(channel, block(0.001, 1), startMs)
			session.feed(channel, block(0.2, 14), startMs + 15_000)
			session.feed(channel, block(0.001, 1), startMs + 16_000)
			session.feed(channel, block(0.001, 1), startMs + 17_000)
		}
		for (let i = 0; i < MAX_BACKLOG + 3; i++) speakLong(i % 2 ? 'mic' : 'tab', i * 30_000)
		await flush()
		const out = session.poll(-1)
		expect(out.dropped).toBeGreaterThan(0)
		release()
	})

	it('leaves out microphone speech that is only the call heard through the speakers', async () => {
		const engine: SttEngine = {
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(async () => ({ text: 'Can we talk pricing?' })),
			dispose: vi.fn(async () => {}),
		}
		const session = new SttSession(engine)
		// Same syllable pattern on both channels, the mic a third as loud.
		const send = (channel: 'mic' | 'tab', scale: number, endMs: number) => {
			const block = new Float32Array(SAMPLE_RATE / 2)
			for (let i = 0; i < block.length; i++)
				block[i] =
					(Math.floor(i / 480) % 7 === 6 ? 0.002 : 0.08 + 0.02 * (Math.floor(i / 480) % 5)) * scale
			session.feed(channel, block, endMs)
		}
		const quiet = (channel: 'mic' | 'tab', endMs: number) =>
			session.feed(channel, new Float32Array(SAMPLE_RATE / 2).fill(0.001), endMs)
		for (const channel of ['tab', 'mic'] as const) quiet(channel, 500)
		for (let t = 1000; t <= 3000; t += 500) {
			send('tab', 1, t)
			send('mic', 0.33, t)
		}
		for (let t = 3500; t <= 5000; t += 500) {
			quiet('tab', t)
			quiet('mic', t)
		}
		await flush()
		const out = session.poll(-1)
		expect(out.segments.map((s) => s.channel)).toEqual(['tab'])
		expect(out.echoDropped).toBe(1)
	})

	it('reports a failing model and stops, so a failure does not look like silence', async () => {
		const engine: SttEngine = {
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(async () => {
				throw new Error('out of memory')
			}),
			dispose: vi.fn(async () => {}),
		}
		const session = new SttSession(engine)
		speak(session, 'tab', 0)
		await flush()
		expect(session.poll(-1).error).toBe('out of memory')
	})

	it('releases the model on dispose', async () => {
		const dispose = vi.fn(async () => {})
		const session = new SttSession({
			id: 'whisper',
			load: vi.fn(),
			transcribe: vi.fn(),
			dispose,
		} as unknown as SttEngine)
		await session.dispose()
		expect(dispose).toHaveBeenCalledOnce()
	})
	it('waits for the transcription in flight before releasing the model, and drops what was queued', async () => {
		const order: string[] = []
		let finish: () => void = () => {}
		const transcribe = vi.fn(
			() =>
				new Promise<{ text: string }>((resolve) => {
					finish = () => {
						order.push('transcribed')
						resolve({ text: 'late words' })
					}
				})
		)
		const dispose = vi.fn(async () => {
			order.push('released')
		})
		const session = new SttSession({
			id: 'whisper',
			load: vi.fn(),
			transcribe,
			dispose,
		} as unknown as SttEngine)
		speak(session, 'tab', 0)
		speak(session, 'tab', 10_000)
		await flush()

		const disposing = session.dispose()
		await flush()
		expect(dispose).not.toHaveBeenCalled()

		finish()
		await disposing
		expect(order).toEqual(['transcribed', 'released'])
		// The second utterance was waiting; it is dropped, not transcribed after the stop.
		expect(transcribe).toHaveBeenCalledTimes(1)
		expect(session.poll(-1).segments).toEqual([])
	})

	it('does not report an error for a transcription that was running when it was stopped', async () => {
		let fail: (e: Error) => void = () => {}
		const transcribe = vi.fn(() => new Promise<{ text: string }>((_, reject) => (fail = reject)))
		const session = new SttSession({
			id: 'whisper',
			load: vi.fn(),
			transcribe,
			dispose: vi.fn(async () => {}),
		} as unknown as SttEngine)
		speak(session, 'mic', 0)
		await flush()
		const disposing = session.dispose()
		fail(new Error('engine disposed'))
		await disposing
		expect(session.poll(-1).error).toBeNull()
	})
})

describe('isNonSpeech', () => {
	it.each([
		'[BLANK_AUDIO]',
		'(silence)',
		'...',
		'Thanks for watching!',
		'Please subscribe.',
		'you you you you you',
	])('rejects %s', (t) => expect(isNonSpeech(t)).toBe(true))

	it.each(['Thank you.', 'Bye.', 'You', 'No, no, that is fine', 'Yes yes', 'no no no'])(
		'keeps real short speech: %s',
		(t) => expect(isNonSpeech(t)).toBe(false)
	)
})

describe('SttSession speaker labels', () => {
	const engine = (): SttEngine => ({
		id: 'whisper',
		load: vi.fn(),
		transcribe: vi.fn(async () => ({ text: 'Let us talk pricing' })),
		dispose: vi.fn(async () => {}),
	})

	it('labels call-tab lines with the speaker the source names, for the stretch that was spoken', async () => {
		const session = new SttSession(engine())
		const asked: [number, number][] = []
		session.setSpeakerSource((start, end) => {
			asked.push([start, end])
			return 'Speaker 2'
		})
		speak(session, 'tab', 10_000)
		await flush()
		const [segment] = session.poll(-1).segments
		expect(segment.speaker).toBe('Speaker 2')
		expect(asked).toEqual([[segment.startedAt, segment.endedAt]])
	})

	it('keeps transcribing, with the shared label, when the speaker source throws, and logs once', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const session = new SttSession(engine())
		session.setSpeakerSource(() => {
			throw new Error('diarizer crashed')
		})
		speak(session, 'tab', 10_000)
		speak(session, 'tab', 40_000)
		await flush()
		const poll = session.poll(-1)
		expect(poll.error).toBeNull()
		expect(poll.segments.length).toBeGreaterThan(1)
		expect(poll.segments.every((s) => s.speaker === undefined)).toBe(true)
		expect(warn).toHaveBeenCalledTimes(1)
		warn.mockRestore()
	})

	it('leaves a line unlabelled when the source cannot say, and never labels the microphone', async () => {
		const session = new SttSession(engine())
		session.setSpeakerSource(() => undefined)
		speak(session, 'tab', 10_000)
		await flush()
		expect(session.poll(-1).segments[0]).not.toHaveProperty('speaker')

		const dictation = new SttSession(engine(), ['mic'])
		dictation.setSpeakerSource(() => 'Speaker 1')
		speak(dictation, 'mic', 0)
		await flush()
		expect(dictation.poll(-1).segments[0]).not.toHaveProperty('speaker')
	})
})
