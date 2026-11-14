/**
 * Live-DOM snapshotting for the access policy. Browser-only: reads `document`.
 *
 * Kept out of the package root so platform-neutral consumers (e.g. an Android
 * WebView host that builds its own DocumentSnapshot) don't pull in DOM code.
 */
import type { DocumentSnapshot } from './types'

// ---------------------------------------------------------------------------
// DOM Snapshot builder (content-script side)
// ---------------------------------------------------------------------------

/**
 * Build a lightweight DocumentSnapshot from the current page DOM.
 *
 * Scans for password fields, login forms, and sensitive input fields
 * (SSN, credit card, routing number, etc.). Also collects a bounded
 * text sample for keyword analysis.
 *
 * Safe-guarded: returns an empty snapshot if `document` is unavailable
 * (e.g., called from a non-browser context).
 *
 * Use this in the Chrome content script before invoking the engine.
 */
export function buildSnapshot(): DocumentSnapshot {
	if (typeof document === 'undefined') {
		return {
			hasPasswordFields: false,
			hasLoginForm: false,
			hasSensitiveFields: false,
			textSample: '',
		}
	}

	return {
		hasPasswordFields: !!document.querySelector('input[type="password"]'),
		hasLoginForm: detectLoginForm(),
		hasSensitiveFields: containsSensitiveFields(),
		textSample: document.body?.innerText?.slice(0, 50000) || '',
	}
}

/**
 * Detect whether the page contains a login/authentication form rather
 * than just any generic `<form>`. This avoids false positives on
 * comment forms, search bars, newsletter signups, etc.
 *
 * Heuristics (any match = login form):
 * 1. A password field exists inside a `<form>`
 * 2. A form's `name` or `id` matches login/auth patterns
 * 3. A form contains a submit button labelled "log in", "sign in", etc.
 */
function detectLoginForm(): boolean {
	// Heuristic 1: form contains a password field
	const formsWithPassword = document.querySelectorAll('form input[type="password"]')
	if (formsWithPassword.length > 0) return true

	const loginPatterns = [
		/login/i,
		/sign[-\s]?in/i,
		/log[-\s]?in/i,
		/auth/i,
		/authenticate/i,
		/sign[-\s]?on/i,
		/credentials/i,
		/mfa/i,
		/2fa/i,
		/otp/i,
		/sso/i,
	]

	// Heuristic 2: form name/id matches login patterns
	const forms = document.querySelectorAll<HTMLFormElement>('form[name], form[id]')
	for (const form of forms) {
		const nameOrId = `${form.name} ${form.id}`
		if (loginPatterns.some((p) => p.test(nameOrId))) return true
	}

	// Heuristic 3: submit button text matches login patterns
	const submitButtons = document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
		'input[type="submit"], button[type="submit"], button:not([type])'
	)
	for (const btn of submitButtons) {
		const label = (btn as HTMLInputElement).value || (btn as HTMLButtonElement).textContent || ''
		if (loginPatterns.some((p) => p.test(label))) return true
	}

	return false
}

/**
 * Check whether the DOM contains input fields whose `name`, `id`,
 * `aria-label`, or wrapping `<label>` text suggests they carry
 * sensitive data.
 */
function containsSensitiveFields(): boolean {
	// Field-name/label patterns, tightened to the specific terms sites use for
	// sensitive inputs. Bare words like "credit" or "routing" previously
	// matched unrelated fields (e.g. "credits" on a course-signup form, or
	// "routing" in a shipping/logistics context), so those were narrowed to
	// their compound forms ("credit card", "routing number").
	const sensitivePatterns = [
		/\bssn\b/i,
		/social.?security/i,
		/credit.?card/i,
		/card.?number/i,
		/cvv/i,
		/cvc/i,
		/routing.?number/i,
		/account.?number/i,
		/bank.?account/i,
		/tax.?id/i,
		/\bein\b/i,
		/passport/i,
		/driver.?licen[cs]e/i,
	]

	const inputs = document.querySelectorAll<HTMLInputElement>(
		'input[name], input[id], input[aria-label]'
	)

	return Array.from(inputs).some((input) => {
		const nameOrId = `${input.name} ${input.id} ${input.getAttribute('aria-label') || ''}`
		if (sensitivePatterns.some((pattern) => pattern.test(nameOrId))) return true

		// Check the associated <label> element
		if (input.id) {
			const label = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)
			if (label && sensitivePatterns.some((pattern) => pattern.test(label.textContent || ''))) {
				return true
			}
		}

		return false
	})
}
