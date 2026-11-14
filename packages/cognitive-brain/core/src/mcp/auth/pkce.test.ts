import { describe, expect, it } from 'vitest'

import { base64UrlEncode, generateCodeChallenge, generateCodeVerifier } from './pkce'

describe('PKCE primitives', () => {
	it('matches the RFC 7636 appendix B test vector', async () => {
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
		expect(await generateCodeChallenge(verifier)).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		)
	})

	it('generates 43-character URL-safe verifiers that differ on every call', () => {
		const a = generateCodeVerifier()
		const b = generateCodeVerifier()
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(a).not.toBe(b)
	})

	it('encodes without padding or characters that are unsafe in a URL', () => {
		// 0xfb 0xff 0xfe is "+//+" in plain base64
		expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-')
		expect(base64UrlEncode(new Uint8Array([1]).buffer)).toBe('AQ')
	})
})
