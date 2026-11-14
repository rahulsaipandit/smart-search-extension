import { describe, expect, test } from 'vitest'

import type { PageFrontmatter } from '../types'
import { inferPageType, toOkfActor, toOkfV02 } from './okf'

describe('toOkfActor', () => {
	test('keeps values that are already actors', () => {
		expect(toOkfActor('human:owner')).toBe('human:owner')
		expect(toOkfActor('process:memory-engine')).toBe('process:memory-engine')
		expect(toOkfActor('reference_agent/gemini-2.5-pro')).toBe('reference_agent/gemini-2.5-pro')
	})

	test('turns a bare producer name into a process actor', () => {
		expect(toOkfActor('memory-engine')).toBe('process:memory-engine')
	})

	test('returns undefined for an empty value', () => {
		expect(toOkfActor(undefined)).toBeUndefined()
		expect(toOkfActor('   ')).toBeUndefined()
	})
})

describe('inferPageType', () => {
	test('follows the synthesis hints, including sourceIds', () => {
		expect(inferPageType({ title: 'a', synthesisQuality: 'T1' })).toBe('synthesis')
		expect(inferPageType({ title: 'a', provenanceState: 'inferred' })).toBe('insight')
		expect(inferPageType({ title: 'a', sourceIds: ['m1'] })).toBe('synthesis')
		expect(inferPageType({ title: 'a' })).toBe('artifact')
	})
})

describe('toOkfV02', () => {
	const synthesized: PageFrontmatter = {
		title: 'Executive presence',
		sources: ['m1', 'm2'],
		synthesisQuality: 'T1',
		synthesizedBy: 'memory-engine',
		synthesizedAt: '2026-10-08T09:00:00Z',
		lastUpgradedAt: null,
		confidence: 0.8,
		provenanceState: 'merged',
		contradictedBy: [],
		tags: ['career'],
	}

	test('adds type, generated and the legacy timestamp to a synthesized page', () => {
		const out = toOkfV02(synthesized)
		expect(out.type).toBe('synthesis')
		expect(out.generated).toEqual({ by: 'process:memory-engine', at: '2026-10-08T09:00:00Z' })
		expect(out.timestamp).toBe('2026-10-08T09:00:00Z')
	})

	test('moves string ids from sources to sourceIds', () => {
		const out = toOkfV02(synthesized)
		expect(out.sourceIds).toEqual(['m1', 'm2'])
		expect('sources' in out).toBe(false)
	})

	test('leaves OKF v0.2 shaped sources alone', () => {
		const out = toOkfV02({ title: 'a', sources: [{ resource: 'https://example.com/a' }] })
		expect(out.sources).toEqual([{ resource: 'https://example.com/a' }])
		expect(out.sourceIds).toBeUndefined()
	})

	test('keeps an empty sources list as it is', () => {
		const out = toOkfV02({ title: 'a', sources: [] })
		expect(out.sources).toEqual([])
	})

	test('keeps an explicit generated and an explicit type', () => {
		const out = toOkfV02({
			title: 'a',
			type: 'procedure',
			generated: { by: 'human:owner', at: '2026-10-08T10:00:00Z' },
			synthesizedBy: 'memory-engine',
			synthesizedAt: '2026-10-08T09:00:00Z',
		})
		expect(out.type).toBe('procedure')
		expect(out.generated).toEqual({ by: 'human:owner', at: '2026-10-08T10:00:00Z' })
	})

	test('omits generated when no producer is known, and keeps an existing timestamp', () => {
		const out = toOkfV02({ title: 'a', timestamp: '2026-10-08T08:00:00Z' })
		expect(out.generated).toBeUndefined()
		expect(out.timestamp).toBe('2026-10-08T08:00:00Z')
	})

	test('does not mutate its input and is idempotent', () => {
		const copy = JSON.parse(JSON.stringify(synthesized))
		const once = toOkfV02(synthesized)
		expect(synthesized).toEqual(copy)
		expect(toOkfV02(once)).toEqual(once)
	})

	test('keeps extra and custom fields', () => {
		const out = toOkfV02({ title: 'a', aliases: ['x'], contradictedBy: ['p1'], custom: 1 })
		expect(out.aliases).toEqual(['x'])
		expect(out.contradictedBy).toEqual(['p1'])
		expect(out.custom).toBe(1)
	})
})
