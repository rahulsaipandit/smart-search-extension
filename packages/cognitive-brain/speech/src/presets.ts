import type { SttEngineId, SttModelSetting, SttPreset } from './types'

/**
 * Approximate sizes and speeds are ESTIMATES, not measurements (docs/designMeetingCoach.md §4.4). Replace
 * them with measured numbers (download size; time to transcribe an utterance against its length)
 * before they are relied on, and pick the default from that measurement.
 */
export const WHISPER_PRESETS: readonly SttPreset[] = [
	{
		id: 'tiny.en',
		label: 'Whisper tiny (English)',
		repo: 'Xenova/whisper-tiny.en',
		approxSizeMb: 40,
		speedNote: 'Fastest and smallest, least accurate. Keeps up with speech on most machines.',
		needsWebGpu: false,
		englishOnly: true,
	},
	{
		id: 'base.en',
		label: 'Whisper base (English)',
		repo: 'Xenova/whisper-base.en',
		approxSizeMb: 80,
		speedNote: 'About twice tiny. More accurate, still near real time on most machines.',
		needsWebGpu: false,
		englishOnly: true,
	},
	{
		id: 'small',
		label: 'Whisper small (multilingual)',
		repo: 'Xenova/whisper-small',
		approxSizeMb: 250,
		speedNote: 'Noticeably slower on CPU; use it with WebGPU. Also covers other languages.',
		needsWebGpu: true,
		englishOnly: false,
	},
	{
		id: 'medium',
		label: 'Whisper medium (multilingual)',
		repo: 'Xenova/whisper-medium',
		approxSizeMb: 800,
		speedNote: 'May not keep up with a live call. Most accurate of these; WebGPU only.',
		needsWebGpu: true,
		englishOnly: false,
	},
]

const PRESETS_BY_ENGINE: Record<SttEngineId, readonly SttPreset[]> = { whisper: WHISPER_PRESETS }

export const ENGINE_LABELS: Record<SttEngineId, string> = { whisper: 'Whisper' }

export function presetsFor(engine: SttEngineId): readonly SttPreset[] {
	return PRESETS_BY_ENGINE[engine] ?? []
}

/** The preset a setting names, or null when it names none that exists (an old or hand-edited value). */
export function findPreset(setting: SttModelSetting | undefined): SttPreset | null {
	if (!setting) return null
	return presetsFor(setting.engine).find((p) => p.id === setting.model) ?? null
}

/** Presets the user may pick: the ones needing WebGPU are hidden when it is not there. */
export function availablePresets(engine: SttEngineId, hasWebGpu: boolean): readonly SttPreset[] {
	return presetsFor(engine).filter((p) => hasWebGpu || !p.needsWebGpu)
}
