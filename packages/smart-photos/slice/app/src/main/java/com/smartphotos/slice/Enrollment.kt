package com.smartphotos.slice

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sqrt

enum class Phase { LOADING, READY, COUNTDOWN, ENROLLING, DONE, MATCHING }

/** What is wrong with the current view of the user, in the order it is checked. */
enum class Issue { NONE, NO_FACE, MULTIPLE, TOO_FAR, TOO_CLOSE, DARK, MOVE_LEFT, MOVE_RIGHT, MOVE_UP, MOVE_DOWN, KNOWN_PERSON }

enum class Pose(val title: String, val chip: String) {
    STRAIGHT("Look straight at the screen", "Straight"),
    LEFT("Slowly turn your head LEFT", "Left"),
    RIGHT("Slowly turn your head RIGHT", "Right"),
    UP("Tilt your chin UP", "Chin up"),
    DOWN("Tilt your chin DOWN", "Chin down"),
}

enum class StepState { PENDING, ACTIVE, DONE, SKIPPED }

/** One enrolled person: a name (null until given) and the face embeddings captured in the guided scan. */
class Person(var name: String?, val embs: List<FloatArray>)

/** "mary  ann" -> "Mary Ann": trims, collapses spaces and upper-cases the first letter of every word (the rest is left as typed). Blank -> null. */
fun tidyName(raw: String?): String? =
    raw?.trim()?.split(Regex(" +"))?.filter { it.isNotEmpty() }?.joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }?.takeIf { it.isNotEmpty() }

/**
 * Everything the screen needs to draw one frame of feedback. Directions are in *mirror* terms (what the user sees on the
 * screen): +yaw = nose towards the screen's right, +pitch = chin down. Both are relative to the user's own straight pose.
 */
class Snapshot(
    val phase: Phase,
    val issue: Issue = Issue.NONE,
    val pose: Pose? = null,
    val steps: List<StepState> = emptyList(),
    val face: Face? = null,
    val imgW: Int = 0,
    val imgH: Int = 0,
    val yaw: Float = 0f,
    val pitch: Float = 0f,
    val poseOk: Boolean = false,
    val poseTooFar: Boolean = false,
    val hold: Int = 0,
    val holdNeeded: Int = 3,
    val phaseStartMs: Long = 0,
    val frameMs: Long = 0,
    val capturedAtMs: Long = 0,
    val skippedAtMs: Long = 0,
    val cos: Float = Float.NaN,
    val recognised: Boolean = false,
    val captured: Int = 0,
    val name: String? = null,          // name of the person this face matches (recognition) or already matches (add-person guard)
    val addMode: Boolean = false,      // the running scan is for an additional person
    val peopleCount: Int = 0,
    val savedAtMs: Long = 0,           // when a name was last saved (for the confirmation banner)
    val savedName: String? = null,
)

/**
 * Guided enrolment (5 head poses, auto-capturing) for one or several people, then live recognition against everybody
 * enrolled. Pure logic: no Android classes. Called from the frame worker; the other methods are called from the UI thread.
 */
class EnrollEngine(private val onEvent: (String) -> Unit) {
    companion object {
        const val HOLD_TICKS = 3            // consecutive good frames (~0.5 s apart) needed to capture a pose
        const val SKIP_AFTER_MS = 25_000L   // give up on a non-frontal pose after this long
        const val COUNTDOWN_MS = 3_000L
        const val MATCH_THRESHOLD = 0.363f  // OpenCV's documented SFace cosine threshold
        const val KNOWN_GUARD = 0.50f       // while adding a person, a face this similar to someone enrolled is refused
        const val YAW_MIN = 0.12f; const val YAW_MAX = 0.55f
        const val PITCH_MIN = 0.06f; const val PITCH_MAX = 0.30f
        private val POSES = Pose.values()
        private fun dot(a: FloatArray, b: FloatArray): Float { var s = 0f; for (i in a.indices) s += a[i] * b[i]; return s }
    }

