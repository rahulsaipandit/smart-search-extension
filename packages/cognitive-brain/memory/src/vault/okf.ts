import type { PageFrontmatter } from '../types'

/**
 * GuideAxon change (2026-10-08): helpers for Open Knowledge Format v0.2 (OKF).
 * Specification: https://github.com/GoogleCloudPlatform/open-knowledge-format (SPEC.md, read 2026-10-08).
 *
 * What v0.2 changed that matters for vault pages:
 *   - `timestamp` is superseded by `generated.at` (readers may still fall back to `timestamp`);
 *   - `generated` is `{ by, at }`, and `by` is an "actor": `<producer>/<version>`, `human:<id>` or `process:<id>`;
 *   - `sources` is a list of entries that each carry a `resource` URI. We used it for MemoryEntry ids, which is
 *     not that shape, so ids now live under `sourceIds` (a custom key, which OKF allows).
 * `type` is the only key OKF always requires.
 */

/** The type recorded for a page that does not name one. */
export function inferPageType(fm: PageFrontmatter): string {
	if (fm.synthesisQuality) return 'synthesis'
	if (fm.provenanceState === 'inferred') return 'insight'
	if ((fm.sources && fm.sources.length > 0) || (fm.sourceIds && fm.sourceIds.length > 0))
		return 'synthesis'
	return 'artifact'
}

/**
 * Puts a producer name into OKF actor form. A value that is already an actor (`human:` or `process:` prefix, or
 * `<producer>/<version>`) is kept; a bare name such as 'memory-engine' becomes `process:memory-engine`, since the
 * synthesis engine is an automated process.
 */
export function toOkfActor(name: string | undefined): string | undefined {
	const trimmed = name?.trim()
	if (!trimmed) return undefined
	if (trimmed.startsWith('human:') || trimmed.startsWith('process:') || trimmed.includes('/'))
		return trimmed
	return `process:${trimmed}`
}

/**
 * Returns a copy of `fm` in OKF v0.2 shape. Idempotent.
 *  - `type` is always present;
 *  - `generated: { by, at }` is derived from `synthesizedBy` and `synthesizedAt` (or `timestamp`) when both a
 *    producer and a time are known, and an explicit `generated` is kept;
 *  - the legacy `timestamp` is kept, and set to the generated time when absent, for one release;
 *  - a non-empty list of string ids in `sources` moves to `sourceIds`; v0.2-shaped `sources` entries are left alone.
 */
export function toOkfV02(fm: PageFrontmatter): PageFrontmatter {
	const out: PageFrontmatter = { ...fm }

	out.type = fm.type ?? inferPageType(fm)

	const at = fm.generated?.at ?? fm.synthesizedAt ?? fm.timestamp
	const by = fm.generated?.by ?? toOkfActor(fm.synthesizedBy)
	if (by && at) out.generated = { by, at }

	if (!out.timestamp && at) out.timestamp = at

	const sources = fm.sources
	if (Array.isArray(sources) && sources.length > 0 && sources.every((s) => typeof s === 'string')) {
		out.sourceIds = [...new Set([...(fm.sourceIds ?? []), ...(sources as string[])])]
		delete out.sources
	}

	return out
}
