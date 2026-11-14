/**
 * One transcription session: audio blocks from the two channels go in, transcribed segments come
 * out. Holds an utterance cutter per channel and a queue in front of the model, so a model that is
 * slower than speech falls behind visibly (a `dropped` count) rather than silently or without bound.
 *
 * The engine is injected, so this is tested with a fake one. The offscreen document owns the real
 * engine and calls `feed` from the audio capture.
 */
import { EchoGuard } from './echoGuard'
import type { SttChannel, SttEngine, SttPollResult, SttSegment } from './types'
import { SAMPLE_RATE, UtteranceCutter } from './utteranceCutter'
import type { Utterance } from './utteranceCutter'

/** Utterances allowed to wait for the model. Older ones are dropped and counted. */
export const MAX_BACKLOG = 4
/** Segments kept for polling; the oldest go first so a long call does not grow without bound. */
const MAX_KEPT_SEGMENTS = 2000

/** Longest merged utterance; Whisper hears at most 30 s per request. */
const MAX_MERGED_MS = 25_000
const MERGE_GAP_MS = 200

/** Whisper writes these for silence and noise. They are not speech. */
const NON_SPEECH = /^\s*(?:[[(*♪].*[\])*♪]|\.+|-+)\s*$/

/**
 * Phrases Whisper invents from near-silence (its training data is full of video outros). Short real
 * phrases such as "thank you" or "bye" are NOT listed: dropping them would delete real speech.
 */
const PHANTOM_PHRASES = new Set([
	'thanks for watching',
	'thank you for watching',
	'please subscribe',
	'subscribe',
	'thanks for listening',
	'the end',
])

/** True when the text is silence markers, an invented outro, or one word repeated five or more times ("you you you you you"). */
export function isNonSpeech(text: string): boolean {
	if (NON_SPEECH.test(text)) return true
	const lower = text
		.toLowerCase()
		.replace(/[.!?,\s]+/g, ' ')
		.trim()
	if (!lower || PHANTOM_PHRASES.has(lower)) return true
	const words = lower.split(' ')
	return words.length >= 5 && words.every((w) => w === words[0])
}

/** Anonymous speaker for most of a stretch of call audio, or undefined when it cannot say. */
export type SpeakerSource = (startMs: number, endMs: number) => string | undefined

interface Job {
	channel: SttChannel
	utterance: Utterance
}

/**
 * Joins two waiting jobs of the same channel into one, with a short gap of silence between them.
 * Nothing is lost, and one request costs about the same whatever the clip length. Neighbours are
 * preferred; when the waiting speech alternates between the mic and the call, the oldest job is
 * joined with the next one of its own channel, which can lift that later one past an utterance from
 * the other side. The transcript is ordered by start time, so the only effect is that the other
 * side's reply shows after the merged line instead of between its two parts.
 * Returns false when no pair fits under the model's limit.
 */
function mergeOldestPair(queue: Job[]): boolean {
	const maxSamples = (MAX_MERGED_MS / 1000) * SAMPLE_RATE
	const gap = Math.round((MERGE_GAP_MS / 1000) * SAMPLE_RATE)
	const fits = (a: Job, b: Job) =>
		a.channel === b.channel &&
		a.utterance.samples.length + gap + b.utterance.samples.length <= maxSamples
	const join = (i: number, j: number) => {
		const a = queue[i]
		const b = queue[j]
		const samples = new Float32Array(a.utterance.samples.length + gap + b.utterance.samples.length)
		samples.set(a.utterance.samples, 0)
		samples.set(b.utterance.samples, a.utterance.samples.length + gap)
		queue.splice(j, 1)
		queue[i] = {
			channel: a.channel,
			utterance: { samples, startedAt: a.utterance.startedAt, endedAt: b.utterance.endedAt },
		}
	}
	for (let i = 0; i + 1 < queue.length; i++) {
		if (fits(queue[i], queue[i + 1])) {
			join(i, i + 1)
			return true
		}
	}
	for (let i = 0; i < queue.length; i++) {
		for (let j = i + 2; j < queue.length; j++) {
			if (fits(queue[i], queue[j])) {
				join(i, j)
				return true
			}
		}
	}
	return false
}

export class SttSession {
	private readonly cutters: Record<SttChannel, UtteranceCutter> = {
		mic: new UtteranceCutter(),
		tab: new UtteranceCutter(),
	}
	private readonly queue: Job[] = []
	private segments: SttSegment[] = []
	private seq = 0
	private dropped = 0
	private merged = 0
	private echoDropped = 0
	private readonly echo = new EchoGuard()
	private error: string | null = null
	private running = false
	/** The current run of the queue, so `dispose` can wait for the transcription in flight. */
	private pumping: Promise<void> | null = null
	private disposed = false
	private speakerOf: SpeakerSource | undefined
	/** Set once a speaker source has thrown, so the failure is logged once and not on every segment. */
	private speakerFailureLogged = false

