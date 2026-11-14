import { describe, expect, it } from 'vitest'

import { isAllowedOrigin } from './hub-bridge.js'

const STORE_ORIGIN = 'chrome-extension://akldabonmimlicnjlflnapfeklbfemhj'

describe('isAllowedOrigin', () => {
	it('accepts the extension itself', () => {
		expect(isAllowedOrigin(STORE_ORIGIN)).toBe(true)
	})

	it('accepts a non-browser client that sends no Origin header', () => {
		expect(isAllowedOrigin(undefined)).toBe(true)
	})

	it('rejects web pages, other extensions and look-alike origins', () => {
		expect(isAllowedOrigin('https://evil.example')).toBe(false)
		expect(isAllowedOrigin('http://localhost:3000')).toBe(false)
		expect(isAllowedOrigin('chrome-extension://someotherextensionidxxxxxxxxxxxx')).toBe(false)
		expect(isAllowedOrigin(`${STORE_ORIGIN}.evil.example`)).toBe(false)
		expect(isAllowedOrigin('null')).toBe(false)
	})
})
