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
import android.widget.VideoView
import android.media.MediaPlayer
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
    private lateinit var faces: FaceStore
    private lateinit var peopleStore: People
    private lateinit var ctl: PeopleController
    private lateinit var rootLayout: FrameLayout
    private lateinit var faceOverlay: FaceOverlay
    @Volatile private var facePipeline: FacePipeline? = null
    @Volatile private var faceIndexer: FaceIndexer? = null
    private var resumeAfterPeople = false
    private lateinit var settings: Settings
    private lateinit var settingsScreen: SettingsScreen
    private var presence: Presence? = null
    private var presencePipeline: FacePipeline? = null
    private var presenceFilter = false      // the current playlist was chosen by walk-up detection
    private var presenceGen = 0             // bumped on every enter/leave so a slow "enter" cannot land after the person has already left
    private var manualOverride = false      // the user searched or took control: presence leaves the show alone until they walk away
    private var micMode = 0                 // 0 off, 1 auto, 2 on
    private var visible = false
    private lateinit var nightView: View
    private var nightActive = false
    private var nightSnoozeUntil = 0L
    @Volatile private var fakeHour = -1     // debug builds: --ei fakehour N
    private var tickCount = 0
    private var cameraAsked = false
    private var filteredSince = 0L           // when a manual search result went on screen (idle timeout back to everything)

    private lateinit var frame: FrameView
    private lateinit var video: VideoView
    private var player: MediaPlayer? = null
    private var soundOn = false
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
    private val NUMBER_WORDS = listOf("one", "two", "three", "four", "five", "six")
    private val NUMBERED = Regex("^number (one|two|three|four|five|six) is (.+)$")
    /** The activity is exported (launcher), so test hooks (root / query / selftest extras) only work in debug builds. */
    private val debuggable by lazy { applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        base = getExternalFilesDir(null) ?: filesDir
        val root = (if (debuggable) intent.getStringExtra("root") else null)?.let { File(it) } ?: File(base, "photos")
        store = PhotoStore(root, filesDir)
        faces = FaceStore(filesDir); peopleStore = People(filesDir)
        buildUi()
        ctl = PeopleController(this, ui, bg, store, faces, peopleStore, faceOverlay, { t, ms -> toast(t, ms) }, { peopleChanged() }, { name -> search(name) })
        ctl.onClose = { closePeople() }
        settings = Settings(this)
        settingsScreen = SettingsScreen(this, settings, { settingsChanged() }, { closeSettings() })
        intervalMs = settings.intervalSec * 1000L; micMode = settings.micMode; frame.drift = settings.drift
        refreshMicBtn()
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
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }   // the theme's grey would show around a video
        rootLayout = root
        frame = FrameView(this)
        root.addView(frame, FrameLayout.LayoutParams(-1, -1))
        // Videos play in a VideoView that keeps its aspect ratio; it sits above the photo view and below every overlay.
        video = VideoView(this).apply { visibility = View.GONE }
        root.addView(video, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        faceOverlay = FaceOverlay(this) { frame.contentRect() }.apply { visibility = View.GONE }
        root.addView(faceOverlay, FrameLayout.LayoutParams(-1, -1))

        chip = label("", 17f, true).apply { background = pill(0xAA000000.toInt()); setPadding(dp(16), dp(8), dp(16), dp(8)); visibility = View.GONE }
        root.addView(chip, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply { setMargins(dp(20), dp(20), 0, 0) })

        centre = label("", 22f).apply { gravity = Gravity.CENTER; setPadding(dp(40), 0, dp(40), 0) }
        root.addView(centre, FrameLayout.LayoutParams(-1, -1))

        message = label("", 20f, true).apply { background = pill(0xDD000000.toInt()); setPadding(dp(24), dp(14), dp(24), dp(14)); visibility = View.GONE }
        root.addView(message, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(120) })

        controls = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END; visibility = View.GONE }
        fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
        fun gap() = LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(10); topMargin = dp(10) }
        val r1 = row(); val r2 = row()
        r1.addView(button("Search") { promptSearch() }, gap())
        pauseBtn = button("Pause") { if (state == State.PAUSED) resume() else pause() }
        r1.addView(pauseBtn, gap())
        r1.addView(button("Everything") { showEverything() }, gap())
        r1.addView(button("Delete", 0xCC8E2A2A.toInt()) { requestDelete() }, gap())
        r2.addView(button("People") { openPeople() }, gap())
        r2.addView(button("Name faces") { if (ctl.naming) endNaming() else startNamingMode() }, gap())
        micBtn = button("Mic off") { toggleMic() }
        r2.addView(micBtn, gap())
        r2.addView(button("Settings") { openSettings() }, gap())
        controls.addView(r1); controls.addView(r2)
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

        nightView = View(this).apply { setBackgroundColor(Color.BLACK); visibility = View.GONE; isClickable = true; setOnClickListener { snoozeNight() } }
        root.addView(nightView, FrameLayout.LayoutParams(-1, -1))

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
        if (presence?.running == true) parts.add("\u25CF Camera on")
        if (micWanted) parts.add("\u25CF Mic on")
        chip.text = parts.joinToString("   ·   ")
        chip.visibility = if (parts.isEmpty()) View.GONE else View.VISIBLE
        pauseBtn.text = if (state == State.PAUSED) "Resume" else "Pause"
    }

    // ------------------------------------------------------------------ start-up

    private fun start() {
        store.load(); faces.load(); peopleStore.load()
        store.purgeTrash(30).let { if (it > 0) log("trash: purged $it files older than 30 days") }
        log("library: ${store.count()} photos under ${store.root}, ${store.indexedCount()} already indexed")
        val tok = runCatching { ClipTokenizer(assets.open("clip_tokenizer.json").bufferedReader().use { it.readText() }) }.getOrNull()
        if (debuggable && tok != null && intent.getBooleanExtra("selftest", false)) {   // test hook: compare against the Python tokenizer
            for (q in listOf("a photo of seaside", "a photo of birthday cake", "a photo of kids playing", "a photo of city at night", "a photo of Rahul's dog!!", "a photo of  CAFÉ  naïve 2025", "a photo of christmas tree"))
                log("TOK '$q' -> ${tok.encode(q).joinToString(",")}")
        }
        val modelsDir = File(base, "models")
        if (debuggable && tok != null && intent.getBooleanExtra("equiv", false)) equivDump(tok, modelsDir)
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
        if (c != null && store.snapshot().any { it.vecs == null }) {
            indexer = Indexer(store, c, { done, total -> ui.post { indexStatus = if (done < total) "Indexing $done/$total" else ""; refreshChip() } },
                { ui.post { indexStatus = ""; refreshChip(); toast("Photo search is ready") }; bg.execute { startFaceIndexing() } }).also { it.start() }
        } else startFaceIndexing()
        if (debuggable) debugHooks()
        ui.post(object : Runnable { override fun run() { if (destroyed) return; applyMic(); if (++tickCount % 30 == 1) checkNight()
                if (state == State.FILTERED && !presenceFilter && System.currentTimeMillis() - filteredSince > 10 * 60_000L) { enterAmbient(); toast("Back to everything") }
                ui.postDelayed(this, 1000) } })
        (if (debuggable) intent.getStringExtra("query") else null)?.let { q -> ui.postDelayed({ search(q) }, 1500) }   // test hook: --es query beach
        ui.post(object : Runnable { override fun run() { if (destroyed) return; bg.execute { idleCheck() }; ui.postDelayed(this, 30_000) } })
    }

    /**
     * Debug hook for the desktop equivalence test: reads relative photo paths from `<files>/equiv/list.txt` and writes, per photo,
     * the CLIP input tensor (`N.f32`, little-endian) and the final embedding (`N.vec`), so they can be compared with the Python pipeline.
     */
    private fun equivDump(tok: ClipTokenizer, modelsDir: File) {
        val dir = File(base, "equiv")
        val list = File(dir, "list.txt").takeIf { it.exists() }?.readLines()?.filter { it.isNotBlank() } ?: return
        val c = ClipEngine(modelsDir, tok).takeIf { it.available } ?: return
        fun le(a: FloatArray) = java.nio.ByteBuffer.allocate(a.size * 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).also { it.asFloatBuffer().put(a) }.array()
        list.forEachIndexed { i, rel ->
            log("EQUIV $i colour space: " + (ImagePrep.decode(File(store.root, rel), 448, 0, 8)?.let { ImagePrep.colorSpaceName(it) }))
            val t = ImagePrep.clipInput(File(store.root, rel)) ?: return@forEachIndexed
            File(dir, "$i.f32").writeBytes(le(t)); File(dir, "$i.vec").writeBytes(le(c.embedImage(t)))
        }
        c.close(); log("EQUIV wrote ${list.size} entries to $dir")
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
        if (p.video) { showVideo(p, token); refreshChip(); return }
        video.stopPlayback(); video.visibility = View.GONE; player = null; frame.visibility = View.VISIBLE
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
                if (ctl.naming) { ctl.stopNaming(); ctl.startNaming(p) }   // moved to another photo while naming: show its faces
                if (state == State.AMBIENT || state == State.FILTERED) ui.postDelayed(tick, intervalMs)
            }
        }
        refreshChip()
    }

    /** Videos play once, muted unless "sound on", then the show moves on; a long video is cut off after 30 s so the frame never sticks. */
    private fun showVideo(p: Photo, token: Int) {
        frame.visibility = View.GONE; video.visibility = View.VISIBLE
        video.setOnPreparedListener { mp ->
            if (token != showToken || destroyed) return@setOnPreparedListener
            player = mp; mp.isLooping = false
            mp.setVolume(if (soundOn) 1f else 0f, if (soundOn) 1f else 0f)
            if (state == State.AMBIENT || state == State.FILTERED) {
                mp.start()
                ui.removeCallbacks(tick); ui.postDelayed(tick, minOf(mp.duration.toLong(), 30_000L) + 800)
            } else mp.seekTo(1)   // paused or confirming a delete: show the first frame, do not play
        }
        video.setOnCompletionListener { if (token == showToken && (state == State.AMBIENT || state == State.FILTERED)) step(+1) }
        video.setOnErrorListener { _, _, _ ->
            if (token == showToken) {   // unplayable: drop it from this playlist
                log("unplayable video: ${p.path}")
                playlist = playlist.filter { it !== p }
                if (playlist.isNotEmpty()) { pos = pos.coerceAtMost(playlist.size - 1); showCurrent() } else centre.text = "No playable photos."
            }
            true
        }
        video.setVideoPath(p.path)
    }

    /** What to do with a playing video when the show pauses / resumes. */
    private fun setVideoPlaying(on: Boolean) {
        if (current?.video != true) return
        if (on) video.start() else video.pause()
    }

    /** Next advance: a video ends by itself (with a safety timer), a photo after the interval. */
    private fun scheduleNext() {
        ui.removeCallbacks(tick)
        ui.postDelayed(tick, if (current?.video == true) 35_000L else intervalMs)
    }

    private fun pause() {
        if (state != State.AMBIENT && state != State.FILTERED) return
        stateBeforeModal = state; state = State.PAUSED
        ui.removeCallbacks(tick); setVideoPlaying(false); refreshChip(); toast("Paused")
    }

    private fun resume() {
        if (state != State.PAUSED) return
        state = stateBeforeModal; refreshChip(); toast("Resumed")
        setVideoPlaying(true); scheduleNext()
    }

    private fun showEverything() {
        userAction()
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
        userAction()
        val (ps, rest) = ctl.parseQuery(q)
        if (ps.isNotEmpty()) { searchPeople(ps, rest); return }
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
                state = State.FILTERED; filterLabel = q; playlist = res.map { it.first }; pos = 0; filteredSince = System.currentTimeMillis()
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
        ui.removeCallbacks(tick); setVideoPlaying(false)
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
        if (state == State.AMBIENT || state == State.FILTERED) { setVideoPlaying(true); scheduleNext() }
    }

    private fun confirmDelete() {
        if (state != State.CONFIRM_DELETE) return
        val p = current
        closeDeleteBar()
        if (p == null) return
        if (p.video) { video.stopPlayback(); player = null }   // release the file before moving it
        val t = store.trash(p)
        if (t == null) { toast("Could not move the photo to the trash"); refreshChip(); return }
        log("TRASHED ${p.path}")
        faces.forget(p.path)
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
            bg.execute { startFaceIndexing() }   // its faces were forgotten when it was trashed
        } else toast("Could not restore the photo")
    }

    // ------------------------------------------------------------------ walk-up detection, settings, night mode

    private fun userAction() { manualOverride = true; presenceFilter = false }

    /** Starts or stops the camera loop to match the setting. The camera runs only while the app is visible, not at night, and someone is named. */
    private fun applyPresence() {
        val want = settings.presence && visible && !nightActive
        if (!want) { presence?.stop(); refreshChip(); return }
        if (peopleStore.all().isEmpty()) { toast("Walk-up detection needs at least one named person - open People", 5000); return }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (!cameraAsked) { cameraAsked = true; requestPermissions(arrayOf(Manifest.permission.CAMERA), 3) } else toast("Walk-up detection needs the camera permission", 5000)
            return
        }
        val p = ensurePresence()
        p.leaveMs = settings.leaveSec * 1000L
        if (!p.running) bg.execute {
            if (presencePipeline == null) presencePipeline = runCatching { FacePipeline(assets.open("yunet.onnx").readBytes(), assets.open("sface.onnx").readBytes()) }.getOrNull()
            ui.post { if (visible && settings.presence && !nightActive) { p.start(); refreshChip(); log("PRESENCE camera started") } }
        }
    }

    private fun ensurePresence(): Presence = presence ?: Presence(this, peopleStore, { presencePipeline },
        { _ -> }, { known -> ui.post { presenceEnter(known) } }, { ui.post { presenceLeave() } },
        { msg -> ui.post { toast("Camera: $msg", 5000); refreshChip() } }).also { presence = it }

    /** One or more known people walked up (the same group seen several times in a row): show their photos. */
    private fun presenceEnter(known: List<Person>) {
        if (manualOverride || nightActive || ctl.naming || ctl.screenOpen || settingsScreen.isOpen || state == State.PAUSED || state == State.CONFIRM_DELETE) return
        // Privacy: a "private" person's photos appear only when they are recognised alone.
        val eff = if (known.size > 1) known.filter { !it.private } else known
        if (eff.isEmpty()) return
        val gen = ++presenceGen
        bg.execute {
            val (cand, all) = ctl.photosWith(eff, settings.allOfThem)
            log("PRESENCE saw ${eff.joinToString { it.name }} -> ${cand.size} photos (all-of=$all)")
            if (cand.isEmpty()) return@execute
            ui.post {
                if (destroyed || gen != presenceGen || manualOverride || state == State.PAUSED || state == State.CONFIRM_DELETE) return@post
                presenceFilter = true; state = State.FILTERED
                filterLabel = eff.joinToString(" & ") { it.name }; playlist = cand.shuffled().take(300); pos = 0
                showCurrent()
            }
        }
    }

    /** Nobody known for the leave time: back to the whole library. */
    private fun presenceLeave() {
        presenceGen++
        if (presenceFilter) { presenceFilter = false; if (state == State.FILTERED) enterAmbient() }
        manualOverride = false
        log("PRESENCE left")
    }

    private fun openSettings() {
        if (settingsScreen.isOpen) return
        resumeAfterPeople = state == State.AMBIENT || state == State.FILTERED
        if (resumeAfterPeople) pause()
        controls.visibility = View.GONE
        settingsScreen.show(rootLayout)
    }

    private fun closeSettings() {
        settingsScreen.hide()
        if (resumeAfterPeople) { resumeAfterPeople = false; resume() }
    }

    private fun settingsChanged() {
        intervalMs = settings.intervalSec * 1000L; micMode = settings.micMode; refreshMicBtn()
        frame.drift = settings.drift && !ctl.naming; frame.invalidate()
        presence?.leaveMs = settings.leaveSec * 1000L
        if (!settings.presence) presence?.stop()
        applyPresence(); applyMic(); checkNight(); refreshChip()
    }

    private fun checkNight() {
        val hour = if (fakeHour >= 0) fakeHour else java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        val night = settings.isNight(hour) && System.currentTimeMillis() >= nightSnoozeUntil
        if (night && !nightActive) enterNight() else if (!night && nightActive) exitNight()
    }

    /** Night: screen black and dimmed, slideshow stopped, camera and microphone off. A touch wakes it for 10 minutes. */
    private fun enterNight() {
        nightActive = true; nightView.visibility = View.VISIBLE
        ui.removeCallbacks(tick); setVideoPlaying(false); setBrightness(0.01f)
        presence?.stop(); applyMic(); refreshChip(); log("NIGHT on")
    }

    private fun exitNight() {
        nightActive = false; nightView.visibility = View.GONE
        setBrightness(-1f); setVideoPlaying(true)
        if (state == State.AMBIENT || state == State.FILTERED) scheduleNext()
        applyPresence(); applyMic(); refreshChip(); log("NIGHT off")
    }

    private fun snoozeNight() { nightSnoozeUntil = System.currentTimeMillis() + 10 * 60_000L; exitNight() }

    // ------------------------------------------------------------------ faces and people

    /** After the search index: find the faces in every photo (resumable), then free the face models again. */
    private fun startFaceIndexing() {
        if (faceIndexer != null || store.snapshot().none { !it.video && !faces.has(it) }) return
        val fp = runCatching { FacePipeline(assets.open("yunet.onnx").readBytes(), assets.open("sface.onnx").readBytes()) }.getOrNull() ?: return
        facePipeline = fp
        faceIndexer = FaceIndexer(store, faces, fp,
            { done, total -> ui.post { indexStatus = if (done < total) "Finding faces $done/$total" else ""; refreshChip() } },
            { ui.post { indexStatus = ""; refreshChip(); toast("Faces found - open People to name them") }; facePipeline?.close(); facePipeline = null; faceIndexer = null }).also { it.start() }
    }

    /** People were added, renamed or removed: voice must learn the new names, and "who is in which photo" is rebuilt on demand. */
    private fun peopleChanged() {
        val v = voice ?: return
        bg.execute {
            v.setPhrases(voicePhrases())
            if (micWanted) { v.stop(); v.start { text -> ui.post { onVoice(text) } } }
        }
    }

    /** Fixed commands, "show me <scene>", and for every known person: "photos of <name>", "<name> at the <scene>", "this is <name>". */
    private fun voicePhrases(): List<String> {
        val out = ArrayList(BASE_COMMANDS + SEARCH_WORDS.flatMap { listOf("show me $it", "show me the $it") })
        for (p in peopleStore.all()) {
            val n = p.name.lowercase()
            out += listOf("photos of $n", "show me $n", "this is $n"); out += NUMBER_WORDS.map { "number $it is $n" }
            out += SEARCH_WORDS.take(24).map { "$n at the $it" }
        }
        return out
    }

    private fun searchPeople(ps: List<Person>, rest: String) {
        val names = ps.joinToString(" & ") { it.name }
        toast("Looking for $names...", 8000)
        bg.execute {
            val (cand, all) = ctl.photosWith(ps)
            val c = clip
            val res: List<Photo> =
                if (rest.isNotEmpty() && c != null && cand.isNotEmpty())
                    runCatching { store.search(c.embedText(rest), 60, 0.08f, 0.15f, cand.map { it.path }.toSet()).map { it.first } }.getOrDefault(emptyList())
                else cand.shuffled().take(300)
            log("PEOPLE '$names' rest='$rest' -> ${res.size} photos (candidates ${cand.size}, all-of=$all, faces scanned ${faces.scannedCount()})")
            ui.post {
                if (destroyed) return@post
                val scanning = if (indexStatus.startsWith("Finding faces")) " (faces are still being scanned)" else ""
                if (res.isEmpty()) { toast("No photos found for $names${if (rest.isNotEmpty()) " $rest" else ""}$scanning"); return@post }
                state = State.FILTERED; filterLabel = if (rest.isEmpty()) names else "$names · $rest"; playlist = res; pos = 0; filteredSince = System.currentTimeMillis()
                toast((if (all) "" else "No photo has all of them - showing any. ") + "${res.size} photos$scanning")
                showCurrent()
            }
        }
    }

    private fun openPeople() {
        if (ctl.screenOpen) return
        resumeAfterPeople = state == State.AMBIENT || state == State.FILTERED
        if (resumeAfterPeople) pause()
        controls.visibility = View.GONE
        ctl.showScreen(rootLayout)
    }

    private fun closePeople() {
        ctl.hideScreen()
        if (resumeAfterPeople) { resumeAfterPeople = false; resume() }
    }

    private var pausedByNaming = false

    private fun startNamingMode() {
        pausedByNaming = state == State.AMBIENT || state == State.FILTERED
        if (pausedByNaming) pause()
        if (!ctl.startNaming(current)) { if (pausedByNaming) { pausedByNaming = false; resume() }; return }
        frame.drift = false
        controls.visibility = View.GONE
    }

    private fun endNaming() {
        ctl.stopNaming(); frame.drift = settings.drift; frame.invalidate()
        if (pausedByNaming) { pausedByNaming = false; resume() }   // only undo a pause that naming itself made
    }

    /** Debug-build test hooks (adb): --ez people true opens the People screen; --es nameclusters "A,B" names the biggest face groups in order. */
    private fun debugHooks() {
        intent.getStringExtra("nameclusters")?.let { csv ->
            ui.postDelayed({
                bg.execute {
                    val cl = Clusters.build(faces.all(), peopleStore)
                    csv.split(",").filter { it.isNotBlank() }.forEachIndexed { i, n -> cl.getOrNull(i)?.let { c ->
                        val p = peopleStore.assign(n, c.members.sortedByDescending { it.widthPx * it.score }.take(6).map { it.emb })
                        log("NAMED cluster $i (${c.members.size} faces, ${c.photos} photos) as ${p.name}")
                    } }
                    peopleChanged()
                }
            }, 1500)
        }
        if (intent.getBooleanExtra("presence_inject", false)) ui.postDelayed({ Thread {
            val path = ctl.personIndex().entries.firstOrNull { it.value.size >= 2 }?.key ?: run { log("PRESENCE inject: no photo with two known people"); return@Thread }
            if (presencePipeline == null) presencePipeline = FacePipeline(assets.open("yunet.onnx").readBytes(), assets.open("sface.onnx").readBytes())
            val raw = ImagePrep.decodeRaw(File(path), 640, 8) ?: return@Thread
            val pr = ensurePresence(); pr.leaveMs = 6_000
            log("PRESENCE inject ${File(path).name} x${pr.enterTicks}")
            repeat(pr.enterTicks) { pr.debugInject(raw.px, raw.w, raw.h) }
            Thread.sleep(8000)
            log("PRESENCE inject: now sending empty frames to test leaving")
            val blank = IntArray(640 * 480) { 0xFF202020.toInt() }
            repeat(3) { pr.debugInject(blank, 640, 480); Thread.sleep(3000) }
        }.start() }, 5000)
        if (intent.getBooleanExtra("clearpeople", false)) { peopleStore.clear(); log("people cleared (faces kept)") }
        if (intent.getBooleanExtra("people", false)) ui.postDelayed({ openPeople() }, 2500)
        if (intent.hasExtra("presence_on")) { settings.presence = intent.getBooleanExtra("presence_on", false); ui.post { settingsChanged() } }
        if (intent.hasExtra("micmode")) { settings.micMode = intent.getIntExtra("micmode", 0); ui.post { micMode = settings.micMode; refreshMicBtn(); applyMic() } }
        if (intent.hasExtra("fakehour")) { fakeHour = intent.getIntExtra("fakehour", -1); ui.post { checkNight() } }
        if (intent.getBooleanExtra("settings", false)) ui.postDelayed({ openSettings() }, 2500)
        if (intent.getBooleanExtra("clusters", false)) bg.execute {
            val cl = Clusters.build(faces.all(), peopleStore)
            log("CLUSTERS ${cl.size} groups from ${faces.all().size} faces in ${faces.scannedCount()} photos; sizes ${cl.take(12).joinToString { "${it.members.size}/${it.photos}p" }}")
        }
    }

    // ------------------------------------------------------------------ voice

    private fun refreshMicBtn() { micBtn.text = "Mic: " + arrayOf("off", "auto", "on")[micMode] }

    /** Cycles OFF -> AUTO (only while a known or unknown face is in view) -> ON. */
    private fun toggleMic() {
        micMode = (micMode + 1) % 3; settings.micMode = micMode; refreshMicBtn()
        toast(arrayOf("Microphone off", "Microphone auto: listens only while someone is in front of the camera", "Microphone on: always listening")[micMode], 4500)
        if (micMode == 1 && settings.presence.not()) toast("Auto needs walk-up detection - turn it on in Settings", 5000)
        applyMic()
    }

    /** Starts or stops the microphone to match the mode. Cheap; called every second. */
    private fun applyMic() {
        val p = presence
        val want = visible && !nightActive && (micMode == 2 || (micMode == 1 && p != null && p.running && System.currentTimeMillis() - p.lastFaceAt < 5000))
        if (want != micWanted) setMic(want, quiet = true)
    }

    private fun setMic(on: Boolean, quiet: Boolean = false) {
        if (on && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            toast("Please allow the microphone"); requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2); return
        }
        micWanted = on
        refreshMicBtn(); refreshChip()
        if (!on && !quiet) toast("Microphone off")
        bg.execute {
            if (on) {
                val v = voice ?: run {
                    val dir = File(File(base, "models"), "vosk-model-small-en-us-0.15")
                    if (!dir.exists()) { ui.post { micWanted = false; refreshChip(); toast("Voice model missing") }; return@execute }
                    Voice(dir, voicePhrases()).also { voice = it }
                }
                v.start { text -> ui.post { onVoice(text) } }
                Thread.sleep(500)
                ui.post { if (v.isLive) { if (!quiet) toast("Listening - say “pause”, “next photo”, “show me the beach”…", 5000) } else { micWanted = false; micMode = 0; settings.micMode = 0; refreshMicBtn(); refreshChip(); toast("Could not start the microphone - listening is off") } }
            } else voice?.stop()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode == 2 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) applyMic()
        if (requestCode == 3 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) applyPresence()
    }

    private fun onVoice(text: String) {
        log("VOICE '$text' (state=$state)")
        if (ctl.screenOpen || settingsScreen.isOpen || nightActive) { if (text == "stop listening") { micMode = 0; settings.micMode = 0; refreshMicBtn(); applyMic() }; return }
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
            text == "slower" -> { intervalMs = (intervalMs * 3 / 2).coerceAtMost(60_000); settings.intervalSec = (intervalMs / 1000).toInt(); toast("Slower: ${intervalMs / 1000} s per photo") }
            text == "faster" -> { intervalMs = (intervalMs * 2 / 3).coerceAtLeast(2_000); settings.intervalSec = (intervalMs / 1000).toInt(); toast("Faster: ${intervalMs / 1000} s per photo") }
            text == "name the faces" -> startNamingMode()
            text == "done" -> if (ctl.naming) endNaming()
            text == "skip" -> if (ctl.naming) toast("Skipped - tap a face to name it later")
            text == "show people" -> openPeople()
            text.startsWith("this is ") -> ctl.voiceName(tidyName(text.removePrefix("this is ")) ?: "", null)
            NUMBERED.matchEntire(text) != null -> NUMBERED.matchEntire(text)!!.let { m ->
                ctl.voiceName(tidyName(m.groupValues[2]) ?: "", NUMBER_WORDS.indexOf(m.groupValues[1]) + 1) }
            text.startsWith("photos of ") -> search(text.removePrefix("photos of ").trim())
            text == "sound on" -> { soundOn = true; player?.setVolume(1f, 1f); toast("Sound on") }
            text == "sound off" -> { soundOn = false; player?.setVolume(0f, 0f); toast("Sound off") }
            text == "dim the screen" -> setBrightness(0.05f)
            text == "brighten the screen" -> setBrightness(-1f)
            text == "stop listening" -> { micMode = 0; settings.micMode = 0; refreshMicBtn(); applyMic() }
            text.startsWith("show me ") -> search(text.removePrefix("show me ").removePrefix("the ").trim())
            ctl.parseQuery(text).first.isNotEmpty() -> search(text)   // "ritu at the beach"
        }
    }

    private fun setBrightness(v: Float) { window.attributes = window.attributes.also { it.screenBrightness = v } }

    // ------------------------------------------------------------------ lifecycle

    /** Leaving the app must never leave the microphone running. */
    override fun onStop() {
        super.onStop()
        visible = false
        presence?.stop(); refreshChip()
        if (micWanted) { micWanted = false; refreshChip(); bg.execute { voice?.stop() } }   // applyMic restarts it when the app is back, if the mode wants it
    }

    override fun onStart() {
        super.onStart()
        visible = true
        applyPresence(); applyMic(); checkNight()
    }

    override fun onDestroy() {
        destroyed = true
        super.onDestroy()
        ui.removeCallbacksAndMessages(null)
        bg.shutdownNow(); decoder.shutdownNow()
        val idx = indexer; val fi = faceIndexer; val v = voice; val c = clip; val fp = facePipeline; val pr = presence; val pp = presencePipeline
        Thread { pr?.destroy(); idx?.stop(); fi?.stop(); v?.close(); c?.close(); fp?.close(); pp?.close() }.start()   // off the UI thread: stopping the indexer can wait for an embed in flight
    }
}
