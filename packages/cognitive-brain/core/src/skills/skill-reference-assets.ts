// Type-and-default shim: Metro picks skill-reference-assets.native.ts or .web.ts at build time; this file only lets
// TypeScript (and tools that ignore platform extensions) resolve the module. It lists no references.
export const SKILL_REFERENCES: Record<string, { id: string; module: any }[]> = {}
