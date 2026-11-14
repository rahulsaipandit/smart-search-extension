/**
 * IMemoryProcessor - Interface for memory pipeline processors.
 *
 * Processors transform and enhance memory entries through
 * summarization, insight extraction, importance scoring, etc.
 *
 * Ported from GA's lib/memory/pipeline/IMemoryProcessor.ts
 * with imports updated to CB package paths.
 */
import type { IMemoryService } from '../../interfaces/IMemoryService'
import type { MemoryEntry } from '../../types'
import type { InProcessGraph } from '../graph/InProcessGraph'

/**
 * Type for entries that can be created via memory.create().
 * Excludes id and createdAt which are auto-generated.
 */
export type CreateableMemoryEntry = Omit<MemoryEntry, 'id' | 'createdAt'>

export interface ProcessorContext {
	memory: IMemoryService
	llmService?: {
		complete(prompt: string): Promise<string>
	}
	/**
	 * Optional direct graph access, for processors that need to write node
	 * types IMemoryService doesn't model (e.g. EventNode, §16.8) rather than
	 * MemoryEntry relations. Undefined in any harness that doesn't wire it.
	 */
	graph?: InProcessGraph
}

export interface IMemoryProcessor {
	/** Unique name identifier */
	name: string

	/** Human-readable description */
	description?: string

	/**
	 * Determine if this processor should run on the given entry.
	 * @param entry The memory entry to evaluate
	 * @returns true if processor should process this entry
	 */
	shouldProcess(entry: MemoryEntry): Promise<boolean>

	/**
	 * Process the entry and optionally return a derived/updated entry.
	 * @param entry The memory entry to process
	 * @param context Runtime context including memory service and optional LLM
	 * @returns Updated entry, derived entry, or null if no change
	 */
	process(
		entry: MemoryEntry,
		context: ProcessorContext
	): Promise<CreateableMemoryEntry | CreateableMemoryEntry[] | null>
}

export default IMemoryProcessor
