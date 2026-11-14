import { describe, expect, it } from 'vitest'

import { STT_SELF_LABEL, combineTurns, segmentsToTurns } from './sttTurns'
import type { CaptionTurn } from './transcript'
import type { SttSegment } from './types'

const seg = (seq: number, channel: 'mic' | 'tab', text: string, startedAt: number): SttSegment => ({
	id: `stt-${seq}`,
	seq,
	channel,
	text,
	startedAt,
	endedAt: startedAt + 1000,
})

describe('segmentsToTurns', () => {
	it('labels the microphone as the user and the tab as one shared other side', () => {
		const turns = segmentsToTurns([seg(0, 'mic', 'hello', 0), seg(1, 'tab', 'hi there', 2000)])
		expect(turns[0].speaker).toBe(STT_SELF_LABEL)
		expect(turns[1].speaker).not.toBe(STT_SELF_LABEL)
		expect(turns[1]).toMatchObject({
			speaker: 'Others',
			final: true,
			startedAt: 2000,
			updatedAt: 3000,
		})
	})
})

describe('combineTurns', () => {
	const caption: CaptionTurn = {
		id: 'c1',
		speaker: 'Priya',
		text: 'x',
		startedAt: 500,
		updatedAt: 600,
		final: true,
	}
	const spoken = segmentsToTurns([seg(0, 'tab', 'y', 1000)])

	it('uses captions alone while they are live, so nothing is counted twice', () => {
		expect(combineTurns([caption], spoken, true)).toEqual([caption])
	})

	it('adds the transcribed turns, in time order, when captions are not live', () => {
		expect(combineTurns([caption], spoken, false).map((t) => t.id)).toEqual(['c1', 'stt-0'])
	})
})

describe('segmentsToTurns with speaker separation', () => {
	it('uses the anonymous speaker for the call tab, keeps Others for unplaced lines, and never relabels the user', () => {
		const turns = segmentsToTurns([
			{ ...seg(0, 'tab', 'a', 0), speaker: 'Speaker 2' },
			seg(1, 'tab', 'b', 2000),
			{ ...seg(2, 'mic', 'c', 4000), speaker: 'Speaker 1' },
		])
		expect(turns.map((t) => t.speaker)).toEqual(['Speaker 2', 'Others', 'You'])
	})
})
