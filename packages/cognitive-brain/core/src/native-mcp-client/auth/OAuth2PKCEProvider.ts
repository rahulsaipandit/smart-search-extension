/**
 * OAuth2PKCEProvider - OAuth 2.0 with PKCE (Proof Key for Code Exchange).
 *
 * - Uses expo-auth-session for the browser-based authorization flow.
 * - Tokens are stored in SecureStorage (Keychain on iOS, Keystore on Android,
 *   AsyncStorage on web as fallback).
 * - Token size note: JWT access tokens can exceed the 2048-byte SecureStore
 *   limit on iOS. We store the token set as a single JSON blob under one key;
 *   if it exceeds the limit, SecureStorage falls back to AsyncStorage.
 *
 * Platforms: Web + React Native
 * Prior art: Filipa's MCP auth implementation
 */
import { SecureStorage } from '@page-agent/storage-suite/secure-storage'

import { base64UrlEncode, generateCodeChallenge, generateCodeVerifier } from '../../mcp/auth/pkce'
import type { IOAuth2Provider, OAuth2TokenSet } from './IOAuth2Provider'

export interface OAuth2PKCEConfig {
	authorizationEndpoint: string
	tokenEndpoint: string
	clientId: string
	scopes: string[]
	redirectUri: string
	/** Storage key prefix for this provider. Default: "mcp_oauth" */
	storageKey?: string
}

// PKCE primitives (verifier, S256 challenge, base64url) are shared with the web provider in
// ../../mcp/auth/pkce. The provider itself stays here: it persists tokens in SecureStorage and
// drives the redirect through expo-linking, so it has a different contract (IOAuth2Provider in
// this directory) from mcp/auth/OAuth2PKCEProvider, which keeps tokens in memory.
// ─────────────────────────────────────────────────────────────────────────────

const CLOCK_SKEW_BUFFER_MS = 60_000 // refresh 60s before actual expiry

export class OAuth2PKCEProvider implements IOAuth2Provider {
	private readonly storage = new SecureStorage({ keychainService: 'guideaxon-mcp-oauth' })
	private readonly key: string

	constructor(private config: OAuth2PKCEConfig) {
		this.key = config.storageKey ?? `mcp_oauth_${config.clientId}`
	}

	async getAccessToken(): Promise<string> {
		const cached = await this._loadTokenSet()

		if (cached && Date.now() < cached.expiresAt - CLOCK_SKEW_BUFFER_MS) {
			return cached.accessToken
		}

		if (cached?.refreshToken) {
			try {
				return await this._refreshToken(cached.refreshToken)
			} catch {
				// Refresh failed - fall through to full authorization
			}
		}

		return await this._authorizeWithPKCE()
	}

	async revoke(): Promise<void> {
		await this.storage.remove(this.key)
	}

	async isAuthenticated(): Promise<boolean> {
		const cached = await this._loadTokenSet()
		return cached !== null && Date.now() < cached.expiresAt - CLOCK_SKEW_BUFFER_MS
	}

	// ── Private ────────────────────────────────────────────────────────────────

