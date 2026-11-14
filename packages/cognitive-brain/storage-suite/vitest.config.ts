// Plain object, like the memory package's config: it resolves when vitest runs without this package's own node_modules.
export default {
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
}