    @Volatile var phase = Phase.LOADING; private set   // read from the UI thread, written on the frame worker
    private val people = ArrayList<Person>()
    private val pending = ArrayList<FloatArray>()   // embeddings of the scan in progress
    private var addMode = false
    private var restored = false
    /** Index (in people) of the person just enrolled, so the app can ask for their name. */
    @Volatile var newIdx = -1; private set
    private var recognisedIdx = -1; private var recognisedAt = 0L
    private var savedAt = 0L; private var savedName: String? = null

    private val steps = Array(POSES.size) { StepState.PENDING }
    private var cur = 0
    private var holdTicks = 0
    private val acc = ArrayList<FloatArray>()
    private var accYaw = 0f; private var accPitch = 0f
    private var neutralYaw = 0f; private var neutralPitch = 0.6f
    private var stepStart = 0L; private var phaseStart = 0L
    private var capturedAt = 0L; private var skippedAt = 0L

    // ------------------------------------------------------------------ UI-thread API

    /** Begin a scan. `add = true` adds another person next to those already enrolled; `false` starts from nobody. */
    @Synchronized fun start(add: Boolean) {
        addMode = add && people.isNotEmpty()
        if (!addMode) people.clear()
        pending.clear(); acc.clear(); steps.fill(StepState.PENDING); cur = 0; holdTicks = 0
        neutralYaw = 0f; neutralPitch = 0.6f; capturedAt = 0; skippedAt = 0; newIdx = -1
        phase = Phase.COUNTDOWN; phaseStart = System.currentTimeMillis(); onEvent("start")
    }

    /** Abandon the scan in progress; everybody already enrolled stays. */
    @Synchronized fun cancel() {
        pending.clear(); acc.clear(); steps.fill(if (people.isEmpty()) StepState.PENDING else StepState.DONE); addMode = false
        phase = if (people.isEmpty()) Phase.READY else Phase.MATCHING; phaseStart = System.currentTimeMillis(); onEvent("cancel")
    }

    /** Forget everybody. */
    @Synchronized fun startOver() {
        people.clear(); pending.clear(); acc.clear(); steps.fill(StepState.PENDING); cur = 0; holdTicks = 0; addMode = false
        recognisedIdx = -1; newIdx = -1; phase = Phase.READY; phaseStart = System.currentTimeMillis(); onEvent("reset")
    }

    @Synchronized fun restore(list: List<Person>) {
        if (list.isEmpty()) return
        people.clear(); people.addAll(list); restored = true; steps.fill(StepState.DONE)
    }

    @Synchronized fun export(): List<Person> = people.map { Person(it.name, it.embs.map { e -> e.copyOf() }) }

    @Synchronized fun nameOf(idx: Int): String? = people.getOrNull(idx)?.name

    @Synchronized fun peopleLines(): List<String> =
        if (people.isEmpty()) listOf("Nobody enrolled yet") else people.mapIndexed { i, p -> "${i + 1}. ${p.name ?: "(no name yet)"}" }

    /** Name a specific person (e.g. the one just enrolled). */
    @Synchronized fun rename(idx: Int, n: String?) {
        val p = people.getOrNull(idx) ?: return
        val tidy = tidyName(n) ?: return          // a blank entry keeps the current name instead of erasing it
        p.name = tidy
        savedAt = System.currentTimeMillis(); savedName = tidy; onEvent("name")
    }

    /** Index of the person the camera recognised within the last 2 s (and not contradicted by an unknown face since), or -1. */
    @Synchronized fun recognisedNow(): Int = if (recognisedIdx >= 0 && System.currentTimeMillis() - recognisedAt < 2000) recognisedIdx else -1

