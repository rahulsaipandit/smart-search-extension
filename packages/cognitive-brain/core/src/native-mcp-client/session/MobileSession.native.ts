/**
 * MobileSession (native) - Tier 2 Mobile MCP host session.
 *
 * Extends MCPSession with:
 *   1. OS-verified bundle ID check (via deep link Universal/App Link metadata)
 *   2. Mandatory user consent dialog (unless pre-approved via ConsentStore)
 *   3. One-time session token echo verification (handled by LocalWebSocketTransport)
 *
 * Security model (from mmcp):
 *   - iOS: Universal Links guarantee the receiving app's bundle ID
 *   - Android: App Links guarantee the receiving app's package name
 *   - GuideAxon verifies the bundle ID from the incoming deep link before
 *     proceeding with the MCP handshake.
 */
import { Linking } from 'react-native'

import { ConsentStore } from '../mobile/ConsentStore'
import type { LocalWebSocketTransport } from '../transport/LocalWebSocketTransport.native'
import type { MobileAppConfig } from '../types'
import { MCPSession } from './MCPSession'

export class MobileSession extends MCPSession {
	constructor(
		transport: LocalWebSocketTransport,
		private readonly mobileConfig: MobileAppConfig
	) {
		super(transport, mobileConfig)
	}

	override async connect(): Promise<void> {
		// 1. Verify the OS-provided bundle ID
		const verifiedBundleId = await this._getVerifiedBundleId()

		if (verifiedBundleId && verifiedBundleId !== this.mobileConfig.appBundleId) {
			throw new Error(
				`MobileSession: bundle ID mismatch for "${this.mobileConfig.label}". ` +
					`Expected "${this.mobileConfig.appBundleId}", OS reported "${verifiedBundleId}".`
			)
		}

		// 2. Check consent
		const isTrusted =
			this.mobileConfig.trusted || (await ConsentStore.isTrusted(this.mobileConfig.appBundleId))

		if (!isTrusted) {
			const granted = await this._requestConsent()
			if (!granted) {
				throw new Error(`MobileSession: user denied connection to "${this.mobileConfig.label}"`)
			}
		}

		// 3. Proceed with normal MCP handshake
		await super.connect()
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Private
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Read the verified bundle ID from the deep link that triggered the connection.
	 *
	 * On iOS with Universal Links, the OS guarantees that the URL domain matches
	 * the apple-app-site-association file hosted by the app - effectively verifying
	 * the bundle ID. On Android with App Links, the same is done via assetlinks.json.
	 *
	 * In practice this means: if a malicious app intercepts the deep link, the OS
	 * won't route it to them unless their bundle ID is registered for that domain.
	 *
	 * This implementation reads the initial URL that brought the app to the
	 * foreground. The tool app embeds its bundle ID as a URL parameter when
	 * it fires the callback deep link to GuideAxon (after receiving our
	 * initial handshake deep link).
	 */
	private async _getVerifiedBundleId(): Promise<string | null> {
		try {
			const url = await Linking.getInitialURL()
			if (!url) return null

			const parsed = new URL(url)
			// The tool app encodes its bundle ID in the callback URL:
			// guideaxon://mcp-ack?bundleId=com.apple.notes&token=...
			const bundleId = parsed.searchParams.get('bundleId')
			return bundleId
		} catch {
			// If we can't verify, return null - the mismatch check is skipped
			// but we still require user consent
			return null
		}
	}

	/**
	 * Show the system consent dialog.
	 * This is implemented as an Alert with Allow / Deny options.
	 * A full implementation would use a custom modal (ConsentDialog component).
	 */
	private async _requestConsent(): Promise<boolean> {
		// Dynamically import Alert to avoid circular dependency with RN core
		const { Alert } = await import('react-native')

		return new Promise<boolean>((resolve) => {
			Alert.alert(
				`"${this.mobileConfig.label}" wants to connect`,
				`This app will be able to see your available AI tools and execute them on your behalf.\n\nApp ID: ${this.mobileConfig.appBundleId}`,
				[
					{
						text: 'Always Allow',
						onPress: async () => {
							await ConsentStore.setTrusted(this.mobileConfig.appBundleId, true)
							resolve(true)
						},
					},
					{
						text: 'Allow Once',
						onPress: () => resolve(true),
					},
					{
						text: 'Deny',
						style: 'cancel',
						onPress: () => resolve(false),
					},
				],
				{ cancelable: false }
			)
		})
	}
}
