package com.smartphotos.frame

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.view.View

/** Full-screen photo with a cross-fade. Each photo is drawn "contain" over a blurred, dimmed copy of itself, so any aspect ratio fills the screen. */
class FrameView(ctx: Context) : View(ctx) {
    private class Shot(val full: Bitmap) {
        val tiny: Bitmap = Bitmap.createScaledBitmap(full, 24, (24f * full.height / full.width).toInt().coerceAtLeast(2), true)
    }
    private var cur: Shot? = null
    private var prev: Shot? = null
    private var fade = 1f
    private var anim: ValueAnimator? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)   // dither: the dimmed, stretched backdrop otherwise bands
    private val shade = Paint().apply { color = 0x99000000.toInt() }
    private val src = Rect(); private val dst = Rect()

    fun show(b: Bitmap?, animate: Boolean = true) {
        anim?.cancel()
        prev = cur; cur = b?.let { Shot(it) }
        if (!animate || prev == null) { fade = 1f; prev = null; invalidate(); return }
        fade = 0f
        anim = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 700
            addUpdateListener { fade = it.animatedValue as Float; invalidate() }
            addListener(object : android.animation.AnimatorListenerAdapter() { override fun onAnimationEnd(a: android.animation.Animator) { prev = null; invalidate() } })
            start()
        }
    }

    override fun onDraw(c: Canvas) {
        c.drawColor(0xFF000000.toInt())
        prev?.let { if (fade < 1f) draw(c, it, 255) }
        cur?.let { draw(c, it, (255 * fade).toInt().coerceIn(0, 255)) }
    }

    private fun draw(c: Canvas, s: Shot, alpha: Int) {
        paint.alpha = alpha
        // Backdrop: the tiny copy stretched to cover the view (smooth scaling = cheap blur), then dimmed.
        src.set(0, 0, s.tiny.width, s.tiny.height); dst.set(0, 0, width, height)
        c.drawBitmap(s.tiny, src, dst, paint)
        shade.alpha = alpha * 0x99 / 255; c.drawRect(dst, shade)
        // Photo: contain-fit, centred.
        val sc = minOf(width.toFloat() / s.full.width, height.toFloat() / s.full.height)
        val w = (s.full.width * sc).toInt(); val h = (s.full.height * sc).toInt()
        src.set(0, 0, s.full.width, s.full.height)
        dst.set((width - w) / 2, (height - h) / 2, (width + w) / 2, (height + h) / 2)
        c.drawBitmap(s.full, src, dst, paint)
    }
}
