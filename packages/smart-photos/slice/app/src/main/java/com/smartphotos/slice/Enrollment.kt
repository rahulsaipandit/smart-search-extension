package com.smartphotos.slice

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sqrt

enum class Phase { LOADING, READY, COUNTDOWN, ENROLLING, DONE, MATCHING }

/** What is wrong with the current view of the user, in the order it is checked. */
enum class Issue { NONE, NO_FACE, MULTIPLE, TOO_FAR, TOO_CLOSE, DARK, MOVE_LEFT, MOVE_RIGHT, MOVE_UP, MOVE_DOWN }

enum class Pose(val title: String, val chip: String) {
    STRAIGHT("Look straight at the screen", "Straight"),
    LEFT("Slowly turn your head LEFT", "Left"),
    RIGHT("Slowly turn your head RIGHT", "Right"),
    UP("Tilt your chin UP", "Chin up"),
    DOWN("Tilt your chin DOWN", "Chin down"),
}

enum class StepState { PENDING, ACTIVE, DONE, SKIPPED }

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
    val name: String? = null,
)

/**
 * Guided enrolment (5 head poses, auto-capturing) followed by a live recognition test. Pure logic: no Android classes, so it
 * can be reasoned about on its own. Called from the frame worker; [start]/[reset]/[label] are called from the UI thread.
 */
class EnrollEngine(private val onEvent: (String) -> Unit) {
    companion object {
        const val HOLD_TICKS = 3            // consecutive good frames (~0.5 s apart) needed to capture a pose
        const val SKIP_AFTER_MS = 25_000L   // give up on a non-frontal pose after this long
        const val COUNTDOWN_MS = 3_000L
        const val MATCH_THRESHOLD = 0.363f  // OpenCV's documented SFace cosine threshold
        const val YAW_MIN = 0.12f; const val YAW_MAX = 0.55f
        const val PITCH_MIN = 0.06f; const val PITCH_MAX = 0.30f
        private val POSES = Pose.values()
    }

    var phase = Phase.LOADING; private set
    val enrolled = ArrayList<FloatArray>()
    val same = ArrayList<Float>(); val other = ArrayList<Float>()
    @Volatile var name: String? = null
    private var restored = false
    @Volatile var label = "none"   // none | same | other  (which group a live match sample is recorded into)

    private val steps = Array(POSES.size) { StepState.PENDING }
    private var cur = 0
    private var holdTicks = 0
    private val acc = ArrayList<FloatArray>()
    private var accYaw = 0f; private var accPitch = 0f
    private var neutralYaw = 0f; private var neutralPitch = 0.6f
    private var stepStart = 0L; private var phaseStart = 0L
    private var capturedAt = 0L; private var skippedAt = 0L

    @Synchronized fun start() {
        enrolled.clear(); acc.clear(); steps.fill(StepState.PENDING); cur = 0; holdTicks = 0
        neutralYaw = 0f; neutralPitch = 0.6f; capturedAt = 0; skippedAt = 0
        phase = Phase.COUNTDOWN; phaseStart = System.currentTimeMillis(); onEvent("start")
    }

    /** Loads a previously saved enrolment: the next frame goes straight to recognition. */
    @Synchronized fun restore(embs: List<FloatArray>, savedName: String?) {
        if (embs.isEmpty()) return
        enrolled.clear(); enrolled.addAll(embs); name = savedName; restored = true
        steps.fill(StepState.DONE)
    }

    @Synchronized fun exportEnrolled(): List<FloatArray> = enrolled.map { it.copyOf() }

    fun rename(n: String?) { name = n?.trim()?.takeIf { it.isNotEmpty() }; onEvent("name") }

    /** Back to the ready screen; keeps nothing. */
    @Synchronized fun reset() {
        enrolled.clear(); acc.clear(); steps.fill(StepState.PENDING); cur = 0; holdTicks = 0
        same.clear(); other.clear(); label = "none"
        phase = Phase.READY; phaseStart = System.currentTimeMillis(); onEvent("reset")
    }

    @Synchronized fun statsLines(): List<String> {
        fun f(l: List<Float>, mx: Boolean) = if (l.isEmpty()) "n=0" else "n=%d  mean %.2f  %s %.2f".format(l.size, l.average(), if (mx) "max" else "min", if (mx) l.max() else l.min())
        return listOf("Name: ${name ?: "(not set)"}", "Poses captured: ${enrolled.size} of ${POSES.size}", "Me:      ${f(same, false)}", "Others:  ${f(other, true)}", "Same person if score >= %.2f".format(MATCH_THRESHOLD))
    }

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

    @Synchronized fun onFrame(faces: List<Face>, w: Int, h: Int, luma: Float, emb: FloatArray?): Snapshot {
        val now = System.currentTimeMillis()
        if (phase == Phase.LOADING) { phase = if (restored && enrolled.isNotEmpty()) Phase.MATCHING else Phase.READY; phaseStart = now }
        val face = faces.maxByOrNull { it.w }
        var issue = quality(faces, face, w, h, luma)
        if (phase == Phase.MATCHING && issue.name.startsWith("MOVE")) issue = Issue.NONE
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
            Phase.DONE -> if (now - phaseStart > 3_500) { phase = Phase.MATCHING; phaseStart = now }
            Phase.MATCHING -> if (face != null && emb != null && issue == Issue.NONE && enrolled.isNotEmpty()) {
                cos = enrolled.maxOf { e -> var s = 0f; for (i in e.indices) s += e[i] * emb[i]; s }
                rec = cos >= MATCH_THRESHOLD
                when (label) { "same" -> same.add(cos); "other" -> other.add(cos) }
            }
            else -> {}
        }
        val pose = if (phase == Phase.ENROLLING) POSES[cur.coerceAtMost(POSES.size - 1)] else null
        return Snapshot(
            phase, issue, pose, steps.toList(), face, w, h, yaw, pitch, ok, far, holdTicks, HOLD_TICKS, phaseStart, now,
            capturedAt, skippedAt, cos, rec, enrolled.size, name,
        )
    }

    private fun capture() {
        val mean = FloatArray(acc[0].size)
        for (e in acc) for (i in mean.indices) mean[i] += e[i]
        var n = 0f; for (v in mean) n += v * v
        n = sqrt(n); for (i in mean.indices) mean[i] /= n
        enrolled.add(mean)
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
        if (cur >= POSES.size) { phase = Phase.DONE; phaseStart = System.currentTimeMillis() }
        else { steps[cur] = StepState.ACTIVE; stepStart = System.currentTimeMillis() }
    }
}
