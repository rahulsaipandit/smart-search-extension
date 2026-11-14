package com.smartphotos.slice

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.sin

/**
 * Full-screen feedback layer: a big coloured banner (what to do / what is wrong), the mirrored camera preview underneath
 * (a TextureView placed in [prect]) with a face box, arrows, meters and a progress ring on top, a step list / result panel,
 * and a voice strip. Built to be read from about 1 m. Works in landscape and portrait; layout is recomputed on every size change.
 */
class GuideView(ctx: Context) : View(ctx) {
    @Volatile var snap: Snapshot? = null
    @Volatile var preview: android.graphics.Bitmap? = null
    private val ir = Rect()   // where the picture really is inside prect (fit-centred)
    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    @Volatile var loadMsg = "Starting…"
    @Volatile var fatal: String? = null
    // Guided voice prompt: stays on one command until the recogniser hears exactly that phrase.
    @Volatile var cmdIndex = 0
    @Volatile private var matchedAt = 0L; @Volatile private var matchedCmd = ""
    @Volatile private var wrongText = ""; @Volatile private var wrongAt = 0L

    /** Called with each final recogniser result. Returns the command that was just completed, or null. */
    @Synchronized fun onHeard(raw: String): String? {
        val clean = raw.replace("[unk]", " ").trim().replace(Regex("[ ]+"), " ")
        if (clean.isEmpty() || cmdIndex >= COMMANDS.size) return null
        val target = COMMANDS[cmdIndex]
        val now = System.currentTimeMillis()
        if (" $clean ".contains(" $target ")) { matchedCmd = target; matchedAt = now; cmdIndex++; return target }
        wrongText = clean; wrongAt = now
        return null
    }
    @Volatile var micLevel = 0.0
    @Volatile var stats: List<String> = emptyList()
    @Volatile var diag = ""
    @Volatile var label = "none"
    /** (preview rect, button area, buttons laid out horizontally?) - called on the UI thread whenever the layout changes. */
    var onLayoutRects: ((Rect, Rect, Boolean) -> Unit)? = null

    val prect = Rect(); val btnRect = Rect()
    private val panel = Rect(); private val bannerR = Rect(); private val stripR = Rect()
    private var landscape = true
    private var u = 1f
    private var smoothMic = 0f

    private companion object {
        const val BG = 0xFF101418.toInt(); const val STRIP = 0xFF0B0E11.toInt()
        const val GREEN = 0xFF1FA85A.toInt(); const val AMBER = 0xFFE59A12.toInt(); const val RED = 0xFFD93A3F.toInt()
        const val BLUE = 0xFF2563EB.toInt(); const val GREY = 0xFF3B4650.toInt(); const val DIM = 0xFF8A97A3.toInt()
        const val WHITE = 0xFFFFFFFF.toInt()
    }

