/**
 * ConsentStore - Persists "Always Allow" decisions for Mobile MCP app pairings.
 *
 * Stores trusted bundle IDs in SecureStorage so consent dialogs are not
 * re-shown for previously approved apps.
 *
 * Platforms: Web + Native (no-ops gracefully on web since Mobile MCP is
 * native-only, but the store is shared so it won't crash in web builds).
 */
import { SecureStorage } from '@page-agent/storage-suite/secure-storage'

const STORAGE_KEY = 'mcp_mobile_trusted_bundle_ids'
const storage = new SecureStorage({ keychainService: 'guideaxon-mcp-consent' })

export const ConsentStore = {
	async getTrustedBundleIds(): Promise<string[]> {
		try {
			const raw = await storage.retrieve<string>(STORAGE_KEY)
			if (!raw) return []
			return JSON.parse(raw) as string[]
		} catch {
			return []
		}
	},

	async isTrusted(bundleId: string): Promise<boolean> {
		const trusted = await ConsentStore.getTrustedBundleIds()
		return trusted.includes(bundleId)
	},

	async setTrusted(bundleId: string, trusted: boolean): Promise<void> {
		const current = await ConsentStore.getTrustedBundleIds()
		let updated: string[]

		if (trusted) {
			updated = current.includes(bundleId) ? current : [...current, bundleId]
		} else {
			updated = current.filter((id) => id !== bundleId)
		}

		await storage.store(STORAGE_KEY, JSON.stringify(updated))
	},

	async revoke(bundleId: string): Promise<void> {
		await ConsentStore.setTrusted(bundleId, false)
	},

	async revokeAll(): Promise<void> {
		await storage.store(STORAGE_KEY, JSON.stringify([]))
	},
}
