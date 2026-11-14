import type { MemoryEntry } from '../../types'
import { ContextBuilder } from '../context/ContextBuilder'

/**
 * CompactionRecap - designCognitiveBrain.md §17.4. WorkingMemoryManager already
 * evicts entries by lowest-salience-first when its token budget is exceeded;
 * today that eviction just drops the entry with nothing summarizing what was
 * lost. This buffer closes that gap by capturing a one-line summary of each
 * evicted entry before it's dropped (via WorkingMemoryManager.onEvict()).
 *
 * Deliberately LLM-free ("this is intentionally cheap... a safety net against
 * silent context loss, not a second synthesis pipeline") - reuses
 * ContextBuilder.formatEntry()'s existing per-type formatting rather than
 * composing new prose, and the buffer itself is token-capped (default 200
 * tokens), oldest lines dropping first when the cap is exceeded - the same
 * eviction shape as working memory itself, applied FIFO-by-age to recap lines
 * instead of salience-ordered to memory entries.
 */

const DEFAULT_TOKEN_BUDGET = 200

export class CompactionRecap {
	private lines: string[] = []
	private readonly tokenBudget: number
	private contextBuilder = new ContextBuilder()

	constructor(tokenBudget: number = DEFAULT_TOKEN_BUDGET) {
		this.tokenBudget = tokenBudget
	}

	/** Capture an evicted entry as a one-line summary, then trim to budget. */
	append(entry: MemoryEntry): void {
		this.lines.push(this.contextBuilder.formatEntry(entry).split('\n').join(' '))
		this.trim()
	}

	/** Render the current recap, or '' if nothing has been evicted (§17.6 - conditionally empty). */
	render(): string {
		if (this.lines.length === 0) return ''
		return `Recently dropped from working memory (context still applies):\n${this.lines.map((l) => `- ${l}`).join('\n')}`
	}

	/** Clear the buffer - e.g. on session end. */
	clear(): void {
		this.lines = []
	}

	private trim(): void {
		while (
			this.lines.length > 0 &&
			this.contextBuilder.estimateTokens(this.lines.join('\n')) > this.tokenBudget
		) {
			this.lines.shift()
		}
	}
}

export default CompactionRecap
