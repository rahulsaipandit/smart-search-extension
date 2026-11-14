import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	configureTransformersLoader,
	createCdnTransformersLoader,
	loadTransformers,
} from './transformersLoader'

afterEach(() => {
	configureTransformersLoader(null)
	vi.unstubAllGlobals()
})

describe('loadTransformers', () => {
	it('throws a clear error until a host registers a loader', async () => {
		await expect(loadTransformers()).rejects.toThrow(/No transformers loader registered/)
	})

	it('uses the registered loader', async () => {
		const mod = { pipeline: () => 'p' }
		configureTransformersLoader(async () => mod)
		await expect(loadTransformers()).resolves.toBe(mod)
	})

	it('stops using a loader that was cleared', async () => {
		configureTransformersLoader(async () => ({}))
		configureTransformersLoader(null)
		await expect(loadTransformers()).rejects.toThrow(/No transformers loader registered/)
	})
})

describe('createCdnTransformersLoader', () => {
	const CDN =
		'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js'

	/** Replaces `Function` so the code that would be run is captured instead of executed. */
	function captureCode(): string[] {
		const seen: string[] = []
		vi.stubGlobal('Function', function (code: string) {
			seen.push(code)
			return () => Promise.resolve({ loaded: true })
		})
		return seen
	}

	it('imports the URL it was given', async () => {
		const seen = captureCode()
		await expect(createCdnTransformersLoader(CDN)()).resolves.toEqual({ loaded: true })
		expect(seen).toEqual([`return import(${JSON.stringify(CDN)})`])
	})

	it.each([
		'http://cdn.example.test/t.js',
		'file:///etc/passwd',
		'data:text/javascript,alert(1)',
		'javascript:alert(1)',
	])('rejects a URL that is not https: %s', (url) => {
		expect(() => createCdnTransformersLoader(url)).toThrow()
	})

	it.each(['not a url', '', '/relative/path.js', '//cdn.example.test/t.js'])(
		'rejects a value that is not an absolute URL: "%s"',
		(url) => {
			expect(() => createCdnTransformersLoader(url)).toThrow()
		}
	)

	it('cannot close the string literal and run other code', async () => {
		const seen = captureCode()
		await createCdnTransformersLoader('https://cdn.example.test/t.js");globalThis.pwned=1;("')()
		const code = seen[0]
		// The quote is percent-encoded by URL parsing and the whole specifier is one JSON string.
		expect(code).toMatch(
			/^return import\("https:\/\/cdn\.example\.test\/t\.js%22\);globalThis\.pwned=1;\(%22"\)$/
		)
		expect(code.slice('return import('.length, -1)).toBe(
			JSON.stringify(JSON.parse(code.slice('return import('.length, -1)))
		)
	})
})
