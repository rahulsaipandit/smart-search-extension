import { describe, expect, test } from 'vitest'

import type { MemoryEntry } from '../../types'
import { type EmbeddingFn, clusterBySimilarity, pickRepresentative } from './dedup'

function makeEntry(overrides: Partial<MemoryEntry> & { id: string; content: string }): MemoryEntry {
	return {
		type: 'semantic',
		createdAt: new Date(0).toISOString(),
		...overrides,
	}
}

/** Deterministic fake embedding: one-hot-ish vector keyed off a topic tag baked into content. */
function fakeEmbeddingFn(vectors: Record<string, number[]>): EmbeddingFn {
	return async (text: string) => {
		for (const [key, vec] of Object.entries(vectors)) {
			if (text.includes(key)) return vec
		}
		return [0, 0, 0]
	}
}

describe('clusterBySimilarity', () => {
	test('returns one cluster per entry when there are no duplicates', async () => {
		const a = makeEntry({ id: 'a', content: 'TOPIC_A something' })
		const b = makeEntry({ id: 'b', content: 'TOPIC_B something else' })
		const embeddingFn = fakeEmbeddingFn({ TOPIC_A: [1, 0, 0], TOPIC_B: [0, 1, 0] })

		const clusters = await clusterBySimilarity([a, b], embeddingFn)

		expect(clusters).toHaveLength(2)
	})

	test('near-identical embeddings (similarity >= 0.92) cluster together', async () => {
		const semantic = makeEntry({ id: 's1', type: 'semantic', content: 'TOPIC_A a summary' })
		const insight = makeEntry({ id: 'i1', type: 'insight', content: 'TOPIC_A a summary, derived' })
		// Identical vectors -> cosine similarity 1.0, comfortably above 0.92.
		const embeddingFn = fakeEmbeddingFn({ TOPIC_A: [1, 0, 0] })

		const clusters = await clusterBySimilarity([semantic, insight], embeddingFn)

		expect(clusters).toHaveLength(1)
		expect(clusters[0]).toHaveLength(2)
	})

	test('dedup precision - moderate similarity (~0.7) does not cluster (below 0.92 threshold)', async () => {
		const a = makeEntry({ id: 'a', content: 'broad topic, specific angle one' })
		const b = makeEntry({ id: 'b', content: 'broad topic, specific angle two' })
		// cos([1,1,0],[1,0.6,0]) ≈ 0.857*... let's use an explicit ~0.7 pair instead.
		const embeddingFn: EmbeddingFn = async (text) =>
			text.includes('angle one') ? [1, 0, 0] : [0.7, Math.sqrt(1 - 0.49), 0]

		const clusters = await clusterBySimilarity([a, b], embeddingFn)

		expect(clusters).toHaveLength(2)
	})

	test('falls back to lexical (Jaccard) similarity when no embeddingFn is provided', async () => {
		const a = makeEntry({ id: 'a', content: 'the quarterly report is due next Friday afternoon' })
		const b = makeEntry({ id: 'b', content: 'the quarterly report is due next Friday afternoon' })
		const c = makeEntry({ id: 'c', content: 'completely unrelated content about gardening' })

		const clusters = await clusterBySimilarity([a, b, c])

		expect(clusters).toHaveLength(2)
		const dupCluster = clusters.find((cl) => cl.length === 2)
		expect(dupCluster?.map((e) => e.id).sort()).toEqual(['a', 'b'])
	})

	test('returns [] for an empty candidate list', async () => {
		expect(await clusterBySimilarity([])).toEqual([])
	})
})

describe('pickRepresentative', () => {
	test('prefers a higher type tier: insight > procedure > semantic > episodic > prospective', () => {
		const episodic = makeEntry({ id: 'e', type: 'episodic', content: 'x' })
		const semantic = makeEntry({ id: 's', type: 'semantic', content: 'x' })
		const insight = makeEntry({ id: 'i', type: 'insight', content: 'x' })

		expect(pickRepresentative([episodic, semantic, insight]).id).toBe('i')
	})

	test('a procedure is preferred over a semantic entry', () => {
		const semantic = makeEntry({ id: 's', type: 'semantic', content: 'x' })
		const procedure = makeEntry({ id: 'p', type: 'procedure', content: 'x' })

		expect(pickRepresentative([semantic, procedure]).id).toBe('p')
	})

	test('within the same tier, a non-superseded entry is preferred over one with a child relation', () => {
		const superseded = makeEntry({
			id: 'old',
			type: 'semantic',
			content: 'x',
			relations: [{ type: 'child', targetId: 'new' }],
		})
		const current = makeEntry({ id: 'new', type: 'semantic', content: 'x' })

		expect(pickRepresentative([superseded, current]).id).toBe('new')
	})

	test('ties within the same tier and supersession status break on highest salience', () => {
		const low = makeEntry({ id: 'low', type: 'semantic', content: 'x', salience: 0.2 })
		const high = makeEntry({ id: 'high', type: 'semantic', content: 'x', salience: 0.9 })

		expect(pickRepresentative([low, high]).id).toBe('high')
	})
})
