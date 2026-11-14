/**
 * OAuth 2.0 provider interface used by Tier 1 transports.
 */
export interface IOAuth2Provider {
	/** Returns a valid access token, refreshing if necessary. */
	getAccessToken(): Promise<string>

	/** Revoke stored tokens and clear credentials. */
	revoke(): Promise<void>

	/** True if valid (non-expired) credentials are cached. */
	isAuthenticated(): Promise<boolean>
}

export interface OAuth2TokenSet {
	accessToken: string
	refreshToken?: string
	expiresAt: number // Unix ms
	scope?: string
}
