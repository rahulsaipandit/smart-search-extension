/**
 * Measurements for the open gaps in docs/designKnownGaps.md (section 10.1) and docs/designGapMeasurements.md (section 10.1a): one console line per event, prefixed `[GAP-METRIC]`,
 * so a device log answers "do we need to close this gap?" without a profiler. Filter the log with `adb logcat | grep GAP-METRIC`
 * or the browser console filter `GAP-METRIC`.
 *
 * On by default in a dev build (`__DEV__`), off elsewhere (production web builds drop console output anyway). Force it on or off
 * with `setGapMetrics(true | false)` or `globalThis.GAP_METRICS = true`. Measuring only: it never changes behaviour and never throws.
 */
export const GAP_TAG_QUERY_SLOW_MS = 50

let forced: boolean | undefined

export function setGapMetrics(on: boolean | undefined): void {
	forced = on
}

export function gapMetricsEnabled(): boolean {
	if (forced !== undefined) return forced
	const g = globalThis as { GAP_METRICS?: boolean; __DEV__?: boolean }
	if (g.GAP_METRICS !== undefined) return g.GAP_METRICS
	return g.__DEV__ === true
}

/** One line: `[GAP-METRIC] gap12 tag_query {"ms":12.4,...}`. `verdict` says what the number means for the gap. */
export function gapMetric(
	gap: 'gap11' | 'gap12' | 'profile',
	event: string,
	data: Record<string, unknown>
): void {
	if (!gapMetricsEnabled()) return
	try {
		console.log(`[GAP-METRIC] ${gap} ${event} ${JSON.stringify(data)}`)
	} catch {
		// measuring must never break the app
	}
}

export const nowMs = (): number =>
	typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
