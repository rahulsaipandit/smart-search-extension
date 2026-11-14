import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
	// Resolve @page-agent/llms straight to its source, so the tests also run where the package is not linked into
	// node_modules (the Expo app is not an npm workspace and maps it through babel.config.js / tsconfig.json). In this
	// monorepo the workspace link resolves to the same file.
	resolve: {
		alias: [
			{
				find: /^@page-agent\/llms$/,
				replacement: fileURLToPath(new URL('../llms/src/index.ts', import.meta.url)),
			},
		],
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// The mobile client's Jest suite uses Jest globals and cannot load here. Its other tests (loopGuard) are
		// dependency-free and do run.
		exclude: [...configDefaults.exclude, 'src/native-mcp-client/__tests__/**'],
	},
})
