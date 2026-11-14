import type { MemoryEntry, ProfileHeader } from '../../types'

/**
 * ProfileClassifier - T0 heuristic classification of durable facts into one of
 * GuideAxon's three fixed Profile headers (designCognitiveBrain.md §17.2.2).
 *
 * Unlike §17.2.8's configurable topic buckets, these three headers are fixed
 * and closed - they're not topics the user talks about, they're the specific
 * things answering behavior depends on (§17.2.4). Only `isDurable` entries are
 * classified; episodic/session-scoped content never reaches this classifier
 * (see ProfileClassificationProcessor.shouldProcess()).
 *
 * The winning header is written as a tag (`profile:<header>`), not a bare
 * metadata field, so it's queryable via the existing IMemoryService.list()
 * MemoryFilter.tags path rather than needing a new filter dimension - the same
 * "reuse tags" choice §17.2.8 makes for buckets.
 */

// Roles and positions, for "I'm a VP of Sales", "I am the head of data", "I'm a nurse", "I'm CEO of a startup". A bare "I'm ..." is
// not enough ("I'm tired"), and a role word anywhere later in the sentence is too much ("I'm at the doctor", "I'm so glad to lead
// the way", "I'm a fan of the director's cut"). So the role word must follow "I'm" directly, or an article and at most two plain
// words (an adjective or a noun: "a senior software engineer"), and no preposition may bridge the gap, so "a fan OF the director"
// does not reach "director". The same gap rule is used for "I lead / manage / run ... <team word>".
const GAP_WORD = String.raw`(?!(?:of|at|in|on|to|for|with|from|about|by|into|over|under|as|the|a|an)\b)[a-z0-9-]+`
const ROLE_WORDS =
	'manager|director|vp|vice president|head of|lead|engineer|developer|designer|founder|co-?founder|ceo|cto|cfo|coo|cpo|chief|officer|' +
	'executive|president|owner|partner|consultant|analyst|architect|scientist|researcher|teacher|professor|student|nurse|doctor|lawyer|' +
	'accountant|recruiter|marketer|writer|producer|principal|supervisor|administrator|specialist'

const LIFE_CONTEXT_PATTERNS: RegExp[] = [
	/\bi\s+(work|live|study)\s+(at|in|for)\b/i,
	/\bi\s+(?:work|worked|serve|serving)\s+as\b/i,
	/\bmy\s+(job|career|family|partner|spouse|kids?|children|role|team|company|title|position|department|business|startup|organi[sz]ation|employer|clients?|manager|boss)\b/i,
	// "I'm a / an / the [up to two words] <role>"
	new RegExp(
		String.raw`\bi\s*(?:'m|am)\s+(?:currently\s+|now\s+|also\s+|still\s+)?(?:an?|the)\s+(?:${GAP_WORD}\s+){0,2}(?:${ROLE_WORDS})\b`,
		'i'
	),
	// "I'm <role>" with no article: "I'm CEO of a startup", "I am VP of Engineering"
	new RegExp(
		String.raw`\bi\s*(?:'m|am)\s+(?:currently\s+|now\s+|also\s+|still\s+)?(?:${ROLE_WORDS})\b`,
		'i'
	),
	// "I lead / manage / run ... <team word>": "I lead 40 people", "I manage a sales organization"; not "I run every morning with the team"
	new RegExp(
		String.raw`\bi\s+(?:lead|manage|run|head|oversee|supervise|own|founded|co-?founded)\s+(?:an?\s+|the\s+|our\s+)?(?:${GAP_WORD}\s+){0,3}(?:team|teams|people|engineers|staff|org|organi[sz]ation|department|company|business|startup|group|division|function|reports)\b`,
		'i'
	),
	/\b(moved to|relocated|started (a|my) job|new role)\b/i,
]

