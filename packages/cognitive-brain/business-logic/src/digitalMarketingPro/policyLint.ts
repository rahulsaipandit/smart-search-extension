/**
 * Content-review / policy lint (design doc §4.2). Brand-hijacking is a hard
 * block, not a soft warning — research (§2.1 item 8) found practitioners
 * report a permanent App Store account ban as the real consequence, so the
 * in-product copy states that outcome rather than a vague "may violate
 * policy." Anti-stuffing is enforced by construction in the keyword-field
 * packer (contentGeneration.ts); this still flags any residual repetition
 * across title/subtitle/keyword-field for visibility.
 */
import type { ListingContent, PolicyLintIssue } from './types'

function wordsOf(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length > 2)
	)
}

export function lintListing(content: ListingContent, competitorNames: string[]): PolicyLintIssue[] {
	const issues: PolicyLintIssue[] = []
	const haystack =
		`${content.title} ${content.subtitle} ${content.description} ${content.keywordField ?? ''}`.toLowerCase()

	for (const rawName of competitorNames) {
		const name = rawName.trim().toLowerCase()
		if (name.length < 2) continue
		if (haystack.includes(name)) {
			issues.push({
				severity: 'block',
				message: `"${rawName}" (a competitor/brand name) appears in your listing — targeting competitor brand names can result in a permanent App Store account ban, not just a rejected update.`,
			})
		}
	}

	const fieldLabel =
		content.keywordField !== undefined ? 'title/subtitle/keyword-field' : 'title/subtitle'
	const fieldWordSets = [
		wordsOf(content.title),
		wordsOf(content.subtitle),
		...(content.keywordField !== undefined ? [wordsOf(content.keywordField)] : []),
	]
	const counts = new Map<string, number>()
	for (const set of fieldWordSets) {
		for (const word of set) counts.set(word, (counts.get(word) ?? 0) + 1)
	}
	for (const [word, count] of counts) {
		if (count > 1) {
			issues.push({
				severity: 'warning',
				message: `"${word}" appears in ${count} of ${fieldLabel} — repeating a term across fields wastes character budget that could cover a different keyword instead.`,
			})
		}
	}

	return issues
}
