/**
 * Debug logging for storage-suite. Silent by default: the embedding and storage layers log per call (text previews,
 * model paths), which is noise in production and leaks user text into the console. Turn it on while debugging.
 * warn/error stay on plain console, so failures stay visible.
 */
let debugEnabled = false

export function setStorageSuiteDebug(enabled: boolean): void {
	debugEnabled = enabled
}

export const log = {
	debug: (...args: unknown[]): void => {
		if (debugEnabled) console.debug('[storage-suite]', ...args)
	},
}
