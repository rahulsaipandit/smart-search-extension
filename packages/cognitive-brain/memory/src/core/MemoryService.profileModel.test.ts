import { describe, expect, test, vi } from 'vitest'

import type { IMemoryIndex } from '../interfaces/IMemoryIndex'
import type { IMemoryStore } from '../interfaces/IMemoryStore'
import type { IndexResult, MemoryEntry, MemoryFilter, MemoryRelation } from '../types'
import { MemoryService } from './MemoryService'
import { InProcessGraph } from './graph/InProcessGraph'
import { setGapMetrics } from './metrics/gapMetrics'
import { PROFILE_PENDING_TAG, PROFILE_SHADOWED_TAG } from './profile/ProfileClassifier'

// The model tier of profile classification: entries the patterns missed carry `profile-pending`; a model, through the
// `profile.classify` port, reads the user's statement for a small batch of them. Same "real service, minimal store/index"
// pattern as the other MemoryService tests; the model is a fake port.

const matches = (e: MemoryEntry, f: MemoryFilter) => {
	const durable = (f as { isDurable?: boolean }).isDurable
	return (
		(!f.tags || f.tags.every((t) => e.tags?.includes(t))) &&
		(!f.lifecycleState || f.lifecycleState === e.lifecycleState) &&
		(durable === undefined || e.isDurable === durable)
	)
}

class Store implements IMemoryStore {
	entries = new Map<string, MemoryEntry>()
	async get(id: string) {
		return this.entries.get(id) ?? null
	}
	async put(e: MemoryEntry) {
		this.entries.set(e.id, e)
	}
	async delete(id: string) {
		this.entries.delete(id)
	}
	async query(filter: MemoryFilter, limit?: number) {
		let m = [...this.entries.values()]
			.filter((e) => matches(e, filter))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		if (limit !== undefined) m = m.slice(0, limit)
		return { entries: m, cursor: null }
	}
	async putMany(es: MemoryEntry[]) {
		for (const e of es) this.entries.set(e.id, e)
	}
	async deleteMany(ids: string[]) {
		for (const id of ids) this.entries.delete(id)
	}
	async count(f?: MemoryFilter) {
		return [...this.entries.values()].filter((e) => matches(e, f ?? {})).length
	}
	async getRelations(): Promise<MemoryRelation[]> {
		return []
	}
	async putRelation() {}
	async deleteRelation() {}
	async initialize() {}
	async close() {}
	async clear() {
		this.entries.clear()
	}
}
class Index implements IMemoryIndex {
	async index() {}
	async remove() {}
	async search(): Promise<IndexResult[]> {
		return []
	}
	async indexMany() {}
	async initialize() {}
	async close() {}
}

let seq = 0
const pending = (content: string, extra: Partial<MemoryEntry> = {}): MemoryEntry => ({
	id: `p${++seq}`,
	type: 'episodic',
	content,
	tags: ['conversation', PROFILE_PENDING_TAG],
	createdAt: new Date(Date.now() - seq * 1000).toISOString(),
	lifecycleState: 'active',
	isDurable: true,
	metadata: { profileClassified: true },
	...extra,
})

type Classify = NonNullable<ConstructorParameters<typeof MemoryService>[0]['profile']>['classify']

async function setup(entries: MemoryEntry[], classify?: Classify) {
	const store = new Store()
	for (const e of entries) await store.put(e)
	const service = new MemoryService({
		store,
		index: new Index(),
		graph: new InProcessGraph(),
		maintenance: { disabled: true },
		...(classify ? { profile: { classify } } : {}),
	})
	await service.initialize()
	return { service, store }
}

const answered = (header: 'life_context' | 'communication_style' | 'autonomy' | null): Classify =>
	vi.fn(async () => ({ status: 'answered' as const, header }))

