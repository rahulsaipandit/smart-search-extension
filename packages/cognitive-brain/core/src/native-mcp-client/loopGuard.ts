/**
 * Repeat detection for the agentic loop: the same tool call again and again, or two calls taking turns, is a
 * loop going nowhere. Dependency-free so the loop stays portable (web and React Native).
 */
export interface LoopVerdict {
	stop: boolean
	reason?: 'repeated_call' | 'ping_pong'
}

export interface LoopGuard {
	/** Records one requested call and says whether the loop should stop before running it. */
	record(name: string, args: unknown): LoopVerdict
}

export interface LoopGuardOptions {
	/** The same call this many times in a row stops the loop (the call that reaches the count is not run). */
	maxRepeats: number
}

/** A call's identity: its name and arguments, with object keys in a stable order. */
function callKey(name: string, args: unknown): string {
	const stable = (v: unknown): unknown =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v as Record<string, unknown>)
						.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
						.map(([k, x]) => [k, stable(x)])
				)
			: Array.isArray(v)
				? v.map(stable)
				: v
	return `${name}:${JSON.stringify(stable(args))}`
}

export function createLoopGuard({ maxRepeats }: LoopGuardOptions): LoopGuard {
	if (!Number.isInteger(maxRepeats) || maxRepeats < 1) {
		// 0 would stop every run at its first call; the caller turns the guard off by not creating it.
		throw new RangeError(`maxRepeats must be a whole number of at least 1, got ${maxRepeats}`)
	}
	// Only the last four calls matter, so memory stays flat however long the run is.
	const recent: string[] = []
	let run = 0
	return {
		record(name, args) {
			const key = callKey(name, args)
			run = recent[recent.length - 1] === key ? run + 1 : 1
			recent.push(key)
			if (recent.length > 4) recent.shift()
			if (run >= maxRepeats) return { stop: true, reason: 'repeated_call' }
			// A, B, A, B: two different calls taking turns.
			const [a, b, c, d] = recent.length === 4 ? recent : []
			if (a !== undefined && a === c && b === d && a !== b)
				return { stop: true, reason: 'ping_pong' }
			return { stop: false }
		},
	}
}
