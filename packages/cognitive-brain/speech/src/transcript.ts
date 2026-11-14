/**
 * A speaker turn of a call transcript. Speech segments (sttTurns.ts) and the browser caption readers
 * both produce this shape, so downstream scoring and interview detection read either unchanged.
 */
export interface CaptionTurn {
	id: string
	speaker: string
	text: string
	/** Epoch ms when the turn first appeared. */
	startedAt: number
	/** Epoch ms of the last text change. */
	updatedAt: number
	/** False while a caption is still being extended, true once it has gone from the page. */
	final: boolean
}
