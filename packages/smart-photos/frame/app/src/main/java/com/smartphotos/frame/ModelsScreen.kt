package com.smartphotos.frame

import android.app.Activity
import android.content.Context
import android.net.ConnectivityManager
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.io.File

/**
 * The first-run (and Settings) screen that fetches the search and voice models with the user's consent: what is downloaded and how big,
 * where from, a progress bar, Pause (progress is kept and resumed), and a clear error if a file is refused. Without the models the frame
 * still shows the photos; only search and voice are off.
 */
class ModelsScreen(
    private val act: Activity, private val base: File,
    private val onInstalled: () -> Unit, private val onClose: (declined: Boolean) -> Unit,
) {
    private val ui = Handler(Looper.getMainLooper())
    private var screen: FrameLayout? = null
    private var host: FrameLayout? = null
    private var downloader: ModelDownloader? = null
    val isOpen: Boolean get() = screen != null
    val downloading: Boolean get() = downloader?.running == true

    private fun mb(b: Long) = "%.0f MB".format(b / 1_000_000.0)

    private fun network(): String {
        val cm = act.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        @Suppress("DEPRECATION") val n = cm.activeNetworkInfo
        @Suppress("DEPRECATION") return when {
            n == null || !n.isConnected -> "There is no internet connection right now."
            !cm.isActiveNetworkMetered -> "You are on an unmetered connection (such as Wi-Fi)."
            else -> "This connection may be metered (mobile data)."
        }
    }

    fun show(root: FrameLayout, autoStart: Boolean = false) {
        if (screen != null) return
        val f = FrameLayout(act).apply { setBackgroundColor(0xF2101418.toInt()); isClickable = true }
        screen = f; host = root
        root.addView(f, FrameLayout.LayoutParams(-1, -1))
        renderPrompt()
        if (autoStart) startDownload()
    }

    fun hide() { downloader?.cancel(); screen?.let { host?.removeView(it) }; screen = null }

    private fun card(build: LinearLayout.() -> Unit) {
        val f = screen ?: return
        f.removeAllViews()
        val col = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setPadding(act.dp(36), act.dp(30), act.dp(36), act.dp(30)); background = act.pill(0xFF1B2128.toInt()); build() }
        f.addView(col, FrameLayout.LayoutParams(minOf(act.dp(760), act.resources.displayMetrics.widthPixels - act.dp(40)), -2, Gravity.CENTER))
    }

    private fun renderPrompt() {
        val missing = Models.missing(base)
        if (missing.isEmpty()) { renderDone(); return }
        android.util.Log.i("FRAME", "MODELS prompt shown: ${Models.remainingBytes(base, missing) / 1_000_000} MB to download; space ${if (Models.spaceCheck(base, missing).ok) "ok" else "NOT ENOUGH"}")
        val remaining = Models.remainingBytes(base, missing)
        val space = Models.spaceCheck(base, missing)
        val clipBytes = missing.filter { it.unzipTo == null }.sumOf { it.bytes }
        val voiceBytes = missing.filter { it.unzipTo != null }.sumOf { it.bytes }
        card {
            addView(act.uiLabel("Set up photo search and voice", 28f, true))
            addView(act.uiLabel(
                (if (clipBytes > 0) "• Photo search (${mb(clipBytes)}): finds photos by meaning, like “seaside” or “birthday cake”.\n" else "") +
                (if (voiceBytes > 0) "• Voice commands (${mb(voiceBytes)}): understands “pause”, “next photo” and so on, entirely on this tablet.\n" else "") +
                "\nThese are downloaded once, from huggingface.co and alphacephei.com. Nothing about you, your photos or your voice is sent: the download only asks for the files. " +
                "After that the frame works without the internet.", 17f).apply { setPadding(0, act.dp(14), 0, act.dp(10)) })
            addView(act.uiLabel("Download size: ${mb(remaining)}.  ${network()}${if (remaining < missing.sumOf { it.bytes }) "  (a partly finished download will be continued)" else ""}", 16f, true).apply { setTextColor(0xFF9AB4C7.toInt()) })
            if (!space.ok) addView(act.uiLabel("Not enough free space on this tablet: about ${mb(space.needed)} is needed while unpacking, but only ${mb(space.usable)} can be used (the frame always keeps ${mb(Models.KEEP_FREE)} free). " +
                "Free some space, for example by removing apps or photos you do not need, then press Check again.", 16f, true).apply { setTextColor(0xFFFFB4A9.toInt()); setPadding(0, act.dp(10), 0, act.dp(4)) })
            addView(act.uiLabel("Without them the frame still shows your photos; only search and voice stay off. You can do this later in Settings.", 15f).apply { setTextColor(0xFF8A97A3.toInt()); setPadding(0, act.dp(8), 0, act.dp(18)) })
            val row = LinearLayout(act).apply { gravity = Gravity.END }
            row.addView(act.uiButton("Not now") { onClose(true) })
            if (space.ok) row.addView(act.uiButton("Download ${mb(remaining)}", 0xFF2563EB.toInt()) { startDownload() }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = act.dp(12) })
            else row.addView(act.uiButton("Check again", 0xFF2563EB.toInt()) { renderPrompt() }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = act.dp(12) })
            addView(row)
        }
    }

    private lateinit var bar: ProgressBar
    private lateinit var line1: TextView
    private lateinit var line2: TextView

    private fun renderProgress() {
        card {
            addView(act.uiLabel("Downloading…", 26f, true))
            line1 = act.uiLabel("Starting…", 18f).apply { setPadding(0, act.dp(14), 0, act.dp(8)) }
            addView(line1)
            bar = ProgressBar(act, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000 }
            addView(bar, LinearLayout.LayoutParams(-1, act.dp(14)))
            line2 = act.uiLabel("", 15f).apply { setTextColor(0xFF8A97A3.toInt()); setPadding(0, act.dp(8), 0, act.dp(18)) }
            addView(line2)
            val row = LinearLayout(act).apply { gravity = Gravity.END }
            row.addView(act.uiButton("Pause") { downloader?.cancel() })
            addView(row)
        }
    }

    private fun renderError(msg: String, paused: Boolean) {
        card {
            addView(act.uiLabel(if (paused) "Paused" else "The download did not finish", 26f, true))
            addView(act.uiLabel(msg, 17f).apply { setPadding(0, act.dp(14), 0, act.dp(18)) })
            val row = LinearLayout(act).apply { gravity = Gravity.END }
            row.addView(act.uiButton("Close") { onClose(false) })
            row.addView(act.uiButton(if (paused) "Continue" else "Try again", 0xFF2563EB.toInt()) { startDownload() }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = act.dp(12) })
            addView(row)
        }
    }

    private fun renderDone() {
        card {
            addView(act.uiLabel("Ready", 28f, true))
            addView(act.uiLabel("Photo search and voice commands are set up. Searching starts once your photos have been indexed.", 17f).apply { setPadding(0, act.dp(14), 0, act.dp(18)) })
            val row = LinearLayout(act).apply { gravity = Gravity.END }
            row.addView(act.uiButton("Done", 0xFF2563EB.toInt()) { onClose(false) })
            addView(row)
        }
    }

    private fun startDownload() {
        if (downloading) return
        val missing = Models.missing(base)
        if (missing.isEmpty()) { renderDone(); return }
        renderProgress()
        downloader = ModelDownloader(base,
            { p -> ui.post { if (screen != null && p.index < p.count) {
                line1.text = "${p.index + 1} of ${p.count}: ${p.title}"
                bar.progress = if (p.overallTotal > 0) (p.overallDone * 1000 / p.overallTotal).toInt() else 0
                line2.text = "${mb(p.done)} of ${mb(p.total)} for this file   ·   ${p.overallDone * 100 / maxOf(1, p.overallTotal)}% overall"
            } } },
            { err -> ui.post {
                if (screen == null) return@post
                if (err == null) { onInstalled(); renderDone() } else renderError(err, paused = err.startsWith("Paused"))
            } }).also { it.start(missing) }
    }
}