describe('MemoryService.classifyPendingProfileFacts (the model tier, through the profile.classify port)', () => {
	test('a model places an entry the patterns missed: it gets the header tag, loses the pending tag, and a section is written from the user words', async () => {
		const e = pending('User: ops is mine now, all of it\nAssistant: Understood, my team is ready.')
		const classify = answered('life_context')
		const { service, store } = await setup([e], classify)

		expect(await service.classifyPendingProfileFacts()).toBe(1)

		const saved = (await store.get(e.id))!
		expect(saved.tags).toEqual(['conversation', 'profile:life_context'])
		expect(saved.metadata).toMatchObject({ profileModelChecked: true })
		expect(classify).toHaveBeenCalledWith('ops is mine now, all of it') // the user's words only, not the reply
		const dynamic = (await service.getProfile()).sections.find(
			(s) => s.header === 'life_context'
		)?.dynamic
		expect(dynamic).toContain('ops is mine now')
		expect(dynamic).not.toContain('my team is ready')
	})

	test('"none" settles an entry without placing it, so it is not asked about again', async () => {
		const e = pending("User: I'm hungry\nAssistant: Lunch.")
		const classify = answered(null)
		const { service, store } = await setup([e], classify)

		expect(await service.classifyPendingProfileFacts()).toBe(1)
		expect((await store.get(e.id))!.tags).toEqual(['conversation'])
		expect(await service.classifyPendingProfileFacts()).toBe(0)
		expect(classify).toHaveBeenCalledTimes(1)
	})

	test('an unclear answer is retried once more, then given up on, and never blocks the entries behind it', async () => {
		const e = pending('User: ops is mine now\nAssistant: ok')
		const { service, store } = await setup(
			[e],
			vi.fn(async () => ({ status: 'unclear' as const }))
		)

		expect(await service.classifyPendingProfileFacts()).toBe(0) // try 1: still pending
		expect((await store.get(e.id))!.tags).toContain(PROFILE_PENDING_TAG)
		expect(await service.classifyPendingProfileFacts()).toBe(1) // try 2: given up
		const saved = (await store.get(e.id))!
		expect(saved.tags).toEqual(['conversation'])
		expect(saved.metadata).toMatchObject({ profileModelTries: 2 })
	})

	test('a port that throws counts as an unclear answer', async () => {
		const e = pending('User: ops is mine now\nAssistant: ok')
		const { service, store } = await setup(
			[e],
			vi.fn(async () => {
				throw new Error('backend crashed')
			})
		)

		expect(await service.classifyPendingProfileFacts()).toBe(0)
		expect((await store.get(e.id))!.metadata).toMatchObject({ profileModelTries: 1 })
	})

	test('"unavailable" (gate off, no model, hosted without opt-in) stops the pass: nothing asked beyond the first, nothing counted, tags stay', async () => {
		const entries = [
			pending('User: ops is mine now\nAssistant: ok'),
			pending('User: finance is mine too\nAssistant: ok'),
		]
		const classify = vi.fn(async () => ({ status: 'unavailable' as const }))
		const { service, store } = await setup(entries, classify)

		expect(await service.classifyPendingProfileFacts()).toBe(0)
		expect(classify).toHaveBeenCalledTimes(1)
		for (const e of entries) {
			const saved = (await store.get(e.id))!
			expect(saved.tags).toContain(PROFILE_PENDING_TAG)
			expect(saved.metadata?.profileModelTries).toBeUndefined()
		}
	})

	test('only a small batch is asked per run', async () => {
		const entries = Array.from({ length: 25 }, (_, i) =>
			pending(`User: statement ${i}\nAssistant: ok`)
		)
		const classify = answered(null)
		const { service } = await setup(entries, classify)

		expect(await service.classifyPendingProfileFacts()).toBe(10)
		expect(classify).toHaveBeenCalledTimes(10)
		expect(await service.classifyPendingProfileFacts()).toBe(10)
	})

	test('without the port there is no model tier: nothing is asked and the pending tags stay', async () => {
		const e = pending('User: ops is mine now\nAssistant: ok')
		const { service, store } = await setup([e])

		expect(await service.classifyPendingProfileFacts()).toBe(0)
		expect((await store.get(e.id))!.tags).toContain(PROFILE_PENDING_TAG)
	})
})

// ── a gate in shadow mode: asked, recorded, never applied ────────────────────────────────────────────────────────────────

