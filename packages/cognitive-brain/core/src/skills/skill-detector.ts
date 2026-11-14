import type { Skill } from './skill-types'

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Named cross-referencing — one of the open Agent Skills standard's real
 * chaining mechanisms (the other is client-side sequencing, handled by the
 * orchestrator threading one skill's text output into the next). A skill's
 * own instruction body can name the next skill to hand off to, e.g.
 * "...once the topic breakdown is confirmed, invoke the `quiz-generation`
 * skill." This scans the currently-active skill's prose for such a mention
 * and resolves it against the loaded skill list — progressive disclosure
 * means the referenced skill's full body only loads when this step is
 * actually reached, not upfront. No JSON Schema or structured contract
 * involved; this is plain text matching against authored instructions.
 */
function findNamedSkillReference(body: string, skills: Skill[], excludeName: string): Skill | null {
	for (const skill of skills) {
		if (skill.name === excludeName) continue
		// Matches the skill's name as authored instructions naturally reference
		// it — optionally backtick/quote-wrapped, followed by the word "skill".
		const pattern = new RegExp(`[\`'"]?${escapeRegExp(skill.name)}[\`'"]?\\s+skill\\b`, 'i')
		if (pattern.test(body)) return skill
	}
	return null
}

/**
 * The skill that `activeSkill`'s own prose hands off to, if any. Exposed so a caller
 * can put a relevance guard (see app-core skillChainGuard) between the reference and
 * honoring it; pass `{ skipChain: true }` to detectSkill() when the guard rejects it.
 */
export function findChainedSkill(activeSkill: Skill | null, skills: Skill[]): Skill | null {
	if (!activeSkill) return null
	return findNamedSkillReference(activeSkill.instructionBody, skills, activeSkill.name)
}

/**
 * Keyword-based skill detector (Phase 1/2).
 * Counts how many keywords from description + tags appear in the user message.
 * A skill is returned only if the raw count meets the minimum threshold.
 * Phase 3 replaces this with cosine similarity via browser-ml embeddings, at
 * which point Skill.scoreThreshold (0–1) will gate the semantic similarity score.
 *
 * `activeSkill`, when passed, is the skill that was active on the prior turn.
 * If its own instructions name a hand-off skill (see findNamedSkillReference
 * above), that takes priority over re-running fresh keyword detection — this
 * is what lets an authored multi-step flow (goal -> curriculum -> teach ->
 * quiz -> mastery-track) progress skill-by-skill using the skill authors' own
 * prose, rather than relying only on the user's next message matching keywords.
 */
export function detectSkill(
	userMessage: string,
	skills: Skill[],
	activeSkill: Skill | null = null,
	options: { skipChain?: boolean } = {}
): Skill | null {
	if (activeSkill && !options.skipChain) {
		const referenced = findChainedSkill(activeSkill, skills)
		if (referenced) return referenced
	}

	const [top] = rankSkills(userMessage, skills)
	return top && top.score >= 2 ? top.skill : null
}

/**
 * GuideAxon addition: the keyword scores detectSkill() uses, for every skill with at least one hit, best
 * first (ties keep list order, matching detectSkill's strict `>`). The app's skill-detection decision gate
 * (app-core services/decisions, docs/Misc/designJEVMisc.md fit #2) uses the top few as the shortlist a
 * decision model chooses from, so the keyword scorer stays the cheap pre-filter and the fallback.
 */
export function rankSkills(
	userMessage: string,
	skills: Skill[]
): { skill: Skill; score: number }[] {
	const msg = userMessage.toLowerCase()
	const ranked: { skill: Skill; score: number }[] = []
	for (const skill of skills) {
		const keywords = [
			...skill.description.toLowerCase().split(/\W+/),
			...skill.tags.map((t) => t.toLowerCase()),
		]
		const score = keywords.filter((k) => k.length > 3 && msg.includes(k)).length
		if (score > 0) ranked.push({ skill, score })
	}
	// Stable sort: equal scores keep list order, so ranked[0] is the skill detectSkill() always picked.
	return ranked.sort((a, b) => b.score - a.score)
}
