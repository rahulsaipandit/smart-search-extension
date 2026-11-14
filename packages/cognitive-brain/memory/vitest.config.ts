// Plain object export (not `defineConfig` from 'vitest/config') so this file
// resolves correctly when vitest is invoked via `npx` without a local install
// of this package's own node_modules (this vendored package has no
// package.json of its own - see package.json.txt - so nothing installs here).
// This package's tsconfig.json extends `../../../tsconfig.base.json` (the repo-root copy of packages/tsconfig.base.json).
// (tsconfig.base.json at the repo root), which didn't exist anywhere in GuideAxon
// until it was added alongside this file - every cognitive-brain subpackage's
// tsconfig.json referenced it, but none of this vendored tree's tooling had
// ever been run standalone in this repo before (see package.json.txt: no
// package.json of its own, nothing installs here). `tsconfigRaw: {}` still
// tells Vite's transform to skip file-based tsconfig lookup entirely, since
// relying on that chain resolving correctly for every subpackage isn't this
// config's concern.
export default {
	oxc: { tsconfigRaw: '{}' },
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
}
