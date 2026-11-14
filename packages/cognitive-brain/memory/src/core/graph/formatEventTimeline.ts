import type { EventSummary } from '../../types'

/**
 * Render recent events (designCognitiveBrain.md §16.8.3 read-back) as a
 * compact markdown list suitable for direct prompt injection, per §17.6's
 * assembly order (section 5, after Compaction Recap). Deliberately LLM-free -
 * same rationale as Compaction Recap (§17.4): this is a raw list, not a
 * synthesized narrative, so there's nothing for an LLM pass to add.
 */
export function formatEventTimeline(events: EventSummary[]): string {
	if (events.length === 0) return ''

	const lines = events.map((e) => {
		const actor = e.actorName ?? 'Someone'
		const parts = [`${actor} ${e.predicate}`]
		if (e.targetName) parts.push(e.targetName)
		let line = `- ${parts.join(' ')}`
		if (e.contextName) line += ` (${e.contextName})`
		line += ` — ${new Date(e.occurredAt).toLocaleDateString()}`
		return line
	})

	return `Recent activity:\n${lines.join('\n')}`
}

export default formatEventTimeline
