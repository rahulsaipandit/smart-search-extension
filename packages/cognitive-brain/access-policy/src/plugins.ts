/**
 * Heuristic plugin system and built-in plugins for runtime page inspection.
 */
import type { PluginResult, PolicyContext, PolicyPlugin } from './types'

/** Executes plugins in order and returns the first non-null result. */
export class PluginRunner {
	private plugins: PolicyPlugin[]

	constructor(plugins: PolicyPlugin[] = []) {
		this.plugins = plugins
	}

	run(ctx: PolicyContext): PluginResult | null {
		for (const plugin of this.plugins) {
			const result = plugin.evaluate(ctx)
			if (result) return result
		}
		return null
	}
}

// ---------------------------------------------------------------------------
// Built-in plugins
// ---------------------------------------------------------------------------

/** Blocks pages where a password input (`<input type="password">`) is detected. */
export class PasswordFieldPlugin implements PolicyPlugin {
	name = 'password-field'

	evaluate(ctx: PolicyContext): PluginResult | null {
		if (ctx.dom?.hasPasswordFields) {
			return { decision: 'BLOCK', reason: 'Password field detected' }
		}
		return null
	}
}

/**
 * Blocks pages where a login/authentication form is detected.
 *
 * This is intentionally more targeted than "any `<form>`" - it uses
 * heuristics to distinguish login forms from comment forms, search
 * bars, and newsletter signups.
 */
// export class LoginFormPlugin implements PolicyPlugin {
//   name = 'login-form'
//
//   evaluate(ctx: PolicyContext): PluginResult | null {
//     if (ctx.dom?.hasLoginForm) {
//       return { decision: 'BLOCK', reason: 'Login form detected' }
//     }
//     return null
//   }
// }

/**
 * Blocks pages where sensitive input fields (SSN, credit card, routing
 * number, etc.) are detected via DOM scanning.
 *
 * This provides defence in depth beyond the KeywordPlugin - it catches
 * cases where the field labels are visible in the DOM but not in the
 * rendered text sample.
 */
export class SensitiveFieldPlugin implements PolicyPlugin {
	name = 'sensitive-field'

	evaluate(ctx: PolicyContext): PluginResult | null {
		if (ctx.dom?.hasSensitiveFields) {
			return { decision: 'BLOCK', reason: 'Sensitive input field detected' }
		}
		return null
	}
}

// Word-boundary regexes rather than raw substrings: `'otp'.includes` style
// matching false-positived on ordinary words like "hotpot" or "adoption".
const SENSITIVE_TERM_PATTERNS: readonly [string, RegExp][] = [
	['ssn', /\bssn\b/],
	['social security', /social security/],
	['routing number', /routing number/],
	['credit card', /credit card/],
	['bank account', /bank account/],
	['tax return', /tax return/],
	['otp', /\botp\b/],
	['2fa', /\b2fa\b/],
]

/**
 * Scans page text for sensitive keywords like SSN, bank account, etc.
 *
 * A single incidental mention (e.g. a news/finance article that discusses
 * "credit card" debt or a "tax return" in passing) is common on legitimate,
 * non-sensitive pages and isn't itself evidence of a data-collection form.
 * Requiring two or more distinct terms raises the bar to something closer
 * to an actual sensitive-data context (e.g. a form mentioning both "SSN"
 * and "routing number"), while still catching real sensitive pages, which
 * typically reference several related terms together.
 */
export class KeywordPlugin implements PolicyPlugin {
	name = 'keyword-scan'
	private static readonly MIN_DISTINCT_TERMS = 2

	evaluate(ctx: PolicyContext): PluginResult | null {
		const text = (ctx.dom?.textSample || '').toLowerCase()
		const matched = SENSITIVE_TERM_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
			([term]) => term
		)

		if (matched.length >= KeywordPlugin.MIN_DISTINCT_TERMS) {
			return { decision: 'BLOCK', reason: `Sensitive keywords: ${matched.join(', ')}` }
		}
		return null
	}
}
