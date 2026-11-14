/**
 * Tiny pure-TypeScript SHA-1 implementation.
 *
 * Purpose: Computing the Sec-WebSocket-Accept header for the WebSocket
 * upgrade handshake. No external dependencies.
 *
 * Reference: FIPS PUB 180-4
 * Validated against: https://tools.ietf.org/html/rfc6455#section-1.3
 */

// ── Word rotation helper ─────────────────────────────────────────────────────

function rotl32(x: number, n: number): number {
	return ((x << n) | (x >>> (32 - n))) >>> 0
}

// ── UTF-8 encoder ────────────────────────────────────────────────────────────

function encodeUtf8(str: string): number[] {
	const bytes: number[] = []
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i)
		if (code < 0x80) {
			bytes.push(code)
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6))
			bytes.push(0x80 | (code & 0x3f))
		} else if (code < 0xd800 || code >= 0xe000) {
			bytes.push(0xe0 | (code >> 12))
			bytes.push(0x80 | ((code >> 6) & 0x3f))
			bytes.push(0x80 | (code & 0x3f))
		} else {
			// Surrogate pair
			i++
			const hi = code
			const lo = str.charCodeAt(i)
			const codePoint = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00)
			bytes.push(0xf0 | (codePoint >> 18))
			bytes.push(0x80 | ((codePoint >> 12) & 0x3f))
			bytes.push(0x80 | ((codePoint >> 6) & 0x3f))
			bytes.push(0x80 | (codePoint & 0x3f))
		}
	}
	return bytes
}

// ── Base64 encoder ────────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: number[]): string {
	let result = ''
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i]
		const b1 = bytes[i + 1] ?? 0
		const b2 = bytes[i + 2] ?? 0
		result += B64[(b0 >> 2) & 0x3f]
		result += B64[((b0 << 4) | (b1 >> 4)) & 0x3f]
		result += i + 1 < bytes.length ? B64[((b1 << 2) | (b2 >> 6)) & 0x3f] : '='
		result += i + 2 < bytes.length ? B64[b2 & 0x3f] : '='
	}
	return result
}

// ── SHA-1 ────────────────────────────────────────────────────────────────────

/**
 * Compute SHA-1 of a UTF-8 string and return the Base64-encoded digest.
 *
 * @example
 *   sha1Base64('dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
 *   // → 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
 */
export function sha1Base64(str: string): string {
	const msg = encodeUtf8(str)
	const bitLen = msg.length * 8

	// Pre-processing: padding
	msg.push(0x80)
	while (msg.length % 64 !== 56) msg.push(0)

	// Append original bit length as 64-bit big-endian
	// JavaScript numbers are safe to 2^53 so split at 32 bits
	const hiLen = Math.floor(bitLen / 0x100000000)
	const loLen = bitLen >>> 0
	for (let i = 3; i >= 0; i--) msg.push((hiLen >>> (i * 8)) & 0xff)
	for (let i = 3; i >= 0; i--) msg.push((loLen >>> (i * 8)) & 0xff)

	// Initial hash values (SHA-1)
	let h0 = 0x67452301
	let h1 = 0xefcdab89
	let h2 = 0x98badcfe
	let h3 = 0x10325476
	let h4 = 0xc3d2e1f0

	// Process each 512-bit (64-byte) block
	for (let blk = 0; blk < msg.length; blk += 64) {
		// Build schedule w[0..79]
		const w: number[] = new Array(80)
		for (let j = 0; j < 16; j++) {
			w[j] =
				(msg[blk + j * 4] << 24) |
				(msg[blk + j * 4 + 1] << 16) |
				(msg[blk + j * 4 + 2] << 8) |
				msg[blk + j * 4 + 3]
		}
		for (let j = 16; j < 80; j++) {
			w[j] = rotl32(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1)
		}

		// Working variables
		let a = h0
		let b = h1
		let c = h2
		let d = h3
		let e = h4

		for (let j = 0; j < 80; j++) {
			let f: number
			let k: number
			if (j < 20) {
				f = (b & c) | (~b & d)
				k = 0x5a827999
			} else if (j < 40) {
				f = b ^ c ^ d
				k = 0x6ed9eba1
			} else if (j < 60) {
				f = (b & c) | (b & d) | (c & d)
				k = 0x8f1bbcdc
			} else {
				f = b ^ c ^ d
				k = 0xca62c1d6
			}

			const temp = (rotl32(a, 5) + f + e + k + w[j]) >>> 0
			e = d
			d = c
			c = rotl32(b, 30)
			b = a
			a = temp
		}

		h0 = (h0 + a) >>> 0
		h1 = (h1 + b) >>> 0
		h2 = (h2 + c) >>> 0
		h3 = (h3 + d) >>> 0
		h4 = (h4 + e) >>> 0
	}

	// Produce the 20-byte digest
	const digest: number[] = []
	for (const h of [h0, h1, h2, h3, h4]) {
		digest.push((h >>> 24) & 0xff)
		digest.push((h >>> 16) & 0xff)
		digest.push((h >>> 8) & 0xff)
		digest.push(h & 0xff)
	}

	return bytesToBase64(digest)
}

/** RFC 6455 magic GUID appended to the client's Sec-WebSocket-Key before hashing */
export const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** Compute the Sec-WebSocket-Accept value from a Sec-WebSocket-Key */
export function wsAcceptKey(clientKey: string): string {
	return sha1Base64(clientKey + WS_MAGIC)
}
