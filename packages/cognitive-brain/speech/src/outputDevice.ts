/**
 * Whether the user is likely wearing headphones. A browser cannot say this directly, so it is read from
 * two weak signals, and "unknown" is a real answer rather than a guess. Pure.
 */
export type OutputKind = 'headphones' | 'speakers' | 'unknown'

const HEADPHONES =
	/head(?:phone|set)|ear(?:phone|bud|pod)|airpods|\bbuds\b|\bhands[- ]?free\b|bluetooth/i
const SPEAKERS = /\bspeakers?\b|\bdisplay audio\b|\bhdmi\b|\bmonitor\b/i

/**
 * @param outputLabel label of the default audio output device ('' when the browser hides it)
 * @param echoDropped microphone pickups that were the call heard through the speakers; any is proof of speakers
 */
export function outputKind(outputLabel: string, echoDropped: number): OutputKind {
	if (echoDropped > 0) return 'speakers'
	// Headphones are checked first: "Headphones (Realtek Speakers)" names both, and the headphones word wins.
	if (HEADPHONES.test(outputLabel)) return 'headphones'
	if (SPEAKERS.test(outputLabel)) return 'speakers'
	return 'unknown'
}