    /** Cosine statistics from the saved templates themselves: same-person pairs vs different-person pairs. */
    @Synchronized fun separationReport(): String {
        val within = ArrayList<Float>(); val cross = ArrayList<Float>()
        for (a in people.indices) for (b in a until people.size)
            for (i in people[a].embs.indices) for (j in people[b].embs.indices) {
                if (a == b && j <= i) continue
                (if (a == b) within else cross).add(dot(people[a].embs[i], people[b].embs[j]))
            }
        fun f(l: List<Float>) = if (l.isEmpty()) "n=0" else "n=%d mean=%.2f min=%.2f max=%.2f".format(l.size, l.average(), l.min(), l.max())
        return "SEPARATION people=${people.size} same-person pairs: ${f(within)} | different-person pairs: ${f(cross)}"
    }

    // ------------------------------------------------------------------ analysis

    /** Head pose from the 5 landmarks: (yaw in mirror terms, nose-position ratio between eyes and mouth). */
    private fun poseOf(f: Face): Pair<Float, Float> {
        val l = f.lm
        val ex = (l[0] + l[2]) / 2; val ey = (l[1] + l[3]) / 2
        val eyeD = hypot(l[2] - l[0], l[3] - l[1]).let { if (it < 1f) 1f else it }
        val my = (l[7] + l[9]) / 2
        val span = (my - ey).let { if (it < 1f) 1f else it }
        return Pair(-(l[4] - ex) / eyeD, (l[5] - ey) / span)
    }

    private fun quality(faces: List<Face>, face: Face?, w: Int, h: Int, luma: Float): Issue {
        if (face == null) return Issue.NO_FACE
        if (faces.size > 1 && faces[1].w > face.w * 0.5f) return Issue.MULTIPLE
        val frac = face.w / w
        if (frac < 0.10f) return Issue.TOO_FAR
        if (frac > 0.55f) return Issue.TOO_CLOSE
        if (luma < 50f) return Issue.DARK
        val sx = 1f - (face.x + face.w / 2) / w     // position on the mirrored screen
        val cy = (face.y + face.h / 2) / h
        if (sx > 0.70f) return Issue.MOVE_LEFT      // appears on the right of the screen -> user moves to their left
        if (sx < 0.30f) return Issue.MOVE_RIGHT
        if (cy < 0.22f) return Issue.MOVE_DOWN
        if (cy > 0.78f) return Issue.MOVE_UP
        return Issue.NONE
    }

    /** (index of the best-matching person, best cosine) over everybody enrolled. */
    private fun bestMatch(emb: FloatArray): Pair<Int, Float> {
        var bi = -1; var bc = -1f
        for ((i, p) in people.withIndex()) for (e in p.embs) { val c = dot(e, emb); if (c > bc) { bc = c; bi = i } }
        return Pair(bi, bc)
    }

