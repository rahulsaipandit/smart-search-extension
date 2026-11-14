import { describe, expect, test } from 'vitest'

import { extractJsonObject } from './extractJsonObject'

describe('extractJsonObject', () => {
	test('parses a bare JSON object', () => {
		expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
	})

	test('extracts JSON embedded in prose', () => {
		expect(extractJsonObject('Sure, here you go: {"a":1} - hope that helps')).toEqual({ a: 1 })
	})

	test('returns null when no braces are present', () => {
		expect(extractJsonObject('no json here')).toBeNull()
	})

	test('returns null on malformed JSON rather than throwing', () => {
		expect(extractJsonObject('{"a": }')).toBeNull()
	})
})
