import { describe, expect, it } from 'vitest'

import { outputKind } from './outputDevice'

describe('outputKind', () => {
	it('treats any echo the microphone picked up as proof of speakers, whatever the device is called', () => {
		expect(outputKind('Default - Headphones (Realtek)', 3)).toBe('speakers')
	})
	it('recognises common headphone names', () => {
		for (const label of [
			'Default - AirPods Pro',
			'Headset Earphone (Jabra)',
			'Bluetooth Hands-Free',
			'Headphones (Realtek Audio)',
		]) {
			expect(outputKind(label, 0)).toBe('headphones')
		}
	})
	it('recognises speakers', () => {
		expect(outputKind('Speakers (Realtek Audio)', 0)).toBe('speakers')
		expect(outputKind('LG HDR (HDMI)', 0)).toBe('speakers')
	})
	it('says unknown when the label tells nothing, instead of guessing', () => {
		expect(outputKind('', 0)).toBe('unknown')
		expect(outputKind('Default', 0)).toBe('unknown')
	})
})
