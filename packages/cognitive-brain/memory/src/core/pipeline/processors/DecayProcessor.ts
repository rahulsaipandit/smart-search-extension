/**
 * DecayProcessor - Memory importance decay over time
 *
 * Ported from GA's lib/memory/processors/DecayProcessor.ts.
 * Lowers importance of old memories to manage storage and
 * simulate natural forgetting.
 *
 * GuideAxon: NOT HOOKED UP. It is not registered in MemoryService, so nothing runs it. Left unhooked on purpose for now (decision
 * 2026-10-15): not removed, not deprecated. If it is ever wired in, settle this first, because as it stands:
 *  - it lowers importance by 1 every 30 days for every entry, and prompt recall only returns entries of importance 2 or more
 *    (promptAssembly.gatherBrainBlocks), so memories would drop out of search after about 60 days;
 *  - forgetting is already done by the retention policies (MaintenanceCycle phase 9, T0SalienceProcessor.evaluateRetentionPolicy),
 *    which keep important entries whole (isProtectedFromForgetting), so decay would count the same age against them a second time.
 * Kept because it is exported and named in the design documents. docs/Memory/designMemoryProcessing.md, section 8.
 */
import type { MemoryEntry } from '../../../types'
import type { CreateableMemoryEntry, IMemoryProcessor, ProcessorContext } from '../IMemoryProcessor'

export class DecayProcessor implements IMemoryProcessor {
	name = 'decay'
	description = 'Lowers importance of old memories'

	private decayThresholdMs: number
	private decayAmount: number

	constructor(
		/** Minimum age before decay is applied, in days. Default: 30 */
		decayThresholdDays: number = 30,
		/** Amount to subtract from importance per decay cycle. Default: 1 */
		decayAmount: number = 1
	) {
		this.decayThresholdMs = decayThresholdDays * 24 * 60 * 60 * 1000
		this.decayAmount = decayAmount
	}

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		// Only process entries with importance > 1 (already at minimum)
		if (!entry.importance || entry.importance <= 1) return false

		// Check if entry is old enough (age > 30 days by default)
		const entryAge = Date.now() - new Date(entry.createdAt).getTime()
		if (entryAge < this.decayThresholdMs) return false

		// Don't process entries that have already been decayed within the threshold window
		if (entry.metadata?.lastDecayedAt) {
			const lastDecayAge = Date.now() - new Date(entry.metadata.lastDecayedAt as string).getTime()
			if (lastDecayAge < this.decayThresholdMs) return false
		}

		return true
	}

	async process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | null> {
		const newImportance = Math.max(1, (entry.importance || 3) - this.decayAmount)

		console.log(
			`[DecayProcessor] Decayed entry ${entry.id} importance: ${entry.importance} -> ${newImportance}`
		)

		await context.memory.update(entry.id, {
			importance: newImportance,
			metadata: {
				...entry.metadata,
				lastDecayedAt: new Date().toISOString(),
				decayCount: ((entry.metadata?.decayCount as number) || 0) + 1,
			},
		})

		return null
	}
}

export default DecayProcessor
