/* eslint-disable @typescript-eslint/no-require-imports -- Metro resolves require() of bundled assets statically */
// Reference texts a built-in skill retrieves from through RAG while it is active (see app-core services/skills/skillReferences.ts).
// One entry per skill name; the files sit in core/skills/<skill>/references/. Metro bundles them as assets (md is in assetExts).
// Mirrors skill-reference-assets.web.ts — keep both lists in sync.
export const SKILL_REFERENCES: Record<string, { id: string; module: number }[]> = {
	'executive-interview-coach': [
		{
			id: 'executive-presence-plan',
			module: require('../../skills/executive-interview-coach/references/executive-presence-plan.md'),
		},
	],
}
