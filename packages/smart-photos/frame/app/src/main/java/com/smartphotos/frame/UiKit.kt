package com.smartphotos.frame

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.widget.Button
import android.widget.TextView

/** Small shared view helpers: the frame is built in code (no XML), big touch targets, readable from across a room. */
fun Context.dp(v: Int) = (v * resources.displayMetrics.density).toInt()

fun Context.pill(color: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(18).toFloat() }

fun Context.uiLabel(t: String, size: Float, bold: Boolean = false) = TextView(this).apply {
    text = t; setTextColor(Color.WHITE); textSize = size; if (bold) typeface = Typeface.DEFAULT_BOLD
}

fun Context.uiButton(t: String, color: Int = 0xCC20262C.toInt(), onClick: () -> Unit) = Button(this).apply {
    text = t; setTextColor(Color.WHITE); textSize = 15f; isAllCaps = true; background = pill(color)
    minHeight = dp(52); minimumHeight = dp(52); setPadding(dp(22), 0, dp(22), 0)
    setOnClickListener { onClick() }
}
