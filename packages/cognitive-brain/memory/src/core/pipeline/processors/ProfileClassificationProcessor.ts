/**
 * ProfileClassificationProcessor - tags durable facts with a Profile header
 * and regenerates that section (designCognitiveBrain.md §17.2.5).
 *
 * Runs after ContradictionResolutionProcessor in the pluggable processor
 * chain (registration order in MemoryService.initialize()) - by the time this
 * runs, `entry.isDurable` is already set and any contradiction/reinforcement
 * has already been resolved, so classification sees the settled fact.
 *
 * Regenerates synchronously per-fact rather than the "background, batched"
 * optimization the design doc mentions as a future improvement - correctness
 * first, batching is a performance optimization that can be layered on later
 * without changing the section's content.
 */
import type { MemoryEntry } from '../../../types'
import {
	PROFILE_CLASSIFIER_VERSION,
	PROFILE_PENDING_TAG,
	applyProfileClassification,
} from '../../profile/ProfileClassifier'
import { ProfileSynthesizer } from '../../profile/ProfileSynthesizer'
import type { CreateableMemoryEntry, IMemoryProcessor, ProcessorContext } from '../IMemoryProcessor'

export class ProfileClassificationProcessor implements IMemoryProcessor {
	name = 'profile-classification'
	description = 'Tags durable facts with a Profile header and regenerates that section (§17.2.5)'

	private readonly synthesizer = new ProfileSynthesizer()

	async shouldProcess(entry: MemoryEntry): Promise<boolean> {
		return entry.isDurable === true && !entry.metadata?.profileClassified
	}

	async process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | CreateableMemoryEntry[] | null> {
		// Patterns only, here: free and instant. This runs inside the pipeline queue, which has few slots, so a model call per
		// durable entry would hold up everything queued behind it. A durable entry the patterns miss is tagged pending, and the
		// maintenance pass (MemoryService.classifyPendingProfileFacts) asks a model about it later, in a small batch.
		const header = applyProfileClassification(entry)
		if (!header && !(entry.tags ?? []).includes(PROFILE_PENDING_TAG)) {
			entry.tags = [...(entry.tags ?? []), PROFILE_PENDING_TAG]
		}

		// Persist explicitly via context.memory.update() - Step 4 (store.put) in
		// Pipeline.ts already ran before this pluggable-processor step, so a
		// returned partial object would only mutate the in-memory object and
		// never get re-saved (same lesson as ContradictionResolutionProcessor).
		await context.memory.update(entry.id, {
			tags: entry.tags,
			metadata: {
				...entry.metadata,
				profileClassified: true,
				profileClassifierVersion: PROFILE_CLASSIFIER_VERSION,
			},
		})

		if (header) {
			const section = await this.synthesizer.computeSection(
				header,
				context.memory,
				context.llmService
			)
			await context.memory.persistProfileSection(section)
		}

		return null
	}
}

export default ProfileClassificationProcessor
