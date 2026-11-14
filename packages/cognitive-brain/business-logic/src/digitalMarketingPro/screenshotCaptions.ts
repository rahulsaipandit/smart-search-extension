/**
 * Screenshot caption optimization (design doc §4.2's "Screenshot caption
 * optimization" section, added after reviewing Appfigures' "App Store
 * Algorithm Update 2025" guide — a single external source, not one of the
 * ten cross-corroborated ones the rest of this package's design rests on;
 * see design doc §8.12 for that caveat).
 *
 * That source describes Apple now OCR'ing screenshot caption text and
 * folding it into keyword metadata, plus concrete guidance on caption
 * placement/contrast/font/theme-focus/repetition. This module can only act
 * on the *text* half of that: `@page-agent/llms`'s `Message.content` is
 * `string | null` with no image-input support (see types.ts's
 * `ScreenshotCaption` doc comment), so there is no vision-LLM path in this
 * codebase yet to OCR a screenshot image itself. Contrast/font/shadow
 * legibility therefore can't be *measured* here — this module asks the user
 * to type in the caption text they already put on each screenshot (position
 * included), and:
 *   - extracts keyword candidates from that text (a fifth keyword-provenance
 *     source, alongside LLM generation/competitor mining/autocomplete/Apple
 *     Recommendations in keywordDiscovery.ts),
 *   - runs the checks that ARE decidable from text alone (placement,
 *     one-theme-per-caption, passive-caption phrasing, cross-caption
 *     keyword repetition),
 *   - and surfaces the contrast/font/shadow guidance as an explicit
 *     reminder, deliberately scored 'unknown' rather than guessed, per this
 *     project's "coarse tiers, not fake-precise numbers" principle
 *     (designDigitalMarketingPro.md §4.7) — extended here to "don't score
 *     what you can't see."
 */
import type { CheckDraft } from './audit'
import { ngramPhrases } from './scoring'
import type { ScreenshotCaption } from './types'

/**
 * Generic, non-search-relevant caption phrasing the source calls out by name
 * as underperforming actual keyword-bearing captions. Matched as whole-phrase,
 * case-insensitive substrings — a best-effort lint, not a guarantee (same
 * caveat as policyLint.ts's other phrase-based checks). Deliberately excludes
 * generic-sounding phrases that are also common inside genuinely good,
 * keyword-bearing captions — e.g. "best app" collides with legitimate copy
 * like "Best app for tracking macros daily," which is specific, keyword-rich
 * ASO copy, not filler, despite containing that substring.
 */
const PASSIVE_CAPTION_PHRASES = [
	'easy to use',
	'beautiful design',
	'simple and intuitive',
	'intuitive interface',
	'user friendly',
	'user-friendly',
	'powerful features',
	'looks great',
	'made for you',
]