    private enum class Icon { NONE, CHECK, CROSS, WARN, FACE, ARROW_L, ARROW_R, ARROW_U, ARROW_D }
    private class Banner(val color: Int, val title: String, val sub: String, val icon: Icon)

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD); color = WHITE }
    private val path = Path()

    override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
        if (e.action == android.view.MotionEvent.ACTION_DOWN && stripR.contains(e.x.toInt(), e.y.toInt())) { synchronized(this) { cmdIndex = (cmdIndex + 1).coerceAtMost(COMMANDS.size) }; return true }   // tap the strip to skip a command
        return super.onTouchEvent(e)
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        landscape = w >= h
        u = min(w, h) / 1000f
        val strip = if (landscape) (0.07f * h).toInt() else (0.05f * h).toInt()
        val banner = if (landscape) (0.14f * h).toInt() else (0.105f * h).toInt()
        bannerR.set(0, 0, w, banner); stripR.set(0, h - strip, w, h)
        val gap = (0.015f * min(w, h)).toInt()
        val btnH = (0.085f * min(w, h)).toInt()
        if (landscape) {
            val availH = h - banner - strip - 2 * gap
            val pw = min(availH * 4 / 3, (0.64f * w).toInt()); val ph = pw * 3 / 4
            val left = gap; val top = banner + gap + (availH - ph) / 2
            prect.set(left, top, left + pw, top + ph)
            panel.set(prect.right + gap, banner + gap, w - gap, h - strip - gap)
            btnRect.set(panel.left, panel.bottom - (4 * btnH + 3 * gap), panel.right, panel.bottom)
        } else {
            var ph = min((0.50f * h).toInt(), w * 4 / 3); var pw = ph * 3 / 4
            if (pw > w - 2 * gap) { pw = w - 2 * gap; ph = pw * 4 / 3 }
            val left = (w - pw) / 2; val top = banner + gap
            prect.set(left, top, left + pw, top + ph)
            panel.set(gap, prect.bottom + gap, w - gap, h - strip - gap)
            btnRect.set(panel.left, panel.bottom - btnH, panel.right, panel.bottom)
        }
        onLayoutRects?.invoke(Rect(prect), Rect(btnRect), !landscape)
    }

    // ---------------------------------------------------------------- helpers

    private fun fit(p: Paint, s: String, base: Float, maxW: Float) { p.textSize = base; val m = p.measureText(s); if (m > maxW) p.textSize = base * maxW / m }

    private fun pulse(now: Long) = (0.5 + 0.5 * sin(now / 220.0)).toFloat()

    private fun drawIcon(c: Canvas, icon: Icon, cx: Float, cy: Float, r: Float, bg: Int) {
        line.color = WHITE; line.strokeWidth = r * 0.26f; fill.color = WHITE
        when (icon) {
            Icon.NONE -> {}
            Icon.CHECK -> { path.reset(); path.moveTo(cx - 0.6f * r, cy + 0.05f * r); path.lineTo(cx - 0.15f * r, cy + 0.5f * r); path.lineTo(cx + 0.65f * r, cy - 0.45f * r); c.drawPath(path, line) }
            Icon.CROSS -> { c.drawLine(cx - 0.55f * r, cy - 0.55f * r, cx + 0.55f * r, cy + 0.55f * r, line); c.drawLine(cx + 0.55f * r, cy - 0.55f * r, cx - 0.55f * r, cy + 0.55f * r, line) }
            Icon.WARN -> {
                path.reset(); path.moveTo(cx, cy - 0.8f * r); path.lineTo(cx + 0.85f * r, cy + 0.65f * r); path.lineTo(cx - 0.85f * r, cy + 0.65f * r); path.close(); c.drawPath(path, fill)
                fill.color = bg; c.drawRect(cx - 0.07f * r, cy - 0.3f * r, cx + 0.07f * r, cy + 0.25f * r, fill); c.drawCircle(cx, cy + 0.45f * r, 0.09f * r, fill); fill.color = WHITE
            }
            Icon.FACE -> {
                line.strokeWidth = r * 0.16f; c.drawCircle(cx, cy, 0.75f * r, line)
                c.drawCircle(cx - 0.27f * r, cy - 0.15f * r, 0.08f * r, fill); c.drawCircle(cx + 0.27f * r, cy - 0.15f * r, 0.08f * r, fill)
                path.reset(); path.moveTo(cx - 0.3f * r, cy + 0.28f * r); path.quadTo(cx, cy + 0.5f * r, cx + 0.3f * r, cy + 0.28f * r); c.drawPath(path, line)
            }
            Icon.ARROW_L -> arrow(c, cx, cy, r, 180f)
            Icon.ARROW_R -> arrow(c, cx, cy, r, 0f)
            Icon.ARROW_U -> arrow(c, cx, cy, r, -90f)
            Icon.ARROW_D -> arrow(c, cx, cy, r, 90f)
        }
    }

    private fun arrow(c: Canvas, cx: Float, cy: Float, r: Float, deg: Float) {
        c.save(); c.translate(cx, cy); c.rotate(deg)
        path.reset(); path.moveTo(-0.8f * r, -0.28f * r); path.lineTo(0.05f * r, -0.28f * r); path.lineTo(0.05f * r, -0.7f * r); path.lineTo(0.85f * r, 0f)
        path.lineTo(0.05f * r, 0.7f * r); path.lineTo(0.05f * r, 0.28f * r); path.lineTo(-0.8f * r, 0.28f * r); path.close()
        fill.color = WHITE; c.drawPath(path, fill); c.restore()
    }

    // ---------------------------------------------------------------- banner content

    private fun issueBanner(i: Issue): Banner = when (i) {
        Issue.NO_FACE -> Banner(RED, "I can't see your face", "Look at the screen and step into view", Icon.CROSS)
        Issue.MULTIPLE -> Banner(AMBER, "More than one person", "Only one person in view, please", Icon.WARN)
        Issue.TOO_FAR -> Banner(AMBER, "Come closer", "Your face is too small - move towards the screen", Icon.WARN)
        Issue.TOO_CLOSE -> Banner(AMBER, "Move back a little", "You are too close to the camera", Icon.WARN)
        Issue.DARK -> Banner(AMBER, "Too dark", "Turn on a light or face a window", Icon.WARN)
        Issue.MOVE_LEFT -> Banner(AMBER, "Move to your left", "You are off-centre", Icon.ARROW_L)
        Issue.MOVE_RIGHT -> Banner(AMBER, "Move to your right", "You are off-centre", Icon.ARROW_R)
        Issue.MOVE_UP -> Banner(AMBER, "Move up / raise the tablet", "Your face is too low in the picture", Icon.ARROW_U)
        Issue.MOVE_DOWN -> Banner(AMBER, "Move down / lower the tablet", "Your face is too high in the picture", Icon.ARROW_D)
        Issue.NONE -> Banner(BLUE, "", "", Icon.NONE)
    }

    private fun poseIcon(p: Pose) = when (p) { Pose.STRAIGHT -> Icon.FACE; Pose.LEFT -> Icon.ARROW_L; Pose.RIGHT -> Icon.ARROW_R; Pose.UP -> Icon.ARROW_U; Pose.DOWN -> Icon.ARROW_D }

    private fun banner(s: Snapshot?, now: Long, stale: Boolean): Banner {
        fatal?.let { return Banner(RED, "Problem", it, Icon.CROSS) }
        if (s == null || s.phase == Phase.LOADING) return Banner(GREY, "Starting…", loadMsg, Icon.FACE)
        if (stale) return Banner(RED, "No camera image", "The camera stopped sending pictures", Icon.CROSS)
        val ib = issueBanner(s.issue)
        return when (s.phase) {
            Phase.READY -> if (s.issue != Issue.NONE) ib else Banner(GREEN, "You're in view", "Press START when you are ready", Icon.CHECK)
            Phase.COUNTDOWN -> Banner(BLUE, "Scan starts in ${(3 - (now - s.phaseStartMs) / 1000).coerceIn(1, 3)}", "Look straight at the screen and hold still", Icon.FACE)
            Phase.ENROLLING -> {
                val pose = s.pose!!
                val step = s.steps.indexOf(StepState.ACTIVE).coerceAtLeast(0) + 1
                when {
                    now - s.capturedAtMs < 1200 -> Banner(GREEN, "Got it!", "Next: ${pose.chip}", Icon.CHECK)
                    now - s.skippedAtMs < 1500 -> Banner(AMBER, "Skipped that angle", "Next: ${pose.chip}", Icon.WARN)
                    s.issue != Issue.NONE -> Banner(ib.color, ib.title, ib.sub + " (paused)", ib.icon)
                    s.hold > 0 -> Banner(GREEN, "Hold still - scanning…", "Step $step of 5: ${pose.chip}", Icon.FACE)
                    s.poseTooFar -> Banner(AMBER, "Not so far", "Come back a little towards the centre", Icon.WARN)
                    else -> Banner(BLUE, pose.title, "Step $step of 5", poseIcon(pose))
                }
            }
            Phase.DONE -> Banner(GREEN, "Face enrolled", "${s.captured} of 5 angles captured", Icon.CHECK)
            Phase.MATCHING -> when {
                s.issue != Issue.NONE -> if (s.issue == Issue.NO_FACE) Banner(GREY, "Waiting for a face", "Step in front of the camera", Icon.FACE) else ib
                s.recognised && s.name != null -> Banner(GREEN, "Hello, ${s.name}!", "Face recognized  -  score %.2f".format(s.cos), Icon.CHECK)
                s.recognised -> Banner(GREEN, "Face recognized", "What do I call you?  Tap NAME, or say \"this is …\"", Icon.CHECK)
                !s.cos.isNaN() -> Banner(RED, "Unknown person", "score %.2f (needs %.2f)".format(s.cos, EnrollEngine.MATCH_THRESHOLD), Icon.CROSS)
                else -> Banner(GREY, "Checking…", "", Icon.FACE)
            }
            else -> ib
        }
    }

    // ---------------------------------------------------------------- drawing

    override fun onDraw(c: Canvas) {
        val now = System.currentTimeMillis()
        val s = snap
        val stale = s != null && s.phase != Phase.LOADING && now - s.frameMs > 3000
        c.drawColor(BG)
        val bmp = preview
        ir.set(prect)
        if (bmp != null) {
            val sc = min(prect.width() / bmp.width.toFloat(), prect.height() / bmp.height.toFloat())
            val dw = (bmp.width * sc).toInt(); val dh = (bmp.height * sc).toInt()
            ir.set(prect.centerX() - dw / 2, prect.centerY() - dh / 2, prect.centerX() - dw / 2 + dw, prect.centerY() - dh / 2 + dh)
            c.drawBitmap(bmp, null, ir, bmpPaint)
        } else { fill.color = 0xFF000000.toInt(); c.drawRect(prect, fill) }
        drawBanner(c, banner(s, now, stale), now)
        drawOverlay(c, s, now, stale)
        drawStage(c, s, now, stale)
        drawPanel(c, s, now)
        drawStrip(c, now)
        postInvalidateDelayed(40)
    }

    private fun drawBanner(c: Canvas, b: Banner, now: Long) {
        fill.color = b.color; c.drawRect(bannerR, fill)
        val bh = bannerR.height().toFloat()
        val r = bh * 0.36f; val pad = bh * 0.2f
        drawIcon(c, b.icon, pad + r, bh / 2, r, b.color)
        val left = if (b.icon == Icon.NONE) pad else pad * 2 + 2 * r
        val maxW = width - left - pad
        text.color = WHITE
        if (b.sub.isEmpty()) { fit(text, b.title, bh * 0.46f, maxW); c.drawText(b.title, left, bh / 2 + text.textSize * 0.35f, text) }
        else {
            fit(text, b.title, bh * 0.44f, maxW); val ts = text.textSize
            c.drawText(b.title, left, bh * 0.50f, text)
            text.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
            fit(text, b.sub, bh * 0.23f, maxW); c.drawText(b.sub, left, bh * 0.50f + ts * 0.05f + text.textSize * 1.25f, text)
            text.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
    }

    private fun mx(s: Snapshot, x: Float) = ir.left + (1f - x / s.imgW) * ir.width()   // mirrored
    private fun my(s: Snapshot, y: Float) = ir.top + y / s.imgH * ir.height()

    private fun drawOverlay(c: Canvas, s: Snapshot?, now: Long, stale: Boolean) {
        val pw = prect.width().toFloat(); val ph = prect.height().toFloat()
        val cx = prect.exactCenterX(); val cy = prect.exactCenterY()
        if (s == null || s.phase == Phase.LOADING || fatal != null) { guideOval(c, cx, cy, ph, 0.5f); return }
        if (stale) { fill.color = 0xAA000000.toInt(); c.drawRect(prect, fill); drawIcon(c, Icon.CROSS, cx, cy, ph * 0.12f, RED); return }
        val face = s.face
        val faceAge = now - s.frameMs
        val color = when {
            s.phase == Phase.MATCHING -> if (s.issue != Issue.NONE) AMBER else if (s.recognised) GREEN else if (s.cos.isNaN()) WHITE else RED
            s.issue != Issue.NONE -> AMBER
            s.hold > 0 || s.phase == Phase.DONE -> GREEN
            else -> WHITE
        }
        // dashed target oval until the user is well placed
        if (face == null || s.issue != Issue.NONE || s.phase == Phase.READY || s.phase == Phase.COUNTDOWN) guideOval(c, cx, cy, ph, if (face == null) 0.7f else 0.35f)

        if (face != null) {
            val x1 = mx(s, face.x + face.w); val x2 = mx(s, face.x); val y1 = my(s, face.y); val y2 = my(s, face.y + face.h)
            line.color = color; line.strokeWidth = 7f * u; line.pathEffect = null
            val l = min(x2 - x1, y2 - y1) * 0.28f
            for ((px, dx) in listOf(x1 to 1f, x2 to -1f)) for ((py, dy) in listOf(y1 to 1f, y2 to -1f)) {
                c.drawLine(px, py, px + dx * l, py, line); c.drawLine(px, py, px, py + dy * l, line)
            }
            if (s.phase == Phase.MATCHING && s.recognised) {
                val msg = s.name ?: "What do I call you?"
                text.textSize = ph * 0.045f; val tw = text.measureText(msg) + ph * 0.05f; val th = ph * 0.075f
                val px = ((x1 + x2) / 2).coerceIn(prect.left + tw / 2 + 4f, prect.right - tw / 2 - 4f)
                val py = (y1 - th * 0.8f).coerceAtLeast(prect.top + ph * 0.14f)
                fill.color = if (s.name != null) GREEN else AMBER
                c.drawRoundRect(RectF(px - tw / 2, py - th / 2, px + tw / 2, py + th / 2), th / 2, th / 2, fill)
                text.color = WHITE; text.textAlign = Paint.Align.CENTER; c.drawText(msg, px, py + text.textSize * 0.35f, text); text.textAlign = Paint.Align.LEFT
            }
            fill.color = WHITE
            for (i in 0 until 5) c.drawCircle(mx(s, face.lm[2 * i]), my(s, face.lm[2 * i + 1]), 5f * u, fill)
            if (s.phase == Phase.ENROLLING && s.hold > 0 && s.issue == Issue.NONE) {
                val fcx = (x1 + x2) / 2; val fcy = (y1 + y2) / 2; val rr = (y2 - y1) * 0.75f
                line.color = 0x55FFFFFF; line.strokeWidth = 12f * u; c.drawCircle(fcx, fcy, rr, line)
                line.color = GREEN; c.drawArc(RectF(fcx - rr, fcy - rr, fcx + rr, fcy + rr), -90f, 360f * s.hold / s.holdNeeded, false, line)
                val sy = y1 + ((now % 900) / 900f) * (y2 - y1)
                line.color = 0xCC7DFFB0.toInt(); line.strokeWidth = 5f * u; c.drawLine(x1, sy, x2, sy, line)
            }
        }
        // direction cue: big pulsing arrow at the edge the user should turn / move towards
        val dir: Icon? = when {
            s.issue == Issue.MOVE_LEFT -> Icon.ARROW_L; s.issue == Issue.MOVE_RIGHT -> Icon.ARROW_R
            s.issue == Issue.MOVE_UP -> Icon.ARROW_U; s.issue == Issue.MOVE_DOWN -> Icon.ARROW_D
            s.phase == Phase.ENROLLING && s.issue == Issue.NONE && s.hold == 0 && !s.poseTooFar -> when (s.pose) { Pose.LEFT -> Icon.ARROW_L; Pose.RIGHT -> Icon.ARROW_R; Pose.UP -> Icon.ARROW_U; Pose.DOWN -> Icon.ARROW_D; else -> null }
            else -> null
        }
        if (dir != null) {
            val pr = ph * 0.11f; val a = (160 + 95 * pulse(now)).toInt()
            val (ax, ay) = when (dir) { Icon.ARROW_L -> (prect.left + pr * 1.4f) to cy; Icon.ARROW_R -> (prect.right - pr * 1.4f) to cy; Icon.ARROW_U -> cx to (prect.top + pr * 1.4f + 0.09f * ph); else -> cx to (prect.bottom - pr * 1.4f - 0.1f * ph) }
            fill.color = (a shl 24) or 0x2563EB; c.drawCircle(ax, ay, pr * 1.25f, fill)
            drawIcon(c, dir, ax, ay, pr, BLUE)
        }
        if (s.phase == Phase.ENROLLING && s.pose != null && s.pose != Pose.UP && s.pose != Pose.DOWN) yawMeter(c, s)
        if (s.phase == Phase.ENROLLING && (s.pose == Pose.UP || s.pose == Pose.DOWN)) pitchMeter(c, s)
        // countdown / capture / done
        if (s.phase == Phase.COUNTDOWN) {
            val n = (3 - (now - s.phaseStartMs) / 1000).coerceIn(1, 3)
            fill.color = 0x99000000.toInt(); c.drawCircle(cx, cy, ph * 0.2f, fill)
            text.color = WHITE; text.textSize = ph * 0.3f; text.textAlign = Paint.Align.CENTER; c.drawText("$n", cx, cy + ph * 0.1f, text); text.textAlign = Paint.Align.LEFT
        }
        val sinceCap = now - s.capturedAtMs
        if (s.capturedAtMs > 0 && sinceCap < 700) { fill.color = ((90 * (1 - sinceCap / 700f)).toInt() shl 24) or 0x1FA85A; c.drawRect(prect, fill) }
        if ((s.capturedAtMs > 0 && sinceCap < 1100) || s.phase == Phase.DONE) { fill.color = 0xCC1FA85A.toInt(); c.drawCircle(cx, cy, ph * 0.14f, fill); drawIcon(c, Icon.CHECK, cx, cy, ph * 0.12f, GREEN) }
        if (s.skippedAtMs > 0 && now - s.skippedAtMs < 900) { fill.color = 0xCCE59A12.toInt(); c.drawCircle(cx, cy, ph * 0.12f, fill); drawIcon(c, Icon.WARN, cx, cy, ph * 0.1f, AMBER) }
    }

    /** 0 = waiting for a face, 1 = face detected, 2 = detection complete. */
    private fun stageOf(s: Snapshot?, stale: Boolean): Int {
        if (s == null || stale || s.phase == Phase.LOADING || fatal != null) return 0
        if (s.phase == Phase.DONE || (s.phase == Phase.MATCHING && !s.cos.isNaN())) return 2
        return if (s.face != null && System.currentTimeMillis() - s.frameMs < 1500) 1 else 0
    }

    /** Big status pill over the top of the picture: Waiting for face -> Face detected -> Face detection complete. */
    private fun drawStage(c: Canvas, s: Snapshot?, now: Long, stale: Boolean) {
        val st = stageOf(s, stale)
        val match = s != null && s.phase == Phase.MATCHING && st == 2
        val label = when {
            st == 0 -> "Waiting for face…"; st == 1 -> "Face detected"
            match && s!!.recognised -> if (s.name != null) "Recognized: ${s.name}" else "Face recognized"
            match -> "Unknown person"
            else -> "Face detection complete"
        }
        val col = if (match && !s!!.recognised) RED else when (st) { 0 -> AMBER; 1 -> BLUE; else -> GREEN }
        val ph = prect.height().toFloat(); val pw = prect.width().toFloat()
        val g = 0.02f * pw
        val r = RectF(prect.left + g, prect.top + g, prect.right - g, prect.top + g + 0.085f * ph)
        fill.color = 0xD9000000.toInt(); c.drawRoundRect(r, r.height() / 2, r.height() / 2, fill)
        val cy = r.centerY(); val dr = r.height() * 0.13f
        for (i in 0..2) {   // progress dots
            val x = r.left + r.height() * 0.55f + i * dr * 3.2f
            fill.color = if (i <= st) col else GREY
            val rad = if (i == st && st < 2) dr * (1f + 0.35f * pulse(now)) else dr
            c.drawCircle(x, cy, rad, fill)
        }
        val tx = r.left + r.height() * 0.55f + 3 * dr * 3.2f + r.height() * 0.1f
        fill.color = col; c.drawRoundRect(RectF(tx - dr * 1.2f, r.top + r.height() * 0.2f, tx - dr * 0.6f, r.bottom - r.height() * 0.2f), dr, dr, fill)
        text.color = WHITE; fit(text, label, r.height() * 0.5f, r.right - tx - r.height() * 0.3f)
        c.drawText(label, tx + dr * 0.4f, cy + text.textSize * 0.35f, text)
        if (st == 2) drawIcon(c, Icon.CHECK, r.right - r.height() * 0.55f, cy, r.height() * 0.28f, col)
    }

    private fun guideOval(c: Canvas, cx: Float, cy: Float, ph: Float, alpha: Float) {
        line.color = (alpha * 255).toInt() shl 24 or 0xFFFFFF; line.strokeWidth = 5f * u; line.pathEffect = DashPathEffect(floatArrayOf(26f * u, 18f * u), 0f)
        val rh = ph * 0.33f; val rw = rh * 0.78f
        c.drawOval(RectF(cx - rw, cy - rh, cx + rw, cy + rh), line); line.pathEffect = null
    }

    /** Horizontal meter along the bottom of the preview: green zone = where the head should be, dot = where it is now. */
    private fun yawMeter(c: Canvas, s: Snapshot) {
        val x0 = prect.left + prect.width() * 0.14f; val x1 = prect.right - prect.width() * 0.14f; val y = prect.bottom - prect.height() * 0.07f; val t = prect.height() * 0.028f
        val lo: Float; val hi: Float
        when (s.pose) { Pose.LEFT -> { lo = -EnrollEngine.YAW_MAX; hi = -EnrollEngine.YAW_MIN }; Pose.RIGHT -> { lo = EnrollEngine.YAW_MIN; hi = EnrollEngine.YAW_MAX }; else -> { lo = -EnrollEngine.YAW_MIN; hi = EnrollEngine.YAW_MIN } }
        val range = 0.7f
        fun px(v: Float) = x0 + (v.coerceIn(-range, range) + range) / (2 * range) * (x1 - x0)
        fill.color = 0xAA000000.toInt(); c.drawRoundRect(RectF(x0 - t * 2, y - t * 2.2f, x1 + t * 2, y + t * 2.2f), t * 2, t * 2, fill)
        fill.color = 0xFF3B4650.toInt(); c.drawRoundRect(RectF(x0, y - t / 2, x1, y + t / 2), t / 2, t / 2, fill)
        fill.color = GREEN; c.drawRoundRect(RectF(px(lo), y - t, px(hi), y + t), t / 2, t / 2, fill)
        fill.color = if (s.poseOk || s.hold > 0) WHITE else AMBER; c.drawCircle(px(s.yaw), y, t * 1.6f, fill)
        text.textSize = t * 2.1f; text.color = DIM; text.textAlign = Paint.Align.LEFT; c.drawText("LEFT", x0, y - t * 2.6f, text)
        text.textAlign = Paint.Align.RIGHT; c.drawText("RIGHT", x1, y - t * 2.6f, text); text.textAlign = Paint.Align.LEFT; text.color = WHITE
    }

    /** Vertical meter along the right edge of the preview (top = chin up). */
    private fun pitchMeter(c: Canvas, s: Snapshot) {
        val x = prect.right - prect.width() * 0.07f; val y0 = prect.top + prect.height() * 0.16f; val y1 = prect.bottom - prect.height() * 0.16f; val t = prect.width() * 0.022f
        val lo: Float; val hi: Float
        if (s.pose == Pose.UP) { lo = -EnrollEngine.PITCH_MAX; hi = -EnrollEngine.PITCH_MIN } else { lo = EnrollEngine.PITCH_MIN; hi = EnrollEngine.PITCH_MAX }
        val range = 0.4f
        fun py(v: Float) = y0 + (v.coerceIn(-range, range) + range) / (2 * range) * (y1 - y0)
        fill.color = 0xAA000000.toInt(); c.drawRoundRect(RectF(x - t * 3, y0 - t * 3, x + t * 3, y1 + t * 3), t * 2, t * 2, fill)
        fill.color = 0xFF3B4650.toInt(); c.drawRoundRect(RectF(x - t / 2, y0, x + t / 2, y1), t / 2, t / 2, fill)
        fill.color = GREEN; c.drawRoundRect(RectF(x - t, py(lo), x + t, py(hi)), t / 2, t / 2, fill)
        fill.color = if (s.poseOk || s.hold > 0) WHITE else AMBER; c.drawCircle(x, py(s.pitch), t * 1.6f, fill)
        text.textSize = t * 2f; text.color = DIM; text.textAlign = Paint.Align.CENTER; c.drawText("UP", x, y0 - t * 3.4f, text); c.drawText("DOWN", x, y1 + t * 5.4f, text); text.textAlign = Paint.Align.LEFT; text.color = WHITE
    }

    private fun drawPanel(c: Canvas, s: Snapshot?, now: Long) {
        val content = Rect(panel); content.bottom = btnRect.top - (0.01f * min(width, height)).toInt()
        if (content.height() < 40) return
        val phase = s?.phase ?: Phase.LOADING
        text.color = DIM; text.textSize = 30f * u; c.drawText(if (phase == Phase.MATCHING) "RECOGNITION TEST" else "ENROLLMENT STEPS", content.left.toFloat(), content.top + 34f * u, text)
        val top = content.top + 60f * u
        if (phase == Phase.MATCHING) {
            var y = top + 30f * u
            text.typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            for (l in stats) { fit(text, l, 28f * u, content.width().toFloat()); text.color = WHITE; c.drawText(l, content.left.toFloat(), y, text); y += text.textSize * 1.4f }
            text.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            val rec = when (label) { "same" -> "● Recording: ME" to GREEN; "other" -> "● Recording: SOMEONE ELSE" to AMBER; else -> "○ Not recording - tap a button below" to DIM }
            y += 4f * u; text.color = rec.second; fit(text, rec.first, 32f * u, content.width().toFloat()); c.drawText(rec.first, content.left.toFloat(), y, text)
        } else {
            val steps = s?.steps?.takeIf { it.isNotEmpty() } ?: List(5) { StepState.PENDING }
            val poses = Pose.values()
            val horizontal = content.width() > content.height() * 1.3f
            for (i in poses.indices) {
                val st = steps[i]
                val r: Float; val cx: Float; val cy: Float
                if (horizontal) { val colW = content.width() / 5f; r = min(colW * 0.28f, content.height() * 0.2f); cx = content.left + colW * (i + 0.5f); cy = top + r + 8f * u }
                else { val rowH = min((content.height() - 70f * u) / 5f, 120f * u); r = rowH * 0.36f; cx = content.left + r + 4f * u; cy = top + rowH * (i + 0.5f) }
                val col = when (st) { StepState.DONE -> GREEN; StepState.SKIPPED -> AMBER; StepState.ACTIVE -> BLUE; else -> GREY }
                fill.color = col
                val rr = if (st == StepState.ACTIVE) r * (1f + 0.08f * pulse(now)) else r
                c.drawCircle(cx, cy, rr, fill)
                when (st) {
                    StepState.DONE -> drawIcon(c, Icon.CHECK, cx, cy, r * 0.8f, col)
                    StepState.SKIPPED -> drawIcon(c, Icon.WARN, cx, cy, r * 0.8f, col)
                    StepState.ACTIVE -> drawIcon(c, poseIcon(poses[i]), cx, cy, r * 0.7f, col)
                    else -> { text.color = DIM; text.textSize = r * 1.0f; text.textAlign = Paint.Align.CENTER; c.drawText("${i + 1}", cx, cy + r * 0.35f, text); text.textAlign = Paint.Align.LEFT }
                }
                text.color = if (st == StepState.PENDING) DIM else WHITE
                if (horizontal) { fit(text, poses[i].chip, r * 0.8f, content.width() / 5f - 8f * u); text.textAlign = Paint.Align.CENTER; c.drawText(poses[i].chip, cx, cy + r + text.textSize * 1.3f, text); text.textAlign = Paint.Align.LEFT }
                else { fit(text, poses[i].chip, r * 1.0f, content.right - (cx + r * 1.4f)); c.drawText(poses[i].chip, cx + r * 1.4f, cy + text.textSize * 0.35f, text) }
            }
        }
        text.color = DIM; text.textSize = 22f * u; text.typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
        fit(text, diag, 22f * u, content.width().toFloat()); c.drawText(diag, content.left.toFloat(), content.bottom - 4f * u, text)
        text.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    private fun drawStrip(c: Canvas, now: Long) {
        fill.color = STRIP; c.drawRect(stripR, fill)
        val h = stripR.height().toFloat(); val cy = stripR.exactCenterY()
        smoothMic = (smoothMic * 0.7f + (min(1.0, ln(1.0 + micLevel) / ln(6000.0))).toFloat() * 0.3f)
        val done = cmdIndex >= COMMANDS.size
        val justMatched = now - matchedAt < 1400
        val justWrong = !justMatched && now - wrongAt < 3500 && wrongText.isNotEmpty()
        val good = justMatched || done
        fill.color = if (good) GREEN else if (justWrong) AMBER else GREY; c.drawCircle(h * 0.8f, cy, h * 0.28f, fill)
        fill.color = WHITE; c.drawRoundRect(RectF(h * 0.7f, cy - h * 0.14f, h * 0.9f, cy + h * 0.02f), h * 0.1f, h * 0.1f, fill); c.drawRect(h * 0.77f, cy + h * 0.02f, h * 0.83f, cy + h * 0.17f, fill)
        val bx = h * 1.4f; val bw = min(width * 0.16f, 260f * u)
        fill.color = GREY; c.drawRoundRect(RectF(bx, cy - h * 0.1f, bx + bw, cy + h * 0.1f), h * 0.1f, h * 0.1f, fill)
        fill.color = if (smoothMic > 0.85f) AMBER else GREEN; c.drawRoundRect(RectF(bx, cy - h * 0.1f, bx + bw * smoothMic, cy + h * 0.1f), h * 0.1f, h * 0.1f, fill)
        val target = if (done) "" else COMMANDS[cmdIndex]
        val msg = when {
            justMatched -> "✓ Heard \"$matchedCmd\""
            done -> "✓ All ${COMMANDS.size} commands heard"
            justWrong -> "Heard \"$wrongText\" - please say \"$target\""
            else -> "Listening - say \"$target\"  (${cmdIndex + 1}/${COMMANDS.size})"
        }
        text.color = if (good) 0xFF7DFFB0.toInt() else if (justWrong) 0xFFFFC857.toInt() else WHITE
        fit(text, msg, h * 0.5f, width - (bx + bw + h) - h * 0.4f)
        c.drawText(msg, bx + bw + h * 0.6f, cy + text.textSize * 0.35f, text)
        text.color = WHITE
    }
}