	private readonly engine: SttEngine
	private readonly channels: ReadonlySet<SttChannel>

	/**
	 * @param channels the channels that are transcribed. A call uses both; dictation uses only the microphone,
	 * so there is no call audio for the echo guard to compare against and none is transcribed.
	 */
	constructor(engine: SttEngine, channels: readonly SttChannel[] = ['mic', 'tab']) {
		this.engine = engine
		this.channels = new Set(channels)
	}

	/**
	 * Names who spoke on the call tab, when speaker separation runs. Asked once per finished tab segment; an
	 * undefined answer keeps the shared "Others" label. It is not asked again later, so a segment is labelled
	 * only when the separation model had already scored its stretch by the time its text was ready.
	 */
	setSpeakerSource(source: SpeakerSource | undefined): void {
		this.speakerOf = source
	}

	/** One block of 16 kHz mono audio; `endMs` is epoch ms at its end. */
	feed(channel: SttChannel, samples: Float32Array, endMs: number): void {
		if (this.disposed || this.error || !this.channels.has(channel)) return
		if (channel === 'tab') this.echo.observeTab(samples, endMs)
		for (const utterance of this.cutters[channel].push(samples, endMs)) {
			if (channel === 'mic' && this.channels.has('tab')) {
				// The mic hearing the call through the speakers is not the user speaking.
				const verdict = this.echo.review(utterance)
				if (verdict.action === 'drop') {
					this.echoDropped++
					continue
				}
				this.enqueue({ channel, utterance: verdict.utterance ?? utterance })
			} else {
				this.enqueue({ channel, utterance })
			}
		}
	}

	/** Segments after `afterSeq` (pass -1 for all), and the state of the queue. */
	poll(afterSeq: number): SttPollResult {
		return {
			segments: this.segments.filter((s) => s.seq > afterSeq),
			dropped: this.dropped,
			merged: this.merged,
			echoDropped: this.echoDropped,
			backlog: this.queue.length + (this.running ? 1 : 0),
			error: this.error,
		}
	}

	/**
	 * Stops, drops what is waiting and speech in progress, and releases the model once the transcription
	 * already running has finished (releasing it under that call would fail it). Nothing reads the
	 * results after a stop, so finishing the rest would only delay the stop.
	 */
	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		this.queue.length = 0
		await this.pumping
		await this.engine.dispose()
	}

	private enqueue(job: Job): void {
		this.queue.push(job)
		while (this.queue.length > MAX_BACKLOG) {
			// Join neighbours first so a model that is behind loses nothing; only when none can be joined
			// is the oldest dropped, and that is counted and shown.
			if (mergeOldestPair(this.queue)) {
				this.merged++
			} else {
				this.queue.shift()
				this.dropped++
			}
		}
		if (!this.running) this.pumping = this.pump()
	}

	/**
	 * Asks the speaker source, which is optional extra information: a source that throws must not stop
	 * transcription, so the line keeps the shared "Others" label. The first failure is logged, once.
	 */
	private speakerFor(startMs: number, endMs: number): string | undefined {
		try {
			return this.speakerOf?.(startMs, endMs)
		} catch (e) {
			if (!this.speakerFailureLogged) {
				this.speakerFailureLogged = true
				console.warn('[SttSession] speaker source failed; keeping "Others" for these lines:', e)
			}
			return undefined
		}
	}

	private async pump(): Promise<void> {
		this.running = true
		try {
			while (this.queue.length > 0 && !this.disposed && !this.error) {
				const job = this.queue.shift()!
				const { text } = await this.engine.transcribe(job.utterance.samples)
				const clean = text.trim()
				if (this.disposed || !clean || isNonSpeech(clean)) continue
				const { startedAt, endedAt } = job.utterance
				const speaker = job.channel === 'tab' ? this.speakerFor(startedAt, endedAt) : undefined
				this.segments.push({
					id: `stt-${this.seq}`,
					seq: this.seq++,
					channel: job.channel,
					text: clean,
					startedAt,
					endedAt,
					...(speaker ? { speaker } : {}),
				})
				if (this.segments.length > MAX_KEPT_SEGMENTS) this.segments.shift()
			}
		} catch (e) {
			if (this.disposed) return
			// Kept and shown: a model that fails must not look like a call where nobody spoke.
			this.error = e instanceof Error ? e.message : String(e)
			this.queue.length = 0
		} finally {
			this.running = false
		}
	}
}
