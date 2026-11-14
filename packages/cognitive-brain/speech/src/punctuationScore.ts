/**
 * Punctuation-aware scoring for transcript cleanup (docs/designMeetingCoach.md O2d, test plan item 5).
 * The word-error scorer in bench/model-spikes ignores punctuation and case, so it cannot judge this.
 *
 * Words of the hypothesis are aligned to the reference (longest common subsequence on lower-cased words), and on
 * the aligned words we compare: the mark after each word (sentence end . ? !, comma, or none) and the capital
 * letter of words that are capitalized in the reference (sentence starts, names, "I"). Pure.
 *
 * Import this from `@page-agent/speech/punctuation-score`, not from the package root. It is evaluation tooling
 * (benchmarks and fixture tests), not part of the speech pipeline an app runs, and its names are short and generic
 * (`f1`, `sumScores`). Re-exported from `index.ts` through `export *`, any module that later exports the same name
 * would make the root fail to compile with a duplicate-export error. A separate subpath keeps the runtime API small
 * and avoids that clash.
 */
export type PunctuationMark = 'end' | 'comma' | 'none'

interface Tok {
	key: string
	mark: PunctuationMark
	capital: boolean
}

function tokens(text: string): Tok[] {
	const out: Tok[] = []
	for (const m of text.matchAll(/([\p{L}\p{N}][\p{L}\p{N}'’]*)([^\p{L}\p{N}\s]*)/gu)) {
		const trail = m[2]
		out.push({
			key: m[1].toLowerCase().replace(/’/g, "'"),
			mark: /[.?!]/.test(trail) ? 'end' : trail.includes(',') ? 'comma' : 'none',
			capital: /^\p{Lu}/u.test(m[1]),
		})
	}
	return out
}

export interface PrfCounts {
	tp: number
	fp: number
	fn: number
}
export interface PunctuationScore {
	/** Words present in both texts after alignment. */
	aligned: number
	end: PrfCounts
	comma: PrfCounts
	/** Aligned words capitalized in the reference, and how many of them the hypothesis also capitalized. */
	capitals: { expected: number; correct: number }
}

export function punctuationScore(reference: string, hypothesis: string): PunctuationScore {
	const a = tokens(reference)
	const b = tokens(hypothesis)
	// LCS table over words.
	const t: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0)
	)
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			t[i][j] = a[i].key === b[j].key ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
	const score: PunctuationScore = {
		aligned: 0,
		end: { tp: 0, fp: 0, fn: 0 },
		comma: { tp: 0, fp: 0, fn: 0 },
		capitals: { expected: 0, correct: 0 },
	}
	for (let i = 0, j = 0; i < a.length && j < b.length;) {
		if (a[i].key === b[j].key) {
			score.aligned++
			for (const kind of ['end', 'comma'] as const) {
				const want = a[i].mark === kind
				const got = b[j].mark === kind
				if (want && got) score[kind].tp++
				else if (got) score[kind].fp++
				else if (want) score[kind].fn++
			}
			if (a[i].capital) {
				score.capitals.expected++
				if (b[j].capital) score.capitals.correct++
			}
			i++
			j++
		} else if (t[i + 1][j] >= t[i][j + 1]) i++
		else j++
	}
	return score
}

export const f1 = (c: PrfCounts): number =>
	c.tp === 0 ? (c.fp + c.fn === 0 ? 1 : 0) : (2 * c.tp) / (2 * c.tp + c.fp + c.fn)

/** Sums scores over many utterances (micro average). */
export function sumScores(list: readonly PunctuationScore[]): PunctuationScore {
	const z = (): PrfCounts => ({ tp: 0, fp: 0, fn: 0 })
	const total: PunctuationScore = {
		aligned: 0,
		end: z(),
		comma: z(),
		capitals: { expected: 0, correct: 0 },
	}
	for (const s of list) {
		total.aligned += s.aligned
		for (const k of ['end', 'comma'] as const) {
			total[k].tp += s[k].tp
			total[k].fp += s[k].fp
			total[k].fn += s[k].fn
		}
		total.capitals.expected += s.capitals.expected
		total.capitals.correct += s.capitals.correct
	}
	return total
}