describe('classifyPendingProfileFacts while the gate is in shadow mode', () => {
	const live = (header: 'life_context' | null = 'life_context') =>
		vi.fn(async () => ({ status: 'answered' as const, header }))

	test('an entry asked about in shadow mode is kept: it moves to profile-shadowed and no try is counted', async () => {
		const entries = [
			pending('User: ops is mine now\nAssistant: ok'),
			pending('User: finance is mine too\nAssistant: ok'),
		]
		const classify = vi.fn(async () => ({ status: 'shadow' as const }))
		const { service, store } = await setup(entries, classify)

		expect(await service.classifyPendingProfileFacts()).toBe(0)

		for (const e of entries) {
			const saved = (await store.get(e.id))!
			expect(saved.tags).toEqual(['conversation', PROFILE_SHADOWED_TAG])
			expect(saved.metadata?.profileModelTries).toBeUndefined()
		}
	})

	test('shadow mode never uses up an entry: any number of passes later it is still waiting, not given up', async () => {
		const e = pending('User: ops is mine now\nAssistant: ok')
		const { service, store } = await setup(
			[e],
			vi.fn(async () => ({ status: 'shadow' as const }))
		)

		for (let i = 0; i < 6; i++) await service.classifyPendingProfileFacts()

		const saved = (await store.get(e.id))!
		expect(saved.tags).toContain(PROFILE_SHADOWED_TAG)
		expect(saved.metadata?.profileModelTries).toBeUndefined()
	})

	test('while the gate stays in shadow mode only ONE shadowed entry is probed per pass (the same decisions are not recorded again)', async () => {
		const entries = Array.from({ length: 6 }, (_, i) =>
			pending(`User: statement ${i}\nAssistant: ok`, {
				tags: ['conversation', PROFILE_SHADOWED_TAG],
			})
		)
		const classify = vi.fn(async () => ({ status: 'shadow' as const }))
		const { service } = await setup(entries, classify)

		await service.classifyPendingProfileFacts()
		expect(classify).toHaveBeenCalledTimes(1)
	})

	test('shadowed entries are not asked again in the pass that moved them', async () => {
		const entries = Array.from({ length: 3 }, (_, i) =>
			pending(`User: statement ${i}\nAssistant: ok`)
		)
		const classify = vi.fn(async () => ({ status: 'shadow' as const }))
		const { service } = await setup(entries, classify)

		await service.classifyPendingProfileFacts()
		expect(classify).toHaveBeenCalledTimes(3)
	})

	test('when the gate goes live the shadowed entries are classified: placed, or settled as none', async () => {
		const a = pending('User: ops is mine now\nAssistant: ok', {
			tags: ['conversation', PROFILE_SHADOWED_TAG],
		})
		const b = pending("User: I'm hungry\nAssistant: ok", {
			tags: ['conversation', PROFILE_SHADOWED_TAG],
		})
		const classify = vi.fn(async (s: string) => ({
			status: 'answered' as const,
			header: s.includes('ops') ? ('life_context' as const) : null,
		}))
		const { service, store } = await setup([a, b], classify)

		expect(await service.classifyPendingProfileFacts()).toBe(2)

		expect((await store.get(a.id))!.tags).toEqual(['conversation', 'profile:life_context'])
		expect((await store.get(b.id))!.tags).toEqual(['conversation'])
		expect(
			(await service.getProfile()).sections.find((s) => s.header === 'life_context')?.dynamic
		).toContain('ops is mine now')
	})

	test('pending entries are asked first; shadowed ones only with what is left of the batch', async () => {
		const shadowed = Array.from({ length: 4 }, (_, i) =>
			pending(`User: old ${i}\nAssistant: ok`, { tags: ['conversation', PROFILE_SHADOWED_TAG] })
		)
		const fresh = pending('User: new one\nAssistant: ok')
		const classify = live(null)
		const { service } = await setup([...shadowed, fresh], classify)

		await service.classifyPendingProfileFacts(3) // 1 pending + 2 of the shadowed
		expect(classify).toHaveBeenCalledTimes(3)
		expect((classify.mock.calls[0] as unknown as [string])[0]).toBe('new one')
	})

	test('a live but undecided answer for a shadowed entry sends it back to pending with the try counted', async () => {
		const e = pending('User: ops is mine now\nAssistant: ok', {
			tags: ['conversation', PROFILE_SHADOWED_TAG],
		})
		const { service, store } = await setup(
			[e],
			vi.fn(async () => ({ status: 'unclear' as const }))
		)

		await service.classifyPendingProfileFacts()

		const saved = (await store.get(e.id))!
		expect(saved.tags).toEqual(['conversation', PROFILE_PENDING_TAG])
		expect(saved.metadata).toMatchObject({ profileModelTries: 1 })
	})

	test('an unavailable gate stops the pass before the shadowed entries too', async () => {
		const e = pending('User: ops is mine now\nAssistant: ok', {
			tags: ['conversation', PROFILE_SHADOWED_TAG],
		})
		const classify = vi.fn(async () => ({ status: 'unavailable' as const }))
		const { service, store } = await setup([e], classify)

		expect(await service.classifyPendingProfileFacts()).toBe(0)
		expect(classify).toHaveBeenCalledTimes(1)
		expect((await store.get(e.id))!.tags).toContain(PROFILE_SHADOWED_TAG)
	})

	test('a shadowed entry is not made pending again by the backfill', async () => {
		const e = pending('User: ops is mine now\nAssistant: ok', {
			tags: ['conversation', PROFILE_SHADOWED_TAG],
		})
		const { service, store } = await setup([e])

		await service.backfillProfileClassification()
		expect((await store.get(e.id))!.tags).toEqual(['conversation', PROFILE_SHADOWED_TAG])
	})
})

