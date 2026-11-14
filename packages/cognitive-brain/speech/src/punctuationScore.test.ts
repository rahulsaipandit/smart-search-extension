import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as root from './index'
import { f1, punctuationScore, sumScores } from './punctuationScore'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
	exports: Record<string, { default: string }>
}

describe('where the punctuation scorer lives', () => {
	it('is its own subpath and is not part of the runtime package root', () => {
		const target = pkg.exports['./punctuation-score']?.default
		expect(target).toBe('./src/punctuationScore.ts')
		expect(existsSync(new URL(`../${target}`, import.meta.url))).toBe(true)

		// It is evaluation tooling with generic names; on the root it could clash with a future runtime export.
		for (const name of ['punctuationScore', 'sumScores', 'f1']) {
			expect(root).not.toHaveProperty(name)
		}
	})
})

describe('punctuationScore', () => {
	const ref = 'Hello Priya, can you join Friday?'

	it('scores identical text as perfect', () => {
		const s = punctuationScore(ref, ref)
		expect(s.aligned).toBe(6)
		expect(f1(s.end)).toBe(1)
		expect(f1(s.comma)).toBe(1)
		expect(s.capitals).toEqual({ expected: 3, correct: 3 })
	})

	it('counts lost punctuation and capitals separately when the words are right', () => {
		const s = punctuationScore(ref, 'hello priya can you join friday')
		expect(s.aligned).toBe(6)
		expect(s.end).toEqual({ tp: 0, fp: 0, fn: 1 })
		expect(s.comma).toEqual({ tp: 0, fp: 0, fn: 1 })
		expect(s.capitals).toEqual({ expected: 3, correct: 0 })
	})

	it('ignores a word the hypothesis added, and still scores the punctuation of the aligned words', () => {
		const s = punctuationScore('We should move it.', 'We should uh move it.')
		expect(s.aligned).toBe(4)
		expect(s.end).toEqual({ tp: 1, fp: 0, fn: 0 })
	})

	it('micro-averages over several utterances', () => {
		const total = sumScores([
			punctuationScore(ref, ref),
			punctuationScore(ref, 'hello priya can you join friday'),
		])
		expect(total.end).toEqual({ tp: 1, fp: 0, fn: 1 })
		expect(f1(total.end)).toBeCloseTo(2 / 3)
	})
})
