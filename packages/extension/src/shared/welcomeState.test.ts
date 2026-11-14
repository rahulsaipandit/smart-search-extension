import { describe, expect, it } from 'vitest'

import { shouldOpenWelcome } from './welcomeState'

describe('shouldOpenWelcome', () => {
	it('opens on a fresh install', () => {
		expect(shouldOpenWelcome('install', undefined)).toBe(true)
		expect(shouldOpenWelcome('install', {})).toBe(true)
	})
	it('never opens on update or browser update', () => {
		expect(shouldOpenWelcome('update', undefined)).toBe(false)
		expect(shouldOpenWelcome('chrome_update', undefined)).toBe(false)
	})
	it('does not reopen after it was shown or dismissed', () => {
		expect(shouldOpenWelcome('install', { shownAt: 1 })).toBe(false)
		expect(shouldOpenWelcome('install', { dismissed: true })).toBe(false)
	})
})
