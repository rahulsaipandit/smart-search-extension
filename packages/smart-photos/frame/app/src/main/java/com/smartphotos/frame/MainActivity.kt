package com.smartphotos.frame

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.util.concurrent.Executors

/**
 * The Smart Photos frame (P1): slideshow of the photos in `<app external files>/photos`, semantic search ("seaside"), voice commands,
 * delete with confirmation and undo. State machine as in docs/SmartPhotos.md §8.1 (presence/face policy is P3 and not wired here).
 */
class MainActivity : Activity() {
    private enum class State { AMBIENT, FILTERED, PAUSED, CONFIRM_DELETE }

    private val ui = Handler(Looper.getMainLooper())
    private val bg = Executors.newSingleThreadExecutor()       // search, model loads, voice start/stop
    private val decoder = Executors.newSingleThreadExecutor()  // photo decoding for the screen
    @Volatile private var destroyed = false

    private lateinit var base: File
    private lateinit var store: PhotoStore
    private var clip: ClipEngine? = null
    private var indexer: Indexer? = null
    private var voice: Voice? = null
    private var micWanted = false

    private lateinit var frame: FrameView
    private lateinit var chip: TextView
    private lateinit var centre: TextView
    private lateinit var message: TextView
    private lateinit var controls: LinearLayout
    private lateinit var pauseBtn: Button
    private lateinit var micBtn: Button
    private lateinit var deleteBar: LinearLayout
    private lateinit var deleteText: TextView
    private lateinit var undoBar: LinearLayout

    // slideshow state
    private var state = State.AMBIENT
    private var stateBeforeModal = State.AMBIENT
    private var playlist: List<Photo> = emptyList()
    private var pos = 0
    private var filterLabel = ""
    private var intervalMs = 8000L
    private var showToken = 0
    private var current: Photo? = null
    private var lastTrashed: Trashed? = null
    private var indexStatus = ""

    private val tick = Runnable { if (state == State.AMBIENT || state == State.FILTERED) { step(+1) } }
    private val hideControls = Runnable { controls.visibility = View.GONE }
    private val hideMessage = Runnable { message.visibility = View.GONE }
    private val deleteTimeout = Runnable { if (state == State.CONFIRM_DELETE) cancelDelete("Delete cancelled") }
    private val hideUndo = Runnable { undoBar.visibility = View.GONE; lastTrashed = null }

    private fun log(s: String) = Log.i("FRAME", s)
    /** The activity is exported (launcher), so test hooks (root / query / selftest extras) only work in debug builds. */
    private val debuggable by lazy { applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        base = getExternalFilesDir(null) ?: filesDir
        val root = (if (debuggable) intent.getStringExtra("root") else null)?.let { File(it) } ?: File(base, "photos")
        store = PhotoStore(root, filesDir)
        buildUi()
        immersive()
        bg.execute { start() }
    }

