import { describe, expect, it } from 'vitest'

import { appendDictated, dictatedText, enhanceDictation, rawEnhancer } from './dictation'
import type { SttSegment } from './types'

const seg = (seq: number, text: string): SttSegment => ({
	id: `s${seq}`,
	seq,
	channel: 'mic',
	text,
	startedAt: 0,
	endedAt: 1,
})
const live = new AbortController().signal

describe('enhanceDictation', () => {
	it('uses the improved text', async () => {
		const out = await enhanceDictation(
			{ enhance: async (t) => t.replace('acme', 'ACME Corp') },
			'call acme',
			live
		)
		expect(out).toEqual({ text: 'call ACME Corp', error: null })
	})

	it('keeps the raw text and says why when enhancement fails', async () => {
		const out = await enhanceDictation(
			{ enhance: async () => Promise.reject(new Error('index not built')) },
			'call acme',
			live
		)
		expect(out.text).toBe('call acme')
		expect(out.error).toContain('index not built')
	})

	it('keeps the raw text and says so when enhancement returns nothing', async () => {
		const out = await enhanceDictation({ enhance: async () => '  ' }, 'call acme', live)
		expect(out.text).toBe('call acme')
		expect(out.error).not.toBeNull()
	})

	it('reports no error when the run was cancelled', async () => {
		const c = new AbortController()
		const out = await enhanceDictation(
			{
				enhance: async () => {
					c.abort()
					throw new Error('aborted')
				},
			},
			'x',
			c.signal
		)
		expect(out).toEqual({ text: 'x', error: null })
	})

	it('raw enhancer is a pass-through', async () => {
		expect((await enhanceDictation(rawEnhancer, 'as spoken', live)).text).toBe('as spoken')
	})
})

describe('appendDictated', () => {
	it('adds one space between existing text and dictation', () => {
		expect(appendDictated('ramp 4 mo', ' budget 50k ')).toBe('ramp 4 mo budget 50k')
	})
	it('does not start an empty field or a new line with a space', () => {
		expect(appendDictated('', 'hello')).toBe('hello')
		expect(appendDictated('a\n', 'b')).toBe('a\nb')
	})
	it('leaves the field alone for blank dictation', () => {
		expect(appendDictated('keep', '  ')).toBe('keep')
	})
})

describe('dictatedText', () => {
	it('joins segments in order and skips blanks', () => {
		expect(dictatedText([seg(0, 'hello '), seg(1, ' '), seg(2, 'world')])).toBe('hello world')
	})
})