// ── entries stored under the older classifier ────────────────────────────────────────────────────────────────────────

describe('MemoryService.backfillProfileClassification', () => {
	const old = (content: string, extra: Partial<MemoryEntry> = {}) =>
		pending(content, { tags: ['conversation'], ...extra })

	test('re-checks durable entries the old patterns missed: a match is tagged and written to the profile, a miss is tagged pending', async () => {
		const role = old(
			"User: I'm a VP of Sales at a logistics company\nAssistant: Your profile: VP of Sales."
		)
		const hungry = old("User: I'm hungry\nAssistant: Lunch.")
		const { service, store } = await setup([role, hungry])

		expect(await service.backfillProfileClassification()).toBe(2)

		const a = (await store.get(role.id))!
		expect(a.tags).toEqual(['conversation', 'profile:life_context'])
		expect(a.metadata).toMatchObject({ profileClassified: true, profileClassifierVersion: 2 })
		const b = (await store.get(hungry.id))!
		expect(b.tags).toEqual(['conversation', PROFILE_PENDING_TAG])
		const dynamic = (await service.getProfile()).sections.find(
			(s) => s.header === 'life_context'
		)?.dynamic
		expect(dynamic).toContain("I'm a VP of Sales")
		expect(dynamic).not.toContain('Your profile')
	})

	test('an entry already placed is only stamped; one already at this version is left alone; none is checked twice', async () => {
		const placed = old('User: I work at Stripe\nAssistant: ok', {
			tags: ['conversation', 'profile:life_context'],
		})
		const current = old('User: ops is mine now\nAssistant: ok', {
			metadata: { profileClassified: true, profileClassifierVersion: 2 },
		})
		const { service, store } = await setup([placed, current])

		expect(await service.backfillProfileClassification()).toBe(1)
		expect((await store.get(placed.id))!.metadata).toMatchObject({ profileClassifierVersion: 2 })
		expect((await store.get(current.id))!.tags).toEqual(['conversation']) // untouched: not tagged pending
		expect(await service.backfillProfileClassification()).toBe(0)
	})

	test('an entry a model already looked at is not made pending again', async () => {
		const checked = old('User: ops is mine now\nAssistant: ok', {
			metadata: { profileClassified: true, profileModelChecked: true },
		})
		const { service, store } = await setup([checked])

		await service.backfillProfileClassification()
		expect((await store.get(checked.id))!.tags).toEqual(['conversation'])
	})

	test('works in batches', async () => {
		const entries = Array.from({ length: 5 }, (_, i) => old(`User: statement ${i}\nAssistant: ok`))
		const { service } = await setup(entries)

		expect(await service.backfillProfileClassification(2)).toBe(2)
		expect(await service.backfillProfileClassification(2)).toBe(2)
		expect(await service.backfillProfileClassification(2)).toBe(1)
		expect(await service.backfillProfileClassification(2)).toBe(0)
	})
})

