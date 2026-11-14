/**
 * First-install welcome page state. The page itself (entrypoints/welcome/welcome.js) is plain JS and
 * cannot import this module, so it repeats `WELCOME_KEY` and the `dismissed` field: keep them in sync.
 *
 * The background script opens the page once, on a fresh install, and records `shownAt`. Updates and
 * browser upgrades never reopen it, and neither does a record that is already present.
 */
export const WELCOME_KEY = 'welcomeState'

export interface WelcomeRecord {
	/** Epoch ms when the page was opened by the background script. */
	shownAt?: number
	/** Set by the page's "Don't show this again" button. */
	dismissed?: boolean
}

/** True only for a fresh install that has not been welcomed before. */
export function shouldOpenWelcome(reason: string, existing: WelcomeRecord | undefined): boolean {
	if (reason !== 'install') return false
	return !existing || (!existing.shownAt && !existing.dismissed)
}
