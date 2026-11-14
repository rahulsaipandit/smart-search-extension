import type { Profile } from '../../types'

/**
 * Render a Profile (designCognitiveBrain.md §17.2) as the first system-prompt
 * section per §17.6's assembly order. Headers with no static/dynamic prose
 * yet (no facts classified into them) are omitted rather than printed empty,
 * so a fresh profile with zero facts renders as ''.
 */
export function formatProfileForPrompt(profile: Profile): string {
	const lines: string[] = []

	for (const section of profile.sections) {
		const parts: string[] = []
		if (section.static) parts.push(section.static)
		if (section.dynamic) parts.push(section.dynamic)
		if (parts.length === 0) continue
		lines.push(`${section.header}: ${parts.join(' ')}`)
	}

	if (lines.length === 0) return ''
	return `What you know about the user:\n${lines.join('\n')}`
}

export default formatProfileForPrompt