describe('the backfill scan is measured (GAP-METRIC), so its cost on a real store can be read before anyone adds a marker', () => {
	const old = (content: string) => pending(content, { tags: ['conversation'] })
	const lines = (spy: ReturnType<typeof vi.spyOn>) =>
		spy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.filter((l: string) => l.startsWith('[GAP-METRIC] profile backfill_scan'))

	test('logs what it scanned, checked and left, and the time', async () => {
		setGapMetrics(true)
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			const entries = Array.from({ length: 5 }, (_, i) =>
				old(`User: statement ${i}\nAssistant: ok`)
			)
			const { service } = await setup(entries)

			await service.backfillProfileClassification(2)

			const [line] = lines(log)
			expect(line).toBeDefined()
			const data = JSON.parse(line!.replace('[GAP-METRIC] profile backfill_scan ', ''))
			expect(data).toMatchObject({
				durableScanned: 5,
				checked: 2,
				stillUnchecked: 3,
				verdict: 'fine, the scan is cheap',
			})
			expect(typeof data.ms).toBe('number')
		} finally {
			log.mockRestore()
			setGapMetrics(undefined)
		}
	})

	test('says so when the scan hits its 10,000-entry cap (entries beyond it are never re-checked)', async () => {
		setGapMetrics(true)
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			const { service, store } = await setup([])
			// A store that answers a full 10,000: the scan cannot see past it.
			store.query = async () => ({
				entries: Array.from({ length: 10_000 }, (_, i) => ({
					...old(`User: s ${i}\nAssistant: ok`),
					metadata: { profileClassified: true, profileClassifierVersion: 2 },
				})),
				cursor: null,
			})

			await service.backfillProfileClassification()

			const data = JSON.parse(lines(log)[0]!.replace('[GAP-METRIC] profile backfill_scan ', ''))
			expect(data.verdict).toMatch(/hit its 10,000-entry cap/)
		} finally {
			log.mockRestore()
			setGapMetrics(undefined)
		}
	})

	test('is silent when metrics are off (the default outside a dev build)', async () => {
		setGapMetrics(false)
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			const { service } = await setup([old('User: statement\nAssistant: ok')])
			await service.backfillProfileClassification()
			expect(lines(log)).toHaveLength(0)
		} finally {
			log.mockRestore()
			setGapMetrics(undefined)
		}
	})
})

// ── waiting for background processing ────────────────────────────────────────────────────────────────────────────────────

describe('MemoryService.flushProcessing', () => {
	test('resolves at once when nothing is queued', async () => {
		const { service } = await setup([])
		await expect(service.flushProcessing()).resolves.toBeUndefined()
	})

	test('waits for enrichment: afterwards every stored entry has been through the profile classifier', async () => {
		const { service, store } = await setup([])
		const ids: string[] = []
		for (let i = 0; i < 12; i++) {
			ids.push(
				await service.create({
					type: 'episodic',
					content:
						i % 2
							? `User: I work at Company ${i}\nAssistant: ok`
							: `User: I'm hungry ${i}\nAssistant: ok`,
					isDurable: true,
					tags: ['conversation'],
				} as never)
			)
		}

		await service.flushProcessing()

		for (const id of ids) {
			const e = (await store.get(id))!
			expect(e.metadata).toMatchObject({ profileClassified: true, profileClassifierVersion: 2 })
		}
		expect((await store.get(ids[1]!))!.tags).toContain('profile:life_context')
		expect((await store.get(ids[0]!))!.tags).toContain(PROFILE_PENDING_TAG)
	})
})
