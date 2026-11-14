import { WELCOME_KEY, type WelcomeRecord, shouldOpenWelcome } from '@/shared/welcomeState'

/**
 * Folder Search has no background logic of its own: indexing and search run in the offscreen
 * document, and all state lives in IndexedDB. The service worker makes the toolbar icon open the
 * side panel, and opens the welcome page (pin + open instructions) once, on a fresh install.
 */
export default defineBackground(() => {
	chrome.sidePanel
		.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) => console.error('[Background] setPanelBehavior failed:', err))

	chrome.runtime.onInstalled.addListener((details) => {
		if (details.reason !== 'install') return
		void (async () => {
			try {
				const stored = await chrome.storage.local.get(WELCOME_KEY)
				const existing = stored[WELCOME_KEY] as WelcomeRecord | undefined
				if (!shouldOpenWelcome(details.reason, existing)) return
				await chrome.storage.local.set({ [WELCOME_KEY]: { ...existing, shownAt: Date.now() } satisfies WelcomeRecord })
				await chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') })
			} catch (err) {
				console.error('[Background] welcome page failed:', err)
			}
		})()
	})
})
