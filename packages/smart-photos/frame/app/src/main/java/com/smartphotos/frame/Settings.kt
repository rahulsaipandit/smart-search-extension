package com.smartphotos.frame

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** The frame's settings, persisted in app-private preferences. Defaults are the privacy-friendly ones: camera and microphone start OFF. */
class Settings(ctx: Context) {
    private val sp = ctx.getSharedPreferences("frame", Context.MODE_PRIVATE)
    private fun int(k: String, d: Int) = sp.getInt(k, d)
    private fun bool(k: String, d: Boolean) = sp.getBoolean(k, d)

    var intervalSec: Int get() = int("interval", 8); set(v) { sp.edit().putInt("interval", v.coerceIn(3, 120)).apply() }
    var presence: Boolean get() = bool("presence", false); set(v) { sp.edit().putBoolean("presence", v).apply() }
    var leaveSec: Int get() = int("leave", 30); set(v) { sp.edit().putInt("leave", v.coerceIn(10, 600)).apply() }
    /** 0 = off, 1 = auto (only while a face was seen in the last 5 s), 2 = always on. */
    var micMode: Int get() = int("mic", 0); set(v) { sp.edit().putInt("mic", v.mod(3)).apply() }
    var nightOn: Boolean get() = bool("night", true); set(v) { sp.edit().putBoolean("night", v).apply() }
    var nightStart: Int get() = int("nightStart", 23); set(v) { sp.edit().putInt("nightStart", v.mod(24)).apply() }
    var nightEnd: Int get() = int("nightEnd", 7); set(v) { sp.edit().putInt("nightEnd", v.mod(24)).apply() }
    var bootStart: Boolean get() = bool("boot", false); set(v) { sp.edit().putBoolean("boot", v).apply() }
    var drift: Boolean get() = bool("drift", true); set(v) { sp.edit().putBoolean("drift", v).apply() }
    /** When several known people are in view: true = only photos containing all of them (falls back to any). */
    /** The microphone pauses after this many seconds with no recognised command (a touch, or a face coming back in AUTO, wakes it). */
    var silenceSec: Int get() = int("silence", 60); set(v) { sp.edit().putInt("silence", v.coerceIn(15, 600)).apply() }
    var allOfThem: Boolean get() = bool("allOf", true); set(v) { sp.edit().putBoolean("allOf", v).apply() }

    /** True if [hour] (0..23) is inside the night window (which may wrap past midnight). */
    fun isNight(hour: Int): Boolean {
        if (!nightOn || nightStart == nightEnd) return false
        return if (nightStart < nightEnd) hour in nightStart until nightEnd else hour >= nightStart || hour < nightEnd
    }
}

/** Starts the frame after the tablet boots, if the setting is on (Android 9 still allows a receiver to start an activity). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action == Intent.ACTION_BOOT_COMPLETED && Settings(c).bootStart)
            c.startActivity(Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/** A plain full-screen list of settings with big +/- and toggle buttons. */
class SettingsScreen(
    private val act: Activity, private val s: Settings, private val onChanged: () -> Unit, private val onClose: () -> Unit,
    private val onImport: () -> Unit, private val onPin: () -> Unit,
) {
    private var screen: FrameLayout? = null
    private var host: FrameLayout? = null
    val isOpen: Boolean get() = screen != null

    fun show(root: FrameLayout) {
        if (screen != null) return
        val f = FrameLayout(act).apply { setBackgroundColor(0xF2101418.toInt()); isClickable = true }
        screen = f; host = root
        root.addView(f, FrameLayout.LayoutParams(-1, -1))
        render()
    }

    fun hide() { screen?.let { host?.removeView(it) }; screen = null }

    private fun render() {
        val f = screen ?: return
        f.removeAllViews()
        val col = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setPadding(act.dp(28), act.dp(24), act.dp(28), act.dp(40)) }
        f.addView(ScrollView(act).apply { addView(col) }, FrameLayout.LayoutParams(-1, -1))
        val top = LinearLayout(act).apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(act.uiLabel("Settings", 30f, true), LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(act.uiButton("Close") { onClose() })
        col.addView(top)

        fun changed() { onChanged(); render() }
        fun row(title: String, hint: String, vararg controls: android.view.View) {
            val r = LinearLayout(act).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, act.dp(14), 0, act.dp(4)) }
            val t = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL }
            t.addView(act.uiLabel(title, 20f)); if (hint.isNotEmpty()) t.addView(act.uiLabel(hint, 14f).apply { setTextColor(0xFF8A97A3.toInt()) })
            r.addView(t, LinearLayout.LayoutParams(0, -2, 1f))
            for (c in controls) r.addView(c, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = act.dp(8) })
            col.addView(r)
        }
        fun value(t: String): TextView = act.uiLabel(t, 20f, true).apply { minWidth = act.dp(70); gravity = Gravity.CENTER }
        fun stepper(title: String, hint: String, v: Int, unit: String, step: Int, set: (Int) -> Unit) =
            row(title, hint, act.uiButton("-") { set(v - step); changed() }, value("$v$unit"), act.uiButton("+") { set(v + step); changed() })
        fun toggle(title: String, hint: String, on: Boolean, set: (Boolean) -> Unit) =
            row(title, hint, act.uiButton(if (on) "On" else "Off", if (on) 0xFF1FA85A.toInt() else 0xCC20262C.toInt()) { set(!on); changed() })

        stepper("Seconds per photo", "How long each photo stays on screen", s.intervalSec, " s", 1) { s.intervalSec = it }
        toggle("Walk-up detection (camera)", "Shows a person's photos when the camera sees them. A camera light appears on screen while it runs. Needs named people.", s.presence) { s.presence = it }
        stepper("Pause the microphone after silence", "Seconds with no command heard; touch the screen to listen again", s.silenceSec, " s", 15) { s.silenceSec = it }
        stepper("Back to everything after", "Seconds without seeing a known person", s.leaveSec, " s", 10) { s.leaveSec = it }
        toggle("Several people: only photos with all of them", "Off: alternate between their photos", s.allOfThem) { s.allOfThem = it }
        row("Microphone", "Auto listens only while someone is in front of the camera", act.uiButton(arrayOf("Off", "Auto", "On")[s.micMode]) { s.micMode = s.micMode + 1; changed() })
        toggle("Night mode", "Screen off, camera and microphone off during the night hours", s.nightOn) { s.nightOn = it }
        stepper("Night starts", "", s.nightStart, ":00", 1) { s.nightStart = it }
        stepper("Night ends", "", s.nightEnd, ":00", 1) { s.nightEnd = it }
        toggle("Slow drift", "Moves the picture a little over time so a static photo cannot burn in", s.drift) { s.drift = it }
        toggle("Start when the tablet boots", "", s.bootStart) { s.bootStart = it }
        row("Add photos", "Copy photos and videos from a USB stick, SD card or any folder into the frame", act.uiButton("Choose folder", 0xFF2563EB.toInt()) { onImport() })
        row("Pin app to screen", "Keeps the frame on screen so it cannot be left by accident. To leave: hold Back and Overview together", act.uiButton("Pin / unpin") { onPin() })
    }
}