    // ------------------------------------------------------------------ UI

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun label(t: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        text = t; setTextColor(Color.WHITE); textSize = size; if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun pill(color: Int) = android.graphics.drawable.GradientDrawable().apply { setColor(color); cornerRadius = dp(18).toFloat() }

    private fun button(t: String, color: Int = 0xCC20262C.toInt(), onClick: () -> Unit) = Button(this).apply {
        text = t; setTextColor(Color.WHITE); textSize = 15f; isAllCaps = true; background = pill(color)
        minHeight = dp(52); minimumHeight = dp(52); setPadding(dp(22), 0, dp(22), 0)
        setOnClickListener { onClick() }
    }

    private fun buildUi() {
        val root = FrameLayout(this)
        frame = FrameView(this)
        root.addView(frame, FrameLayout.LayoutParams(-1, -1))

        chip = label("", 17f, true).apply { background = pill(0xAA000000.toInt()); setPadding(dp(16), dp(8), dp(16), dp(8)); visibility = View.GONE }
        root.addView(chip, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply { setMargins(dp(20), dp(20), 0, 0) })

        centre = label("", 22f).apply { gravity = Gravity.CENTER; setPadding(dp(40), 0, dp(40), 0) }
        root.addView(centre, FrameLayout.LayoutParams(-1, -1))

        message = label("", 20f, true).apply { background = pill(0xDD000000.toInt()); setPadding(dp(24), dp(14), dp(24), dp(14)); visibility = View.GONE }
        root.addView(message, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(120) })

        controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; visibility = View.GONE }
        controls.addView(button("Search") { promptSearch() })
        pauseBtn = button("Pause") { if (state == State.PAUSED) resume() else pause() }
        controls.addView(pauseBtn, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(10) })
        controls.addView(button("Everything") { showEverything() }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(10) })
        controls.addView(button("Delete", 0xCC8E2A2A.toInt()) { requestDelete() }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(10) })
        micBtn = button("Mic off") { toggleMic() }
        controls.addView(micBtn, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(10) })
        root.addView(controls, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(0, dp(14), dp(20), 0) })

        deleteText = label("", 20f, true)
        deleteBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = pill(0xEE101418.toInt()); setPadding(dp(24), dp(12), dp(16), dp(12)); visibility = View.GONE
        }
        deleteBar.addView(deleteText, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(20) })
        deleteBar.addView(button("Yes, delete", 0xFFB3262B.toInt()) { confirmDelete() })
        deleteBar.addView(button("Cancel", 0xFF3B4650.toInt()) { cancelDelete("Delete cancelled") }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(10) })
        root.addView(deleteBar, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(32) })

        undoBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = pill(0xEE101418.toInt()); setPadding(dp(24), dp(10), dp(14), dp(10)); visibility = View.GONE
        }
        undoBar.addView(label("Moved to trash", 18f, true), LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(18) })
        undoBar.addView(button("Undo", 0xFF2563EB.toInt()) { undoDelete() })
        root.addView(undoBar, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(32) })

        val gestures = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onSingleTapUp(e: MotionEvent): Boolean { showControls(); return true }
            override fun onFling(a: MotionEvent?, b: MotionEvent, vx: Float, vy: Float): Boolean {
                if (Math.abs(vx) > Math.abs(vy) && Math.abs(vx) > 400f && state != State.CONFIRM_DELETE) { step(if (vx < 0) +1 else -1); return true }
                return false
            }
        })
        root.setOnTouchListener { _, e -> gestures.onTouchEvent(e) }
        setContentView(root)
    }

    private fun immersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive() }

    private fun showControls() {
        controls.visibility = View.VISIBLE
        ui.removeCallbacks(hideControls); ui.postDelayed(hideControls, 6000)
    }

    private fun toast(t: String, ms: Long = 3500) {
        message.text = t; message.visibility = View.VISIBLE
        ui.removeCallbacks(hideMessage); ui.postDelayed(hideMessage, ms)
    }

    private fun refreshChip() {
        val parts = ArrayList<String>()
        when (state) {
            State.FILTERED -> parts.add("“$filterLabel”  ${pos + 1} of ${playlist.size}")
            State.PAUSED -> parts.add("Paused" + if (filterLabel.isNotEmpty()) "  “$filterLabel”" else "")
            State.CONFIRM_DELETE -> parts.add("Delete?")
            else -> {}
        }
        if (indexStatus.isNotEmpty()) parts.add(indexStatus)
        chip.text = parts.joinToString("   ·   ")
        chip.visibility = if (parts.isEmpty()) View.GONE else View.VISIBLE
        pauseBtn.text = if (state == State.PAUSED) "Resume" else "Pause"
    }

    // ------------------------------------------------------------------ start-up

    private fun start() {
        store.load()
        log("library: ${store.count()} photos under ${store.root}, ${store.indexedCount()} already indexed")
        val tok = runCatching { ClipTokenizer(assets.open("clip_tokenizer.json").bufferedReader().use { it.readText() }) }.getOrNull()
        if (debuggable && tok != null && intent.getBooleanExtra("selftest", false)) {   // test hook: compare against the Python tokenizer
            for (q in listOf("a photo of seaside", "a photo of birthday cake", "a photo of kids playing", "a photo of city at night", "a photo of Rahul's dog!!", "a photo of  CAFÉ  naïve 2025", "a photo of christmas tree"))
                log("TOK '$q' -> ${tok.encode(q).joinToString(",")}")
        }
        val modelsDir = File(base, "models")
        if (tok != null) clip = ClipEngine(modelsDir, tok).takeIf { it.available }
        if (clip == null) log("search is off: CLIP models not found in $modelsDir")
        ui.post {
            if (store.count() == 0) {
                centre.text = "No photos yet.\n\nCopy photos into\n${store.root.absolutePath}\nand reopen the app."
                return@post
            }
            enterAmbient()
        }
        val c = clip
        if (c != null && store.snapshot().any { it.vec == null }) {
            indexer = Indexer(store, c, { done, total -> ui.post { indexStatus = if (done < total) "Indexing $done/$total" else ""; refreshChip() } }, { ui.post { indexStatus = ""; refreshChip(); toast("Photo search is ready") } }).also { it.start() }
        }
        (if (debuggable) intent.getStringExtra("query") else null)?.let { q -> ui.postDelayed({ search(q) }, 1500) }   // test hook: --es query beach
        ui.post(object : Runnable { override fun run() { if (destroyed) return; bg.execute { idleCheck() }; ui.postDelayed(this, 30_000) } })
    }

    /** The text tower is ~140 MB: release it after a minute without a query. */
    private fun idleCheck() {
        val c = clip ?: return
        if (c.textLoaded() && System.currentTimeMillis() - c.lastTextUse > 60_000) { c.closeText(); log("text tower released") }
    }

    // ------------------------------------------------------------------ slideshow

    private fun enterAmbient() {
        state = State.AMBIENT; filterLabel = ""
        playlist = store.snapshot().shuffled(); pos = 0
        centre.text = ""
        showCurrent(false)
    }

    private fun step(d: Int) {
        if (playlist.isEmpty()) return
        pos = (pos + d + playlist.size) % playlist.size
        if (state == State.AMBIENT && pos == 0 && d > 0) playlist = store.snapshot().shuffled()   // a full pass: reshuffle
        showCurrent()
    }

    private fun showCurrent(animate: Boolean = true) {
        ui.removeCallbacks(tick)
        if (playlist.isEmpty()) { frame.show(null, false); current = null; return }
        val p = playlist[pos.coerceIn(0, playlist.size - 1)]
        current = p
        val token = ++showToken
        decoder.execute {
            val bmp = ImagePrep.decode(File(p.path), 1200, 2200)
            ui.post {
                if (token != showToken || destroyed) return@post
                if (bmp == null) {   // drop it from this playlist instead of retrying it forever
                    log("unreadable: ${p.path}")
                    playlist = playlist.filter { it !== p }
                    if (playlist.isNotEmpty()) { pos = pos.coerceAtMost(playlist.size - 1); showCurrent() } else centre.text = "No readable photos."
                    return@post
                }
                frame.show(bmp, animate); refreshChip()
                if (state == State.AMBIENT || state == State.FILTERED) ui.postDelayed(tick, intervalMs)
            }
        }
        refreshChip()
    }

    private fun pause() {
        if (state != State.AMBIENT && state != State.FILTERED) return
        stateBeforeModal = state; state = State.PAUSED
        ui.removeCallbacks(tick); refreshChip(); toast("Paused")
    }

    private fun resume() {
        if (state != State.PAUSED) return
        state = stateBeforeModal; refreshChip(); toast("Resumed")
        ui.postDelayed(tick, intervalMs)
    }

    private fun showEverything() {
        if (state == State.PAUSED || state == State.CONFIRM_DELETE) return
        if (state == State.AMBIENT) { toast("Already showing everything"); return }
        enterAmbient(); toast("Showing everything")
    }

    // ------------------------------------------------------------------ search

    private fun promptSearch() {
        val et = EditText(this).apply { hint = "e.g. seaside, birthday cake"; inputType = InputType.TYPE_CLASS_TEXT; setSingleLine() }
        android.app.AlertDialog.Builder(this).setTitle("Search photos").setView(et)
            .setPositiveButton("Search") { _, _ -> et.text.toString().trim().takeIf { it.isNotEmpty() }?.let { search(it) } }
            .setNegativeButton("Cancel", null).show()
    }

    private fun search(q: String) {
        val c = clip
        if (c == null) { toast("Search is not set up (models missing)"); return }
        val done = store.indexedCount(); val total = store.count()
        toast("Searching for “$q”…", 8000)
        bg.execute {
            val t0 = System.nanoTime()
            val res = runCatching { store.search(c.embedText(q)) }.getOrElse { log("search failed: $it"); emptyList() }
            val ms = (System.nanoTime() - t0) / 1_000_000
            log("SEARCH '$q' -> ${res.size} photos in $ms ms (indexed $done/$total); scores ${res.take(8).joinToString { "%.3f".format(it.second) }}; top ${res.take(5).joinToString { File(it.first.path).name }}")
            ui.post {
                if (destroyed) return@post
                if (res.isEmpty()) { toast(if (done < total) "Nothing found yet - still indexing ($done of $total)" else "No photos found for “$q”"); return@post }
                state = State.FILTERED; filterLabel = q; playlist = res.map { it.first }; pos = 0
                toast("${res.size} photos for “$q”")
                showCurrent()
            }
        }
    }

    // ------------------------------------------------------------------ delete (moves to .trash; undo for a few seconds)

    private fun requestDelete() {
        val p = current ?: return
        if (state == State.CONFIRM_DELETE) return
        stateBeforeModal = state
        state = State.CONFIRM_DELETE
        ui.removeCallbacks(tick)
        deleteText.text = "Delete ${File(p.path).name}?"
        deleteBar.visibility = View.VISIBLE
        controls.visibility = View.GONE
        refreshChip()
        ui.removeCallbacks(deleteTimeout); ui.postDelayed(deleteTimeout, 12_000)
    }

    private fun closeDeleteBar() { ui.removeCallbacks(deleteTimeout); deleteBar.visibility = View.GONE; state = stateBeforeModal }

    private fun cancelDelete(msg: String) {
        if (state != State.CONFIRM_DELETE) return
        closeDeleteBar(); refreshChip(); toast(msg)
        if (state == State.AMBIENT || state == State.FILTERED) ui.postDelayed(tick, intervalMs)
    }

    private fun confirmDelete() {
        if (state != State.CONFIRM_DELETE) return
        val p = current
        closeDeleteBar()
        if (p == null) return
        val t = store.trash(p)
        if (t == null) { toast("Could not move the photo to the trash"); refreshChip(); return }
        log("TRASHED ${p.path}")
        lastTrashed = t
        playlist = playlist.filter { it !== p }
        if (playlist.isEmpty()) { if (state == State.FILTERED) enterAmbient() else { frame.show(null, false); current = null; centre.text = "No photos left." } }
        else { pos = pos.coerceAtMost(playlist.size - 1); showCurrent() }
        undoBar.visibility = View.VISIBLE
        ui.removeCallbacks(hideUndo); ui.postDelayed(hideUndo, 10_000)
    }

    private fun undoDelete() {
        val t = lastTrashed ?: return
        ui.removeCallbacks(hideUndo); undoBar.visibility = View.GONE; lastTrashed = null
        if (store.restore(t)) {
            playlist = playlist.toMutableList().also { it.add(pos.coerceAtMost(it.size), t.photo) }
            toast("Photo restored"); centre.text = ""; showCurrent()
        } else toast("Could not restore the photo")
    }

    // ------------------------------------------------------------------ voice

    private fun toggleMic() { if (micWanted) setMic(false) else setMic(true) }

    private fun setMic(on: Boolean) {
        if (on && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            toast("Please allow the microphone"); requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2); return
        }
        micWanted = on
        micBtn.text = if (on) "Mic on" else "Mic off"
        if (!on) toast("Microphone off")
        bg.execute {
            if (on) {
                val v = voice ?: run {
                    val dir = File(File(base, "models"), "vosk-model-small-en-us-0.15")
                    if (!dir.exists()) { ui.post { micWanted = false; micBtn.text = "Mic off"; toast("Voice model missing") }; return@execute }
                    Voice(dir, BASE_COMMANDS + SEARCH_WORDS.flatMap { listOf("show me $it", "show me the $it") }).also { voice = it }
                }
                v.start { text -> ui.post { onVoice(text) } }
                Thread.sleep(500)
                ui.post { if (v.isLive) toast("Listening - say “pause”, “next photo”, “show me the beach”…", 5000) else { micWanted = false; micBtn.text = "Mic off"; toast("Could not start the microphone") } }
            } else voice?.stop()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode == 2 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) setMic(true)
    }

    private fun onVoice(text: String) {
        log("VOICE '$text' (state=$state)")
        if (state == State.CONFIRM_DELETE) {   // while a delete is pending only yes / cancel count
            when { text.contains("yes") -> confirmDelete(); text.contains("cancel") -> cancelDelete("Delete cancelled") }
            return
        }
        when {
            text == "pause" -> pause()
            text == "resume" -> resume()
            text == "next photo" -> step(+1)
            text == "previous photo" -> step(-1)
            text == "delete this photo" -> requestDelete()
            text == "undo that" -> undoDelete()
            text == "show everything" -> showEverything()
            text == "slower" -> { intervalMs = (intervalMs * 3 / 2).coerceAtMost(60_000); toast("Slower: ${intervalMs / 1000} s per photo") }
            text == "faster" -> { intervalMs = (intervalMs * 2 / 3).coerceAtLeast(2_000); toast("Faster: ${intervalMs / 1000} s per photo") }
            text == "dim the screen" -> setBrightness(0.05f)
            text == "brighten the screen" -> setBrightness(-1f)
            text == "stop listening" -> setMic(false)
            text.startsWith("show me ") -> search(text.removePrefix("show me ").removePrefix("the ").trim())
        }
    }

    private fun setBrightness(v: Float) { window.attributes = window.attributes.also { it.screenBrightness = v } }

    // ------------------------------------------------------------------ lifecycle

    /** Leaving the app must never leave the microphone running. */
    override fun onStop() {
        super.onStop()
        if (micWanted) { micWanted = false; micBtn.text = "Mic off"; bg.execute { voice?.stop() } }
    }

    override fun onDestroy() {
        destroyed = true
        super.onDestroy()
        ui.removeCallbacksAndMessages(null)
        bg.shutdownNow(); decoder.shutdownNow()
        val idx = indexer; val v = voice; val c = clip
        Thread { idx?.stop(); v?.close(); c?.close() }.start()   // off the UI thread: stopping the indexer can wait for an embed in flight
    }
}