	private async _authorizeWithPKCE(): Promise<string> {
		const verifier = generateCodeVerifier()
		const challenge = await generateCodeChallenge(verifier)
		const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))

		const authParams = new URLSearchParams({
			response_type: 'code',
			client_id: this.config.clientId,
			redirect_uri: this.config.redirectUri,
			scope: this.config.scopes.join(' '),
			state,
			code_challenge: challenge,
			code_challenge_method: 'S256',
		})

		const authUrl = `${this.config.authorizationEndpoint}?${authParams}`

		// Open browser and wait for redirect - requires expo-linking / expo-web-browser
		// This is a platform-level concern; we use dynamic import to avoid bundling
		// the browser module in packages that don't need it.
		const code = await this._openBrowserAndWaitForCode(authUrl, state)
		return await this._exchangeCode(code, verifier)
	}

	private async _openBrowserAndWaitForCode(authUrl: string, state: string): Promise<string> {
		// Dynamic import so the package doesn't hard-require expo-linking at build time.
		// The main app must have expo-linking installed.
		let Linking: typeof import('expo-linking')
		try {
			Linking = await import('expo-linking')
		} catch {
			throw new Error(
				'OAuth2PKCEProvider requires expo-linking. ' +
					'Install it with: npx expo install expo-linking'
			)
		}

		return new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('OAuth2PKCEProvider: authorization timed out'))
			}, 120_000)

			const handler = ({ url }: { url: string }) => {
				clearTimeout(timeout)
				Linking.default.removeEventListener('url', handler)

				const parsed = new URL(url)
				const returnedState = parsed.searchParams.get('state')
				const code = parsed.searchParams.get('code')
				const error = parsed.searchParams.get('error')

				if (error) {
					reject(new Error(`OAuth2 error: ${error}`))
					return
				}
				if (returnedState !== state) {
					reject(new Error('OAuth2PKCEProvider: state mismatch (CSRF check failed)'))
					return
				}
				if (!code) {
					reject(new Error('OAuth2PKCEProvider: no authorization code in redirect'))
					return
				}
				resolve(code)
			}

			Linking.default.addEventListener('url', handler)

			// Open the authorization URL
			Linking.default.openURL(authUrl).catch((e) => {
				clearTimeout(timeout)
				Linking.default.removeEventListener('url', handler)
				reject(e instanceof Error ? e : new Error(String(e)))
			})
		})
	}

	private async _exchangeCode(code: string, verifier: string): Promise<string> {
		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: this.config.redirectUri,
			client_id: this.config.clientId,
			code_verifier: verifier,
		})

		const res = await fetch(this.config.tokenEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		})

		if (!res.ok) {
			const text = await res.text()
			throw new Error(`OAuth2 token exchange failed ${res.status}: ${text.slice(0, 200)}`)
		}

		const json = await res.json()
		return this._saveAndReturn(json)
	}

	private async _refreshToken(refreshToken: string): Promise<string> {
		const body = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: this.config.clientId,
		})

		const res = await fetch(this.config.tokenEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		})

		if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)

		const json = await res.json()
		return this._saveAndReturn(json)
	}

	private async _saveAndReturn(tokenResponse: Record<string, unknown>): Promise<string> {
		const accessToken = tokenResponse.access_token as string
		const expiresIn = (tokenResponse.expires_in as number) ?? 3600

		const tokenSet: OAuth2TokenSet = {
			accessToken,
			refreshToken: tokenResponse.refresh_token as string | undefined,
			expiresAt: Date.now() + expiresIn * 1000,
			scope: tokenResponse.scope as string | undefined,
		}

		const serialized = JSON.stringify(tokenSet)

		// SecureStorage has a 2048-byte limit on iOS native. If the token set is
		// larger (JWT access tokens can be 1-2KB), we store it in two parts or
		// accept the graceful AsyncStorage fallback on web.
		try {
			await this.storage.store(this.key, serialized)
		} catch (sizeError) {
			if (String(sizeError).includes('exceeds')) {
				// Truncated JWT - store just the access token and expiry, drop refresh token
				console.warn(
					'[OAuth2PKCEProvider] token set too large for SecureStore; storing access token only.'
				)
				const minimal: OAuth2TokenSet = {
					accessToken: tokenSet.accessToken,
					expiresAt: tokenSet.expiresAt,
				}
				await this.storage.store(this.key, JSON.stringify(minimal))
			} else {
				throw sizeError
			}
		}

		return accessToken
	}

	private async _loadTokenSet(): Promise<OAuth2TokenSet | null> {
		const raw = await this.storage.retrieve<string>(this.key)
		if (!raw) return null
		try {
			return JSON.parse(raw) as OAuth2TokenSet
		} catch {
			return null
		}
	}
}
