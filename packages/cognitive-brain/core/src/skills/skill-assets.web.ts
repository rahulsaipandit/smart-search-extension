/* eslint-disable @typescript-eslint/no-require-imports -- Vite/Metro resolve require() of bundled assets statically */
// Built-in skill asset modules for Metro web builds.
// .md files are in assetExts (metro.config.js) so require() works on web.
// On web, require() returns an asset URL; expo-asset + fetch() reads the content.
// Mirrors skill-assets.native.ts — keep both lists in sync when adding skills.
export const BUILT_IN_SKILL_MODULES: any[] = [
	require('../../skills/summarizer/SKILL.md'),
	require('../../skills/code-reviewer/SKILL.md'),
	require('../../skills/explain-simply/SKILL.md'),
	require('../../skills/rewriter/SKILL.md'),
	require('../../skills/brainstormer/SKILL.md'),
	require('../../skills/negotiation/SKILL.md'),
	require('../../skills/feynman-learning/SKILL.md'),
	require('../../skills/project-based-learning-track/SKILL.md'),
	require('../../skills/skill-acquisition-map/SKILL.md'),
	require('../../skills/storm-research/SKILL.md'),
	require('../../skills/win-win-negotiator/SKILL.md'),
	require('../../skills/deliberate-practice-sprint/SKILL.md'),
	require('../../skills/anti-procrastination-framework/SKILL.md'),
	require('../../skills/therapist/SKILL.md'),
	require('../../skills/carl-rogers-therapist/SKILL.md'),
	require('../../skills/jungian-journaling/SKILL.md'),
	require('../../skills/meeting-insights/SKILL.md'),
	require('../../skills/symptom-triage/SKILL.md'),
	require('../../skills/senior-leader-language/SKILL.md'),
	require('../../skills/executive-interview-coach/SKILL.md'),
]
