package com.smartphotos.frame

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View

/** Numbered face boxes drawn over the current photo (docs §8.3). Faces are numbered left to right; tapping one asks for a name. */
class FaceOverlay(ctx: Context, private val contentRect: () -> Rect?) : View(ctx) {
    /** Faces of the shown photo, already sorted left to right. [names] gives the person's name (null = unnamed). */
    var faces: List<FaceRec> = emptyList()
    var names: List<String?> = emptyList()
    var onTap: (Int) -> Unit = {}
    private val box = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 5f }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; isFakeBoldText = true }

    private fun rectOf(f: FaceRec, c: Rect) = Rect(
        c.left + (f.x * c.width()).toInt(), c.top + (f.y * c.height()).toInt(),
        c.left + ((f.x + f.w) * c.width()).toInt(), c.top + ((f.y + f.h) * c.height()).toInt())

    override fun onDraw(cv: Canvas) {
        val c = contentRect() ?: return
        val u = resources.displayMetrics.density
        for ((i, f) in faces.withIndex()) {
            val r = rectOf(f, c); val named = names.getOrNull(i) != null
            val col = if (named) 0xFF1FA85A.toInt() else 0xFFE59A12.toInt()
            box.color = col; cv.drawRoundRect(r.left.toFloat(), r.top.toFloat(), r.right.toFloat(), r.bottom.toFloat(), 8f * u, 8f * u, box)
            val rad = 16f * u
            fill.color = col; cv.drawCircle(r.left + rad, r.top + rad, rad, fill)
            txt.textSize = 18f * u; cv.drawText("${i + 1}", r.left + rad, r.top + rad + 6f * u, txt)
            val label = names.getOrNull(i) ?: "tap to name"
            txt.textSize = 15f * u
            val tw = txt.measureText(label) + 20f * u
            fill.color = 0xCC000000.toInt()
            cv.drawRoundRect(r.centerX() - tw / 2, r.bottom + 6f * u, r.centerX() + tw / 2, r.bottom + 34f * u, 12f * u, 12f * u, fill)
            cv.drawText(label, r.centerX().toFloat(), r.bottom + 26f * u, txt)
        }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.action != MotionEvent.ACTION_UP) return faces.isNotEmpty() && hit(e) >= 0
        val i = hit(e); if (i >= 0) { onTap(i); return true }
        return false
    }

    private fun hit(e: MotionEvent): Int {
        val c = contentRect() ?: return -1
        val pad = (10 * resources.displayMetrics.density).toInt()
        for ((i, f) in faces.withIndex()) { val r = rectOf(f, c); r.inset(-pad, -pad); if (r.contains(e.x.toInt(), e.y.toInt())) return i }
        return -1
    }
}
