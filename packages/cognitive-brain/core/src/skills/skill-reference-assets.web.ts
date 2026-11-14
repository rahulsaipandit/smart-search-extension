/* eslint-disable @typescript-eslint/no-require-imports -- Vite/Metro resolve require() of bundled assets statically */
// Reference texts a built-in skill retrieves from through RAG while it is active (see app-core services/skills/skillReferences.ts).
// On web require() returns an asset URL; the text is read with fetch(). Mirrors skill-reference-assets.native.ts — keep both in sync.
export const SKILL_REFERENCES: Record<string, { id: string; module: any }[]> = {
	'executive-interview-coach': [
		{
			id: 'executive-presence-plan',
			module: require('../../skills/executive-interview-coach/references/executive-presence-plan.md'),
		},
	],
}