function normalizeCaptionText(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Cap on how many caption-mined phrases feed into keyword discovery — each
 * kept phrase costs a live store search in keywordDiscovery.ts's bounded-
 * concurrency scoring loop, so an uncapped mine of several long captions
 * could produce well over a hundred candidates from this source alone.
 * Mirrors keywordDiscovery.ts's `MAX_COMPETITOR_METADATA_TERMS` — the same
 * cost problem, for the same reason, on the caption side of the pipeline
 * instead of the competitor-mining side.
 */
const MAX_CAPTION_KEYWORD_TERMS = 40

/**
 * Extracts keyword-candidate phrases from caption text: the whole caption
 * (in case it's itself a usable long-tail phrase, e.g. "track your habits
 * daily"), plus 2-3 word contiguous phrases from its significant words —
 * approximating the "long-tail keyword variations that merge with primary
 * keywords" idea from the source, without a full NLP pipeline. Phrases used
 * by more captions are kept first (the same "cross-item corroboration wins"
 * ranking `mineCompetitorMetadataKeywords` uses in keywordDiscovery.ts), then
 * truncated to `MAX_CAPTION_KEYWORD_TERMS`. Empty captions contribute
 * nothing.
 */
export function extractCaptionKeywordSeeds(captions: ScreenshotCaption[]): string[] {
	const captionCountByPhrase = new Map<string, number>()
	for (const caption of captions) {
		const text = normalizeCaptionText(caption.text)
		if (!text) continue
		const phrasesForCaption = new Set<string>([text, ...ngramPhrases(text, 2, 3)])
		for (const phrase of phrasesForCaption) {
			captionCountByPhrase.set(phrase, (captionCountByPhrase.get(phrase) ?? 0) + 1)
		}
	}
	return [...captionCountByPhrase.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_CAPTION_KEYWORD_TERMS)
		.map(([phrase]) => phrase)
}

/** Takes the already-filtered non-empty caption list — computed once by `buildScreenshotCaptionChecks` and shared with the other checks, rather than re-filtering here. */
function checkCoverage(nonEmpty: ScreenshotCaption[]): CheckDraft {
	if (nonEmpty.length === 0) {
		return {
			id: 'screenshotCaptionCoverage',
			category: 'screenshots',
			label: 'Screenshot Captions',
			value: 'None added',
			status: 'unknown',
			findings: [
				"No screenshot captions entered yet. Apple's algorithm now reads caption text as keyword " +
					'metadata alongside your title/subtitle/keyword field — add the captions from your ' +
					'screenshots here to get keyword credit for them and see the checks below.',
			],
		}
	}
	const status = nonEmpty.length >= 3 ? 'good' : 'warning'
	return {
		id: 'screenshotCaptionCoverage',
		category: 'screenshots',
		label: 'Screenshot Captions',
		value: `${nonEmpty.length} caption(s)`,
		status,
		findings:
			nonEmpty.length >= 3
				? [`${nonEmpty.length} captions entered — enough to cover several distinct keyword themes.`]
				: [
						`Only ${nonEmpty.length} caption(s) entered — most listings use 5+ screenshots. Add more ` +
							'to cover more keyword themes.',
					],
	}
}

/** Only called (via buildScreenshotCaptionChecks) once at least one caption has real text — see that function's guard. */
function checkPlacement(nonEmpty: ScreenshotCaption[]): CheckDraft {
	const middlePlaced = nonEmpty.filter((c) => c.position === 'middle')
	const status = middlePlaced.length === 0 ? 'good' : 'warning'
	return {
		id: 'screenshotCaptionPlacement',
		category: 'screenshots',
		label: 'Caption Placement',
		value: `${nonEmpty.length - middlePlaced.length}/${nonEmpty.length} top/bottom`,
		status,
		findings:
			middlePlaced.length === 0
				? ['All captions are placed in the top or bottom band, which the OCR pipeline weighs most.']
				: [
						`${middlePlaced.length} caption(s) placed mid-screenshot — move them to the top or ` +
							'bottom band, which reportedly gets stronger algorithmic weight from OCR/vision ' +
							'extraction constraints.',
					],
	}
}

/**
 * Heuristic "one keyword theme per caption" check: a caption joining
 * multiple ideas with "and"/"&"/a comma-separated list is treated as
 * multi-theme. Deliberately coarse — this can't tell a genuinely focused
 * five-word caption from a run-on one with certainty, so it only flags the
 * clearest case (an explicit conjunction/list joining distinct ideas). Only
 * called (via buildScreenshotCaptionChecks) once at least one caption has
 * real text — see that function's guard.
 */
function checkThemeFocus(nonEmpty: ScreenshotCaption[]): CheckDraft {
	const multiTheme = nonEmpty.filter((c) => {
		// Collapse thousands-separator commas (e.g. "10,000" -> "10000") before
		// testing — a comma sitting directly between two digits is number
		// formatting, not a list joining distinct ideas, and would otherwise
		// false-positive on any caption citing a download/user/rating count
		// (a very common, legitimate caption pattern).
		const text = c.text.trim().replace(/(\d),(\d)/g, '$1$2')
		return /\s(and|&)\s|,/i.test(text)
	})
	const status = multiTheme.length === 0 ? 'good' : 'warning'
	return {
		id: 'screenshotCaptionThemeFocus',
		category: 'screenshots',
		label: 'One Theme Per Caption',
		value: `${nonEmpty.length - multiTheme.length}/${nonEmpty.length} focused`,
		status,
		findings:
			multiTheme.length === 0
				? ['Each caption reads as a single, focused idea — cleaner for OCR extraction and ranking.']
				: [
						`${multiTheme.length} caption(s) appear to combine multiple ideas (joined by "and"/"&"/a ` +
							'list) — a focused caption on one concept extracts and ranks more reliably than a ' +
							'cluttered one: ' +
							multiTheme.map((c) => `"${c.text.trim()}"`).join(', '),
					],
	}
}

/**
 * Flags generic passive phrasing and exact keyword phrases repeated
 * verbatim across more than one caption in the set — repetition across
 * captions doesn't add ranking benefit per the source, unlike repetition
 * across locales (explicitly fine, per policyLint.ts's anti-stuffing check).
 * Only called (via buildScreenshotCaptionChecks) once at least one caption
 * has real text — see that function's guard.
 */
function checkLanguageQuality(nonEmpty: ScreenshotCaption[]): CheckDraft {
	const findings: string[] = []
	let status: 'good' | 'warning' = 'good'

	const passiveHits: string[] = []
	for (const caption of nonEmpty) {
		const normalized = normalizeCaptionText(caption.text)
		for (const phrase of PASSIVE_CAPTION_PHRASES) {
			if (normalized.includes(phrase)) passiveHits.push(`"${caption.text.trim()}" (${phrase})`)
		}
	}
	if (passiveHits.length > 0) {
		status = 'warning'
		findings.push(
			`Generic, non-search-relevant phrasing found: ${passiveHits.join(', ')}. Replace with active, ` +
				'search-relevant keywords real users would type, instead of passive praise like "Easy to Use."'
		)
	}

	const phraseCounts = new Map<string, number>()
	for (const caption of nonEmpty) {
		for (const phrase of ngramPhrases(caption.text, 2, 3)) {
			phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
		}
	}
	const repeated = [...phraseCounts.entries()]
		.filter(([, count]) => count > 1)
		.map(([phrase]) => phrase)
	if (repeated.length > 0) {
		status = 'warning'
		findings.push(
			`Keyword phrase(s) repeated across multiple captions: ${repeated.join(', ')} — repeating the ` +
				'same term across captions wastes a slot without adding ranking benefit; use each caption for a ' +
				'different keyword theme instead.'
		)
	}

	if (findings.length === 0) {
		findings.push('No generic phrasing or cross-caption keyword repetition detected.')
	}

	return {
		id: 'screenshotCaptionLanguage',
		category: 'screenshots',
		label: 'Caption Wording',
		value: passiveHits.length || repeated.length ? 'Issues found' : 'Looks good',
		status,
		findings,
	}
}

/**
 * Contrast/font/size/shadow legibility can't be evaluated from caption text
 * alone — this check is always 'unknown' by design, carrying only the
 * source's guidance as a reminder rather than a real (or fabricated)
 * assessment. See this module's doc comment for why: no vision-LLM path
 * exists in this codebase to actually look at the screenshot image.
 * `manualCheck: true` because this can never resolve from more data (unlike
 * an ordinary 'unknown' — e.g. a brand-new app's ratings — that clears up
 * once real data exists): it's excluded from the score average and Action
 * Centre (`scorableChecks`) so it can't permanently cap the audit score or
 * occupy an action-item slot forever; the UI shows it as a standing
 * "manual review" note instead.
 */
function checkLegibilityReminder(): CheckDraft {
	return {
		id: 'screenshotCaptionLegibility',
		category: 'screenshots',
		label: 'Caption Legibility (manual check)',
		value: 'Not evaluated',
		status: 'unknown',
		manualCheck: true,
		findings: [
			'Not automatically checked (no vision analysis in this tool yet) — review each screenshot ' +
				'yourself for: high contrast between caption text and background, a standard non-thin/' +
				'non-condensed font at a readable size, and minimal shadow/glow/blur behind the text. All of ' +
				'these affect how reliably OCR extraction reads the caption as keyword text.',
		],
	}
}

/**
 * Builds the screenshot-caption audit checks — called by audit.ts's
 * runAudit. When no caption has any text yet, returns just the single
 * coverage check (status 'unknown', nudging the user to add captions)
 * instead of all 5 — mirroring runAudit's own "no live listing" precedent
 * of one placeholder check rather than several degenerate ones. Returning 5
 * 'unknown' checks here would silently drag every app's flat-averaged
 * overall audit score toward `statusToScore('unknown')` (70) purely because
 * this optional feature exists, not because anything about the listing
 * changed, and would flood the Action Centre with near-duplicate nudges
 * (every non-'good' check becomes its own action item there).
 */
export function buildScreenshotCaptionChecks(captions: ScreenshotCaption[]): CheckDraft[] {
	const nonEmpty = captions.filter((c) => c.text.trim())
	const coverage = checkCoverage(nonEmpty)
	if (nonEmpty.length === 0) return [coverage]
	return [
		coverage,
		checkPlacement(nonEmpty),
		checkThemeFocus(nonEmpty),
		checkLanguageQuality(nonEmpty),
		checkLegibilityReminder(),
	]
}