    @Synchronized fun onFrame(faces: List<Face>, w: Int, h: Int, luma: Float, emb: FloatArray?): Snapshot {
        val now = System.currentTimeMillis()
        if (phase == Phase.LOADING) { phase = if (restored && people.isNotEmpty()) Phase.MATCHING else Phase.READY; phaseStart = now }
        val face = faces.maxByOrNull { it.w }
        var issue = quality(faces, face, w, h, luma)
        if (phase == Phase.MATCHING && issue.name.startsWith("MOVE")) issue = Issue.NONE
        var matchName: String? = null
        // adding a person: refuse a face that is already enrolled
        if (addMode && (phase == Phase.COUNTDOWN || phase == Phase.ENROLLING) && issue == Issue.NONE && emb != null && people.isNotEmpty()) {
            val (bi, bc) = bestMatch(emb)
            if (bc >= KNOWN_GUARD) { issue = Issue.KNOWN_PERSON; matchName = people[bi].name }
        }
        var rawYaw = 0f; var rawP = 0.6f
        if (face != null) { val (a, b) = poseOf(face); rawYaw = a; rawP = b }
        val yaw = rawYaw - neutralYaw; val pitch = rawP - neutralPitch
        var ok = false; var far = false; var cos = Float.NaN; var rec = false

        when (phase) {
            Phase.COUNTDOWN -> if (now - phaseStart >= COUNTDOWN_MS) { phase = Phase.ENROLLING; phaseStart = now; stepStart = now; steps[0] = StepState.ACTIVE; onEvent("go") }
            Phase.ENROLLING -> {
                val pose = POSES[cur]
                if (face != null && issue == Issue.NONE) {
                    when (pose) {
                        Pose.STRAIGHT -> ok = abs(rawYaw) < YAW_MIN
                        Pose.LEFT -> { ok = yaw <= -YAW_MIN && yaw >= -YAW_MAX; far = yaw < -YAW_MAX }
                        Pose.RIGHT -> { ok = yaw >= YAW_MIN && yaw <= YAW_MAX; far = yaw > YAW_MAX }
                        Pose.UP -> { ok = pitch <= -PITCH_MIN && pitch >= -PITCH_MAX; far = pitch < -PITCH_MAX }
                        Pose.DOWN -> { ok = pitch >= PITCH_MIN && pitch <= PITCH_MAX; far = pitch > PITCH_MAX }
                    }
                }
                if (ok && emb != null) {
                    if (holdTicks == 0) { accYaw = 0f; accPitch = 0f }
                    acc.add(emb); accYaw += rawYaw; accPitch += rawP; holdTicks++
                } else { holdTicks = 0; acc.clear() }
                if (holdTicks >= HOLD_TICKS) capture()
                else if (pose != Pose.STRAIGHT && now - stepStart > SKIP_AFTER_MS) skip(now)
            }
            Phase.DONE -> if (now - phaseStart > 3_500) { phase = Phase.MATCHING; phaseStart = now; addMode = false }
            Phase.MATCHING -> if (face != null && emb != null && issue == Issue.NONE && people.isNotEmpty()) {
                val (bi, bc) = bestMatch(emb)
                cos = bc; rec = bc >= MATCH_THRESHOLD
                if (rec) { recognisedIdx = bi; recognisedAt = now; matchName = people[bi].name }
                else recognisedIdx = -1               // an unknown face is in front: never rename the previous person by mistake
            }
            else -> {}
        }
        val pose = if (phase == Phase.ENROLLING) POSES[cur.coerceAtMost(POSES.size - 1)] else null
        return Snapshot(
            phase, issue, pose, steps.toList(), face, w, h, yaw, pitch, ok, far, holdTicks, HOLD_TICKS, phaseStart, now,
            capturedAt, skippedAt, cos, rec, steps.count { it == StepState.DONE }, matchName, addMode, people.size, savedAt, savedName,
        )
    }

    private fun capture() {
        val mean = FloatArray(acc[0].size)
        for (e in acc) for (i in mean.indices) mean[i] += e[i]
        var n = 0f; for (v in mean) n += v * v
        n = sqrt(n); for (i in mean.indices) mean[i] /= n
        pending.add(mean)
        if (cur == 0) { neutralYaw = accYaw / acc.size; neutralPitch = accPitch / acc.size }
        steps[cur] = StepState.DONE; capturedAt = System.currentTimeMillis()
        advance(); onEvent(if (phase == Phase.DONE) "done" else "capture")
    }

    private fun skip(now: Long) {
        steps[cur] = StepState.SKIPPED; skippedAt = now
        advance(); onEvent(if (phase == Phase.DONE) "done" else "skip")
    }

    private fun advance() {
        cur++; holdTicks = 0; acc.clear()
        if (cur >= POSES.size) {
            phase = Phase.DONE; phaseStart = System.currentTimeMillis()
            people.add(Person(null, ArrayList(pending))); newIdx = people.lastIndex; pending.clear()
        } else { steps[cur] = StepState.ACTIVE; stepStart = System.currentTimeMillis() }
    }
}
