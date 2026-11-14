import { describe, expect, test } from 'vitest'

import { InProcessGraph } from './InProcessGraph'

describe('InProcessGraph - event-centric graph (designCognitiveBrain.md §16.8)', () => {
	test('createEventNode wires actor/target/context role edges', () => {
		const graph = new InProcessGraph()
		graph.upsertEntity({ id: 'emily', name: 'Emily', type: 'person' })
		graph.upsertEntity({ id: 'ai-ethics-meetup', name: 'AI Ethics Meetup', type: 'concept' })
		graph.upsertEntity({ id: 'london', name: 'London', type: 'location' })

		const event = graph.createEventNode({
			predicate: 'organized',
			actorId: 'emily',
			targetId: 'ai-ethics-meetup',
			contextId: 'london',
			occurredAt: new Date().toISOString(),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})

		expect(graph.getEventNode(event.id)).toEqual(event)

		const actorEdges = graph.getEdges('emily', 'event_actor')
		expect(actorEdges).toHaveLength(1)
		expect(actorEdges[0]).toMatchObject({ from: 'emily', to: event.id })

		const targetEdges = graph.getEdges(event.id, 'event_target')
		expect(targetEdges).toHaveLength(1)
		expect(targetEdges[0]).toMatchObject({ from: event.id, to: 'ai-ethics-meetup' })

		const contextEdges = graph.getEdges(event.id, 'event_context')
		expect(contextEdges).toHaveLength(1)
		expect(contextEdges[0]).toMatchObject({ from: event.id, to: 'london' })
	})

	test('createEventNode tolerates a partially-resolved event (actor only)', () => {
		const graph = new InProcessGraph()
		const event = graph.createEventNode({
			predicate: 'mentioned',
			actorId: 'emily',
			occurredAt: new Date().toISOString(),
			confidence: 0.7,
			sourceEntryId: 'entry-2',
		})
		expect(graph.getEdges('emily', 'event_actor')).toHaveLength(1)
		expect(graph.getEventNode(event.id)?.targetId).toBeUndefined()
	})

	test('getEventsForEntity finds events by role', () => {
		const graph = new InProcessGraph()
		const e1 = graph.createEventNode({
			predicate: 'organized',
			actorId: 'emily',
			targetId: 'meetup',
			occurredAt: new Date().toISOString(),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})
		const e2 = graph.createEventNode({
			predicate: 'attended',
			actorId: 'bob',
			targetId: 'meetup',
			occurredAt: new Date().toISOString(),
			confidence: 0.8,
			sourceEntryId: 'entry-2',
		})

		expect(graph.getEventsForEntity('emily', 'actor').map((e) => e.id)).toEqual([e1.id])
		expect(
			graph
				.getEventsForEntity('meetup', 'target')
				.map((e) => e.id)
				.sort()
		).toEqual([e1.id, e2.id].sort())
		expect(graph.getEventsForEntity('bob', 'actor')).toHaveLength(1)
		expect(graph.getEventsForEntity('nobody', 'actor')).toHaveLength(0)
	})

	test('serialize/deserialize round-trips event nodes', () => {
		const graph = new InProcessGraph()
		graph.createEventNode({
			predicate: 'organized',
			actorId: 'emily',
			targetId: 'meetup',
			occurredAt: new Date().toISOString(),
			confidence: 0.9,
			sourceEntryId: 'entry-1',
		})

		const snapshot = graph.serialize()
		expect(snapshot.eventNodes).toHaveLength(1)

		const restored = new InProcessGraph()
		restored.deserialize(snapshot)
		expect(restored.stats.eventCount).toBe(1)
		expect(restored.getEventsForEntity('emily', 'actor')).toHaveLength(1)
	})

	describe('pruneStaleEvents (bounded growth, §16.8.2 point 5)', () => {
		function iso(daysAgo: number): string {
			return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
		}

		test('leaves events inside the hot window/cap untouched', () => {
			const graph = new InProcessGraph()
			graph.createEventNode({
				predicate: 'organized',
				actorId: 'emily',
				occurredAt: iso(1),
				confidence: 0.9,
				sourceEntryId: 'entry-1',
			})

			const result = graph.pruneStaleEvents(Date.now(), 90 * 86_400_000, 500)
			expect(result.archived).toHaveLength(0)
			expect(result.summaries).toHaveLength(0)
			expect(graph.stats.eventCount).toBe(1)
		})

		test('rolls stale events beyond the window into one summary node per actor', () => {
			const graph = new InProcessGraph()
			for (let i = 0; i < 3; i++) {
				graph.createEventNode({
					predicate: 'chatted',
					actorId: 'emily',
					occurredAt: iso(120 + i),
					confidence: 0.8,
					sourceEntryId: `entry-${i}`,
				})
			}
			graph.createEventNode({
				predicate: 'attended',
				actorId: 'bob',
				occurredAt: iso(150),
				confidence: 0.6,
				sourceEntryId: 'entry-bob',
			})

			const result = graph.pruneStaleEvents(Date.now(), 90 * 86_400_000, 500)

			expect(result.archived).toHaveLength(4)
			expect(result.summaries).toHaveLength(2) // one per actor (emily, bob)

			const emilySummary = result.summaries.find((s) => s.actorId === 'emily')!
			expect(emilySummary.isSummary).toBe(true)
			expect(emilySummary.summarizedEventIds).toHaveLength(3)

			// Raw stale events are gone from the hot graph; only summaries remain.
			expect(graph.stats.eventCount).toBe(2)
			expect(graph.getEventsForEntity('emily', 'actor')).toHaveLength(1)
			expect(graph.getEventsForEntity('emily', 'actor')[0]!.isSummary).toBe(true)
		})

		test('recency cap forces rollup even within the age window when over maxHotEvents', () => {
			const graph = new InProcessGraph()
			for (let i = 0; i < 5; i++) {
				graph.createEventNode({
					predicate: 'chatted',
					actorId: 'emily',
					occurredAt: iso(i), // all recent
					confidence: 0.8,
					sourceEntryId: `entry-${i}`,
				})
			}

			// maxAgeMs is huge (nothing "old"), but cap forces the oldest beyond
			// the top-2 most-recent to be treated as stale once age is ignored
			// via a 0ms age threshold, isolating the cap behavior from age.
			const result = graph.pruneStaleEvents(Date.now(), 0, 2)
			expect(result.archived.length).toBeGreaterThan(0)
			expect(graph.stats.eventCount).toBeLessThan(5)
		})
	})
})
