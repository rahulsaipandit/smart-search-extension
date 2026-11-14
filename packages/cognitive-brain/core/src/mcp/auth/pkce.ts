/**
 * PKCE (RFC 7636) primitives shared by every OAuth2 provider in core.
 *
 * Pure functions on WebCrypto (`crypto.getRandomValues`, `crypto.subtle`), which exists in
 * browsers, React Native (Hermes with the crypto polyfill) and Node >= 20.
 */

/** URL-safe base64 without padding, as RFC 7636 §4 requires for verifiers and challenges. */
export function base64UrlEncode(input: Uint8Array | ArrayBuffer): string {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
	let str = ''
	for (const b of bytes) str += String.fromCharCode(b)
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** 32 random bytes, base64url-encoded (43 characters). */
export function generateCodeVerifier(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return base64UrlEncode(bytes)
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
	return base64UrlEncode(digest)
}
