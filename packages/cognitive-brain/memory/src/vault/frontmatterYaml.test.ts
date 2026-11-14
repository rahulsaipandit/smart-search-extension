import { describe, expect, test } from 'vitest'

import { parseFrontmatterYaml, serialiseFrontmatterYaml } from './frontmatterYaml'

function roundTrip(fm: Record<string, unknown>): Record<string, unknown> {
	return parseFrontmatterYaml(serialiseFrontmatterYaml(fm).join('\n'))
}

describe('serialiseFrontmatterYaml', () => {
	test('writes a one-level map as an indented block', () => {
		const lines = serialiseFrontmatterYaml({
			generated: { by: 'process:memory-engine', at: '2026-10-08T09:00:00Z' },
		})
		expect(lines).toEqual([
			'generated:',
			'  by: "process:memory-engine"',
			'  at: "2026-10-08T09:00:00Z"',
		])
	})

	test('keeps the earlier output for flat scalars and arrays', () => {
		const lines = serialiseFrontmatterYaml({
			title: 'Plan',
			confidence: 0.5,
			tags: ['a', 'b'],
			draft: false,
		})
		expect(lines).toEqual(['title: "Plan"', 'confidence: 0.5', 'tags: ["a", "b"]', 'draft: false'])
	})

	test('skips undefined and null values', () => {
		expect(serialiseFrontmatterYaml({ a: undefined, b: null, c: 'x' })).toEqual(['c: "x"'])
	})

	test('writes a map that holds a list as a JSON flow mapping', () => {
		const lines = serialiseFrontmatterYaml({ guideaxon: { id: 'g1', successCriteria: ['a'] } })
		expect(lines).toEqual(['guideaxon: {"id":"g1","successCriteria":["a"]}'])
	})
})

describe('round trip', () => {
	test('a nested generated map survives', () => {
		const fm = {
			title: 'T',
			generated: { by: 'human:owner', at: '2026-10-08T09:00:00Z' },
			tags: ['x'],
		}
		expect(roundTrip(fm)).toEqual(fm)
	})

	test('quotes, backslashes and line breaks in strings survive', () => {
		const fm = { title: 'He said "hi"\nand left \\ ok' }
		expect(roundTrip(fm)).toEqual(fm)
	})

	test('a string that looks like a number stays a string', () => {
		expect(roundTrip({ title: '2024' })).toEqual({ title: '2024' })
		expect(roundTrip({ title: 'true' })).toEqual({ title: 'true' })
	})

	test('numbers, booleans and arrays survive', () => {
		const fm = { confidence: 0.8, draft: true, sourceIds: ['m1', 'm,2'] }
		expect(roundTrip(fm)).toEqual(fm)
	})

	test('a map holding a list survives through the JSON flow form', () => {
		const fm = { guideaxon: { id: 'g1', successCriteria: ['Ship a small app'], nested: { a: 1 } } }
		expect(roundTrip(fm)).toEqual(fm)
	})
})

describe('parseFrontmatterYaml on hand-edited files', () => {
	test('reads unquoted scalars and a lenient flow list', () => {
		const out = parseFrontmatterYaml('title: Hello\ntags: [a, b, c]\nconfidence: 3\nflag: true')
		expect(out).toEqual({ title: 'Hello', tags: ['a', 'b', 'c'], confidence: 3, flag: true })
	})

	test('reads a block map and a block list', () => {
		const out = parseFrontmatterYaml(
			'type: goal\ngenerated:\n  by: process:memory-engine\n  at: 2026-10-08T09:00:00Z\ntags:\n  - a\n  - b\ntitle: T'
		)
		expect(out).toEqual({
			type: 'goal',
			generated: { by: 'process:memory-engine', at: '2026-10-08T09:00:00Z' },
			tags: ['a', 'b'],
			title: 'T',
		})
	})

	test('does not turn child lines of a map into top-level keys', () => {
		const out = parseFrontmatterYaml('generated:\n  by: x\n  at: y\ntitle: T')
		expect(Object.keys(out)).toEqual(['generated', 'title'])
	})

	test('an empty value stays an empty string, as before', () => {
		expect(parseFrontmatterYaml('title:\ntype: goal')).toEqual({ title: '', type: 'goal' })
	})

	test('a value that holds a colon keeps everything after the first one', () => {
		expect(parseFrontmatterYaml('resource: https://example.com/a')).toEqual({
			resource: 'https://example.com/a',
		})
	})
})