const AUTONOMY_PATTERNS: RegExp[] = [
	/\b(always|never)\s+(ask|confirm|check with me)\b/i,
	/\b(don't|do not|no need to)\s+ask\b/i,
	/\b(go ahead and|feel free to|you can just)\b.*\bwithout asking\b/i,
	/\bask (me )?before\b/i,
]

const COMMUNICATION_STYLE_PATTERNS: RegExp[] = [
	/\bi\s+prefer\b.*\b(brief|concise|detailed|formal|casual|direct|short|long)\b/i,
	/\bkeep (it|responses?|answers?)\s+(brief|short|concise)\b/i,
	/\bbe more\s+(formal|casual|direct|concise|detailed)\b/i,
	/\b(don't|do not)\s+(use|be)\s+(jargon|too formal|too casual)\b/i,
]

/** All three fixed headers, in the stable display order used everywhere a
 *  Profile is assembled or rendered (§17.2.2). */
export const ALL_PROFILE_HEADERS: ProfileHeader[] = [
	'life_context',
	'autonomy',
	'communication_style',
]

const HEADER_PATTERNS: { header: ProfileHeader; patterns: RegExp[] }[] = [
	{ header: 'autonomy', patterns: AUTONOMY_PATTERNS },
	{ header: 'communication_style', patterns: COMMUNICATION_STYLE_PATTERNS },
	{ header: 'life_context', patterns: LIFE_CONTEXT_PATTERNS },
]

const TURN_USER_PREFIX = 'User: '
const TURN_ASSISTANT_MARKER = '\nAssistant: '

/**
 * What the USER said, for an entry that is a stored chat turn. A turn's content is "User: ...\nAssistant: ...", and the
 * assistant half is not a statement about the user: a reply that says "my team" or "I am happy to help" must neither
 * classify a turn into the profile nor end up as profile text. Read out of the content (storeTurnEpisode's format), so nothing
 * is stored twice and turns stored before this existed are read the same way. Any other entry (a fact, a correction) is its
 * own statement.
 */
export function statementOf(entry: Pick<MemoryEntry, 'content'>): string {
	const content = entry.content ?? ''
	if (!content.startsWith(TURN_USER_PREFIX)) return content
	const end = content.indexOf(TURN_ASSISTANT_MARKER)
	return end > 0 ? content.slice(TURN_USER_PREFIX.length, end) : content
}

/**
 * T0 keyword classification. Checked in a fixed priority order (autonomy,
 * communication_style, then life_context) since autonomy/communication-style
 * phrasing is more specific and life_context patterns are broad enough to
 * otherwise shadow them (e.g. "my team" inside an autonomy sentence).
 */
export function classifyForProfile(
	entry: Pick<MemoryEntry, 'content'> & { title?: string }
): ProfileHeader | null {
	const text = `${entry.title ?? ''} ${statementOf(entry)}`
	for (const { header, patterns } of HEADER_PATTERNS) {
		if (patterns.some((p) => p.test(text))) return header
	}
	return null
}

export function profileTag(header: ProfileHeader): string {
	return `profile:${header}`
}

/** Appends the `profile:<header>` tag in place. Idempotent. */
export function applyProfileHeader(entry: MemoryEntry, header: ProfileHeader): void {
	const tag = profileTag(header)
	const tags = entry.tags ?? []
	if (!tags.includes(tag)) entry.tags = [...tags, tag]
}

/**
 * Classifies a durable entry and appends the corresponding `profile:<header>`
 * tag in place, if any header matched. Idempotent - safe to call more than once.
 */
export function applyProfileClassification(entry: MemoryEntry): ProfileHeader | null {
	const header = classifyForProfile(entry)
	if (!header) return null
	applyProfileHeader(entry, header)
	return header
}

/**
 * Marks a durable entry the patterns did not place. It is a tag so the maintenance pass can find these with the ordinary tag
 * filter; it deliberately does not start with `profile:`, so such an entry does not count as a profile fact until a model has
 * placed it (and the tag is removed then, whatever the answer).
 */
export const PROFILE_PENDING_TAG = 'profile-pending'

/**
 * A pending entry the model was asked about while its gate was in shadow mode (recorded, never applied). It is not lost and no try
 * is counted: it waits under this tag, and one probe per pass notices when the gate goes live and classifies it then. Like the
 * pending tag it does not start with `profile:`, so it is not a profile fact.
 */
export const PROFILE_SHADOWED_TAG = 'profile-shadowed'

/**
 * Bumped when the patterns change enough that earlier decisions should be redone. Each entry the classifier has handled
 * carries it in `metadata.profileClassifierVersion` (none = classified by version 1, the original patterns), and
 * MemoryService.backfillProfileClassification() re-checks durable entries with a lower number. 2: roles and positions, the
 * user's words only, the pending tag.
 */
export const PROFILE_CLASSIFIER_VERSION = 2

/** True for an entry the profile classifier accepted: it backs a Profile section, so it is one of the user's lasting facts. */
export const isProfileFact = (entry: Pick<MemoryEntry, 'tags'>): boolean =>
	(entry.tags ?? []).some((t) => t.startsWith('profile:'))
