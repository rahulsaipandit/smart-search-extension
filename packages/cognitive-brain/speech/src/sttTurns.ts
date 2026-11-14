/**
 * Turns transcribed segments into the same caption turns the rest of the app reads, so profile
 * detection, scoring and interview mode work on them unchanged. Pure.
 *
 * Whisper gives no speaker names. The microphone channel is the user ("You", which `isSelfSpeaker`
 * already recognises) and everything on the Meet tab is one shared "Others", unless speaker separation
 * named an anonymous "Speaker N" for the segment. Names are never guessed: a segment it could not place
 * keeps "Others" (docs/designMeetingCoach.md §4.4).
 */
import type { CaptionTurn } from './transcript'
import type { SttSegment } from './types'

export const STT_SELF_LABEL = 'You'
export const STT_OTHERS_LABEL = 'Others'

export function segmentsToTurns(segments: readonly SttSegment[]): CaptionTurn[] {
	return segments.map((s) => ({
		id: s.id,
		speaker: s.channel === 'mic' ? STT_SELF_LABEL : (s.speaker ?? STT_OTHERS_LABEL),
		text: s.text,
		startedAt: s.startedAt,
		updatedAt: s.endedAt,
		final: true,
	}))
}

/**
 * The turns to read. Captions win while they are live, because they carry real names and are more
 * accurate; transcribed turns are added only when captions are not being read, so a call is never
 * counted twice.
 */
export function combineTurns(
	captionTurns: CaptionTurn[],
	sttTurns: CaptionTurn[],
	captionsLive: boolean
): CaptionTurn[] {
	if (captionsLive || sttTurns.length === 0) return captionTurns
	return [...captionTurns, ...sttTurns].sort((a, b) => a.startedAt - b.startedAt)
}
