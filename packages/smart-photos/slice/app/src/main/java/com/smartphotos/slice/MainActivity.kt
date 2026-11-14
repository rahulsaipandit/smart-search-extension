package com.smartphotos.slice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.ToneGenerator
import android.view.TextureView
import android.widget.FrameLayout
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.media.Image
import android.media.ImageReader
import android.os.BatteryManager
import android.os.Bundle
import android.os.Debug
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import android.view.Gravity
import android.view.Surface
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Vertical slice for the Smart Photos runtime decision (docs/SmartPhotos.md §12.1).
 * Modes (intent extra `mode`): live (default), xcheck, speechfile, soak (+ `minutes`).
 * Camera frames are processed in memory and never stored; only numbers go to the report.
 */
class MainActivity : Activity() {
    private var view: TextView? = null
    private var guide: GuideView? = null
    private var btnBox: LinearLayout? = null
    private val buttons = LinkedHashMap<String, Button>()
    @Volatile private var sensorOrientation = 270
    private var tone: ToneGenerator? = null
    private var argbBuf = IntArray(1280 * 960)
    private val previewBufs = arrayOf(arrayOfNulls<android.graphics.Bitmap>(1), arrayOfNulls<android.graphics.Bitmap>(1))
    private var previewIdx = 0
    private var lastPreview = 0L
    private var previewOut = IntArray(0)   // reused every preview frame (camera thread only)
    private val dummyAligned = FloatArray(3 * 112 * 112) { (it % 251).toFloat() }
    private val engine = EnrollEngine { ev -> onEngineEvent(ev) }
    private val report = StringBuilder()
    private lateinit var reportFile: File
    private lateinit var filesRoot: File
    private val mode by lazy { intent.getStringExtra("mode") ?: "live" }

    private fun log(line: String) {
        android.util.Log.i("SLICE", line)
        synchronized(report) { report.append(line).append('\n'); runCatching { reportFile.appendText(line + "\n") } }
    }

    private var pipeline: FacePipeline? = null
    private var voice: VoiceCommands? = null
    private val worker = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val camThread = HandlerThread("cam").also { it.start() }
    private val camHandler = Handler(camThread.looper)
    private var camera: CameraDevice? = null

    // live state
    @Volatile private var status = "starting"
    @Volatile private var lastVoice = "(none yet)"
    private var ticks = 0; private var realFaces = 0; private var synthEmbeds = 0
    private val convMs = ArrayList<Double>(); private val detMs = ArrayList<Double>(); private val embMs = ArrayList<Double>()
    private var voiceFinals = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        filesRoot = getExternalFilesDir(null) ?: filesDir
        reportFile = File(filesRoot, "slice-$mode.txt").also { it.writeText("") }
        if (mode == "live") buildLiveUi()
        else {
            view = TextView(this).apply { textSize = 13f; typeface = android.graphics.Typeface.MONOSPACE; setPadding(24, 16, 24, 16) }
            setContentView(ScrollView(this).apply { addView(view) })
        }
        val need = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (need.isNotEmpty()) { guide?.loadMsg = "Please allow camera and microphone"; requestPermissions(need.toTypedArray(), 1) } else begin()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && mode == "live") @Suppress("DEPRECATION") window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

    // ------------------------------------------------------------------ live UI (enrolment + recognition test)

    private fun styledButton(key: String, label: String, color: Int, onClick: () -> Unit): Button = Button(this).apply {
        text = label; setTextColor(Color.WHITE); textSize = 20f; isAllCaps = true; typeface = android.graphics.Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply { setColor(color); cornerRadius = 24f }; tag = color; setOnClickListener { onClick(); refreshButtons(engine.phase) }
    }.also { buttons[key] = it; btnBox!!.addView(it, LinearLayout.LayoutParams(0, 0, 1f)) }

    private fun buildLiveUi() {
        val stage = FrameLayout(this).apply { setBackgroundColor(0xFF101418.toInt()) }
        val g = GuideView(this).also { guide = it }
        stage.addView(g, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val box = LinearLayout(this).also { btnBox = it }
        stage.addView(box, FrameLayout.LayoutParams(10, 10))
        styledButton("start", "Start", 0xFF1FA85A.toInt()) { engine.start(false) }
        styledButton("cancel", "Cancel", 0xFF3B4650.toInt()) { engine.cancel() }
        styledButton("add", "Add person", 0xFF2563EB.toInt()) { engine.start(true) }
        styledButton("name", "Name", 0xFF0E7490.toInt()) { nameRecognised() }
        styledButton("redo", "Start over", 0xFF3B4650.toInt()) { confirmStartOver() }
        loadEnrollment()
        refreshButtons(Phase.LOADING)
        g.onCycleListen = { cycleListen() }
        g.onLayoutRects = { _, br, horizontal ->
            // Rebuild the row from scratch on every layout change so no stale LayoutParams can survive a rotation.
            box.removeAllViews()
            box.orientation = if (horizontal) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            box.layoutParams = FrameLayout.LayoutParams(br.width(), br.height()).apply { leftMargin = br.left; topMargin = br.top }
            val gap = (br.height() * 0.03f).toInt()
            for (b in buttons.values) {
                val lp = if (horizontal) LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { setMargins(gap, 0, gap, 0) }
                         else LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { setMargins(0, gap, 0, gap) }
                box.addView(b, lp)
            }
            box.requestLayout()
        }
        setContentView(stage)
        runCatching { tone = ToneGenerator(AudioManager.STREAM_MUSIC, 80) }
    }

    private fun refreshButtons(phase: Phase) {
        val show = when (phase) {
            Phase.READY -> listOf("start")
            Phase.COUNTDOWN, Phase.ENROLLING -> listOf("cancel")
            Phase.MATCHING -> listOf("add", "name", "redo")
            else -> emptyList()
        }
        for ((k, b) in buttons) {
            b.visibility = if (k in show) View.VISIBLE else View.GONE
            if (k == "name") {
                val t = guide?.snap?.takeIf { it.recognised }?.name?.let { "Rename $it" } ?: "Name this person"
                if (b.text.toString() != t) b.text = t
            }
        }
    }

    private val enrollFile by lazy { File(filesDir, "enrollment.json") }   // app-private; holds face embeddings (biometric), never photos

    @Synchronized private fun saveEnrollment() = runCatching {
        val people = engine.export()
        if (people.isEmpty()) { enrollFile.delete(); log("SAVED enrolment: nobody (file removed)"); return@runCatching }
        val arr = org.json.JSONArray()
        for (p in people) arr.put(org.json.JSONObject().put("name", p.name ?: org.json.JSONObject.NULL).put("embeddings",
            org.json.JSONArray().also { es -> for (e in p.embs) es.put(org.json.JSONArray().also { a -> e.forEach { a.put(it.toDouble()) } }) }))
        // Write-then-rename so a crash mid-write can never leave a half-written (unreadable) enrolment.
        val tmp = File(enrollFile.parentFile, "enrollment.json.tmp")
        tmp.writeText(org.json.JSONObject().put("people", arr).toString())
        if (!tmp.renameTo(enrollFile)) { enrollFile.delete(); tmp.renameTo(enrollFile) }
        log("SAVED ${people.size} people: " + people.joinToString { "${it.name ?: "(no name)"}=${it.embs.size}" })
        if (people.size > 1) log(engine.separationReport())
    }.onFailure { log("save failed $it") }

    private fun parsePerson(j: org.json.JSONObject): Person {
        val arr = j.getJSONArray("embeddings")
        val embs = List(arr.length()) { i -> val a = arr.getJSONArray(i); FloatArray(a.length()) { k -> a.getDouble(k).toFloat() } }
            .filter { it.size == 128 }   // SFace dimension; anything else would index out of bounds when matching
        return Person(if (j.isNull("name")) null else tidyName(j.getString("name")), embs)
    }

    private fun loadEnrollment() = runCatching {
        if (!enrollFile.exists()) return@runCatching
        val j = org.json.JSONObject(enrollFile.readText())
        val list = if (j.has("people")) { val a = j.getJSONArray("people"); List(a.length()) { parsePerson(a.getJSONObject(it)) } } else listOf(parsePerson(j))   // old single-person file
        engine.restore(list.filter { it.embs.isNotEmpty() })
        log("LOADED ${list.size} people: " + list.joinToString { "${it.name ?: "(no name)"}=${it.embs.size}" })
    }.onFailure { log("load failed $it") }

    /** Asks for a name for person [idx]; used right after a scan ("Who is this?") and by the Name button. */
    private fun showNameDialog(idx: Int, title: String) {
        val et = android.widget.EditText(this).apply { setText(engine.nameOf(idx) ?: ""); setSingleLine(); textSize = 28f; setPadding(40, 30, 40, 30) }
        android.app.AlertDialog.Builder(this).setTitle(title).setView(et)
            .setPositiveButton("Save") { _, _ -> engine.rename(idx, et.text.toString()); refreshButtons(engine.phase) }
            .setNegativeButton("Skip", null).show()
    }

    private fun nameRecognised() {
        val idx = engine.recognisedNow()
        if (idx < 0) android.widget.Toast.makeText(this, "Face the camera first so I know who to name", android.widget.Toast.LENGTH_LONG).show()
        else showNameDialog(idx, "What should I call this person?")
    }

    private fun confirmStartOver() {
        val who = engine.export().joinToString(", ") { it.name ?: "(no name)" }
        android.app.AlertDialog.Builder(this).setTitle("Erase saved faces and start over?")
            .setMessage("This will permanently overwrite the face data saved for: $who.\n\nEveryone will have to be scanned again. This cannot be undone.")
            .setPositiveButton("Erase and start over") { _, _ -> engine.startOver() }.setNegativeButton("Keep my faces", null).show()
    }

    private fun onEngineEvent(ev: String) {
        log("EVENT $ev")
        if (ev == "done" || ev == "name" || ev == "reset") thread { saveEnrollment() }
        if (ev == "done") runOnUiThread { if (!isFinishing && !destroyed) showNameDialog(engine.newIdx, "Face saved. Who is this?") }
        val t = tone ?: return
        runCatching {
            when (ev) {
                "start", "go" -> t.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
                "capture", "name" -> t.startTone(ToneGenerator.TONE_PROP_ACK, 160)
                "done" -> t.startTone(ToneGenerator.TONE_PROP_PROMPT, 400)
                "skip" -> t.startTone(ToneGenerator.TONE_PROP_NACK, 200)
            }
        }
    }

    private fun currentRot(): Int {
        @Suppress("DEPRECATION") val disp = when (windowManager.defaultDisplay.rotation) { Surface.ROTATION_90 -> 90; Surface.ROTATION_180 -> 180; Surface.ROTATION_270 -> 270; else -> 0 }
        return (sensorOrientation + disp) % 360
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode == 2) {   // microphone asked for from the mic icon
            val ok = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            android.widget.Toast.makeText(this, if (ok) "Microphone allowed - tap the mic icon again" else "Microphone permission denied - voice stays off", android.widget.Toast.LENGTH_LONG).show()
            return
        }
        // Without the camera there is nothing to run; opening it would throw SecurityException on the worker thread.
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            guide?.fatal = "Camera permission is needed. Allow it in Settings and reopen the app."
            view?.text = "Camera permission denied"; return
        }
        begin()
    }

    @Volatile private var destroyed = false
    private var reader: ImageReader? = null
    private var begun = false
    private fun begin() {
        if (begun) return; begun = true
        thread(name = "slice-main") {
            runCatching { run() }.onFailure { log("FATAL $it\n${it.stackTraceToString()}"); ui("FATAL: $it") }
        }
    }

    private fun ui(text: String) = runOnUiThread { view?.text = text; guide?.fatal = if (text.startsWith("FATAL")) text else null }

    private fun loadPipeline() {
        if (pipeline != null) return
        val t0 = System.nanoTime()
        pipeline = FacePipeline(assets.open("yunet.onnx").readBytes(), assets.open("sface.onnx").readBytes())
        log("face pipeline loaded in ${(System.nanoTime() - t0) / 1_000_000} ms; pss=${pssMb()} MB")
    }

    private fun loadVoice(): Boolean {
        if (voice != null) return true
        val dir = File(filesRoot, "vosk-model-small-en-us-0.15")
        if (!dir.exists()) { log("no vosk model at $dir"); return false }
        val t0 = System.nanoTime()
        voice = VoiceCommands(dir)
        log("vosk model loaded in ${(System.nanoTime() - t0) / 1_000_000} ms; pss=${pssMb()} MB")
        return true
    }

    private fun run() {
        log("slice mode=$mode abi=${android.os.Build.SUPPORTED_ABIS.joinToString()} 64bit=${android.os.Process.is64Bit()}")
        when (mode) {
            "xcheck" -> xcheck()
            "speechfile" -> speechFile()
            "soak" -> soak(intent.getIntExtra("minutes", 30))
            else -> live()
        }
    }

    // ------------------------------------------------------------------ numeric cross-check vs Python

    private fun xcheck() {
        loadPipeline()
        val f = File(filesRoot, "xcheck.png")
        val bmp = BitmapFactory.decodeFile(f.absolutePath) ?: run { log("no xcheck.png"); return }
        val w = bmp.width; val h = bmp.height
        val px = IntArray(w * h); bmp.getPixels(px, 0, w, 0, 0, w, h)
        val p = pipeline!!
        val faces = p.detect(px, w, h)
        log("xcheck image ${w}x$h faces=${faces.size}")
        faces.forEachIndexed { i, fc -> log("face $i box=[%.1f %.1f %.1f %.1f] score=%.4f lm=%s".format(fc.x, fc.y, fc.w, fc.h, fc.score, fc.lm.joinToString(",") { "%.1f".format(it) })) }
        if (faces.isNotEmpty()) {
            val v = p.embed(px, w, h, faces[0].lm)
            log("EMB " + v.joinToString(",") { "%.5f".format(it) })
        }
        val dt = ArrayList<Double>(); val et = ArrayList<Double>()
        repeat(15) {
            var t = System.nanoTime(); val fs = p.detect(px, w, h); dt.add((System.nanoTime() - t) / 1e6)
            if (fs.isNotEmpty()) { t = System.nanoTime(); p.embed(px, w, h, fs[0].lm); et.add((System.nanoTime() - t) / 1e6) }
        }
        dt.sort(); et.sort()
        log("detect breakdown (last call): prep(resize)=%.0f ms, tensor=%.0f ms, onnx run=%.0f ms, decode+nms=%.0f ms".format(p.lastPrepMs, p.lastTensorMs, p.lastRunMs, p.lastDecodeMs))
        log("tablet latency ms (4 threads, ${w}x$h source): detect median=%.0f min=%.0f max=%.0f | embed median=%.0f min=%.0f max=%.0f".format(dt[dt.size / 2], dt.first(), dt.last(), et[et.size / 2], et.first(), et.last()))
        log("DONE")
    }

    // ------------------------------------------------------------------ speech from WAV files (synthetic voices)

    private fun speechFile() {
        if (!loadVoice()) { log("DONE"); return }
        val files = File(filesRoot, "speech").listFiles { x -> x.name.endsWith(".wav") }?.sortedBy { it.name } ?: emptyList()
        var inOk = 0; var inN = 0; var outOk = 0; var outN = 0
        val lat = ArrayList<Double>()
        for (f in files) {
            var label = f.nameWithoutExtension.substringAfter('_').replace('_', ' ')
            val negative = label.startsWith("x ")
            if (negative) label = label.removePrefix("x ")
            val (text, ms, sec) = voice!!.recognizeWav(f)
            val ok = if (negative) (text.isEmpty() || text == "[unk]" || text.replace("[unk]", "").isBlank()) else text == label
            if (negative) { outN++; if (ok) outOk++ } else { inN++; if (ok) inOk++; lat.add(ms.toDouble() / sec) }
            log("%s %-28s -> %-28s decode=%dms audio=%.1fs xRT=%.2f".format(if (ok) "OK  " else "FAIL", label, text, ms, sec, ms / 1000.0 / sec))
        }
        lat.sort()
        log("SUMMARY in-grammar %d/%d correct, out-of-grammar rejected %d/%d, decode xRT median=%.2f (synthetic clean speech: optimistic)".format(inOk, inN, outOk, outN, if (lat.isEmpty()) 0.0 else lat[lat.size / 2]))
        log("DONE")
    }

    // ------------------------------------------------------------------ camera loop

    private class Yuv {
        var w = 0; var h = 0; var y = ByteArray(0); var u = ByteArray(0); var v = ByteArray(0)
        var yrs = 0; var urs = 0; var ups = 0; var vrs = 0; var vps = 0
    }
    private val yuvA = Yuv(); private val yuvP = Yuv()

    private fun copyInto(img: Image, d: Yuv) {
        d.w = img.width; d.h = img.height
        val p = img.planes
        fun grab(buf: java.nio.ByteBuffer, old: ByteArray): ByteArray { buf.rewind(); val a = if (old.size == buf.remaining()) old else ByteArray(buf.remaining()); buf.get(a); return a }
        d.y = grab(p[0].buffer, d.y); d.u = grab(p[1].buffer, d.u); d.v = grab(p[2].buffer, d.v)
        d.yrs = p[0].rowStride; d.urs = p[1].rowStride; d.ups = p[1].pixelStride; d.vrs = p[2].rowStride; d.vps = p[2].pixelStride
    }

    private var lastTick = 0L
    private var framesSeen = 0
    private val noPreview by lazy { intent.getBooleanExtra("nopreview", false) }

    private fun startCamera(intervalMs: Long, size: Size) {
        loadPipeline()
        val cm = getSystemService(CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.first { cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT }
        sensorOrientation = cm.getCameraCharacteristics(id).get(CameraCharacteristics.SENSOR_ORIENTATION)!!
        log("camera front id=$id sensor=$sensorOrientation rotate-now=${currentRot()}; size=${size.width}x${size.height}; interval=${intervalMs}ms")
        val reader = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 4).also { this.reader = it }
        reader.setOnImageAvailableListener({ r ->
            try {
                val img = r.acquireLatestImage() ?: return@setOnImageAvailableListener
                val now = System.currentTimeMillis()
                if (++framesSeen % 60 == 0) log("HEARTBEAT frames=$framesSeen ticks=$ticks busy=${busy.get()}")
                val rot = currentRot()   // re-read every frame: the device may have been rotated
                val wantPreview = mode == "live" && !noPreview && now - lastPreview >= 80
                val wantAnalysis = !busy.get() && now - lastTick >= intervalMs
                if (!wantPreview && !wantAnalysis) { img.close(); return@setOnImageAvailableListener }
                // Copy the planes out and release the camera buffer at once; all conversion happens off the camera's buffer pool.
                if (wantAnalysis) { busy.set(true); lastTick = now; copyInto(img, yuvA) }
                if (wantPreview) { lastPreview = now; copyInto(img, yuvP) }
                img.close()
                if (wantPreview) drawPreview(yuvP, rot)
                if (wantAnalysis) worker.execute {
                    runCatching {
                        val t0 = System.nanoTime()
                        val (px, w, h) = yuvToArgb(yuvA, rot)
                        process(px, w, h, (System.nanoTime() - t0) / 1e6)
                    }.onFailure { log("process error $it ${it.stackTraceToString().take(300)}") }
                    busy.set(false)
                }
            } catch (t: Throwable) { log("LISTENER error $t ${t.stackTraceToString().take(400)}") }
        }, camHandler)
        val surfaces = listOf(reader.surface)
        cm.openCamera(id, object : CameraDevice.StateCallback() {
            override fun onOpened(c: CameraDevice) {
                camera = c
                @Suppress("DEPRECATION")
                c.createCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(s: CameraCaptureSession) {
                        s.setRepeatingRequest(c.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { surfaces.forEach { addTarget(it) } }.build(), null, camHandler)
                    }
                    override fun onConfigureFailed(s: CameraCaptureSession) { log("camera configure failed"); guide?.fatal = "Camera could not start" }
                }, camHandler)
            }
            override fun onDisconnected(c: CameraDevice) { c.close(); log("camera disconnected"); guide?.fatal = "Camera disconnected" }
            override fun onError(c: CameraDevice, e: Int) { c.close(); log("camera error $e"); guide?.fatal = "Camera error $e" }
        }, camHandler)
    }

    /** Small upright, mirrored colour preview (1/4 resolution) for the on-screen mirror view. Never stored. */
    private fun drawPreview(img: Yuv, rot: Int) {
        val g = guide ?: return
        val step = 4
        val w4 = img.w / step; val h4 = img.h / step
        val ow = if (rot % 180 == 0) w4 else h4; val oh = if (rot % 180 == 0) h4 else w4
        previewIdx = 1 - previewIdx
        var bmp = previewBufs[previewIdx][0]
        if (bmp == null || bmp.width != ow || bmp.height != oh) { bmp = android.graphics.Bitmap.createBitmap(ow, oh, android.graphics.Bitmap.Config.ARGB_8888); previewBufs[previewIdx][0] = bmp }
        val out = IntArray(ow * oh)
        val yb = img.y; val ub = img.u; val vb = img.v
        for (ys in 0 until h4) {
            val y = ys * step; val uvr = y shr 1
            for (xs in 0 until w4) {
                val x = xs * step
                val yy = yb[y * img.yrs + x].toInt() and 255
                val u = (ub[uvr * img.urs + (x shr 1) * img.ups].toInt() and 255) - 128
                val v = (vb[uvr * img.vrs + (x shr 1) * img.vps].toInt() and 255) - 128
                var r = yy + ((359 * v) shr 8); var gg = yy - ((88 * u + 183 * v) shr 8); var b = yy + ((454 * u) shr 8)
                r = r.coerceIn(0, 255); gg = gg.coerceIn(0, 255); b = b.coerceIn(0, 255)
                val col: Int; val row: Int
                when (rot) { 90 -> { col = h4 - 1 - ys; row = xs }; 180 -> { col = w4 - 1 - xs; row = h4 - 1 - ys }; 270 -> { col = ys; row = w4 - 1 - xs }; else -> { col = xs; row = ys } }
                out[row * ow + (ow - 1 - col)] = (255 shl 24) or (r shl 16) or (gg shl 8) or b   // mirrored
            }
        }
        bmp.setPixels(out, 0, ow, 0, 0, ow, oh)
        g.preview = bmp
    }

    /** Mean brightness (0..255) of the face box, sampled on a coarse grid. */
    private fun lumaOf(px: IntArray, w: Int, h: Int, f: Face): Float {
        var sum = 0f; var n = 0
        for (j in 0 until 8) for (i in 0 until 8) {
            val x = (f.x + f.w * (i + 0.5f) / 8).toInt().coerceIn(0, w - 1); val y = (f.y + f.h * (j + 0.5f) / 8).toInt().coerceIn(0, h - 1)
            val c = px[y * w + x]; sum += 0.299f * ((c shr 16) and 255) + 0.587f * ((c shr 8) and 255) + 0.114f * (c and 255); n++
        }
        return sum / n
    }

    private fun process(px: IntArray, w: Int, h: Int, conv: Double) {
        val p = pipeline!!
        var t = System.nanoTime()
        val faces = p.detect(px, w, h)
        val det = (System.nanoTime() - t) / 1e6
        t = System.nanoTime()
        val face = faces.maxByOrNull { it.w }
        val emb: FloatArray
        if (face != null) { emb = p.embed(px, w, h, face.lm); realFaces++ }
        else { emb = p.embedAligned(dummyAligned); synthEmbeds++ }   // keep the load realistic with nobody in front
        val embT = (System.nanoTime() - t) / 1e6
        synchronized(statsLock) { ticks++; convMs.add(conv); detMs.add(det); embMs.add(embT) }
        if (mode == "live") {
            val snap = engine.onFrame(faces, w, h, if (face != null) lumaOf(px, w, h, face) else 0f, if (face != null) emb else null)
            if (face != null) lastFaceAt = System.currentTimeMillis()
            applyListening()
            val g = guide
            if (g != null) {
                g.stats = engine.peopleLines()
                g.diag = "detect %.0f ms  embed %.0f ms  %d MB  %.1f C".format(mean(detMs), mean(embMs), pssMb(), batteryTemp())
                g.snap = snap
                runOnUiThread { refreshButtons(snap.phase) }
            }
        } else if (ticks % 4 == 0) refreshUi()
    }

    private val statsLock = Any()   // guards ticks and the latency lists (written by the frame worker, read by the UI / soak threads)
    private fun mean(l: List<Double>, n: Int = 20) = synchronized(statsLock) { if (l.isEmpty()) 0.0 else l.takeLast(n).average() }

    private fun refreshUi() {
        ui("""
            SLICE mode=$mode   status: $status
            ticks=$ticks realFaceTicks=$realFaces syntheticEmbeds=$synthEmbeds
            latency ms (last 20): convert=%.0f detect=%.0f embed=%.0f
            voice: finals=$voiceFinals last="${lastVoice.replace("%", "%%")}"
            pss=${pssMb()} MB  battery=${batteryTemp()}C
        """.trimIndent().format(mean(convMs), mean(detMs), mean(embMs)))
    }

    private fun pssMb(): Int { val m = Debug.MemoryInfo(); Debug.getMemoryInfo(m); return m.totalPss / 1024 }
    private fun batteryTemp(): Double = (registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1) / 10.0
    private fun batteryLevel(): Int = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1

    // ------------------------------------------------------------------ listening modes: OFF (default) / AUTO / ON
    @Volatile private var listenMode = 0             // written on the UI thread, read on the frame worker
    @Volatile private var lastFaceAt = 0L
    private var voiceRunning = false                 // what we last asked for; guarded by this@applyListening's lock
    private val voiceExec = Executors.newSingleThreadExecutor()
    private var modeToast: android.widget.Toast? = null

    private fun cycleListen() {
        if (listenMode == 0 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            android.widget.Toast.makeText(this, "Microphone permission is needed - please allow it", android.widget.Toast.LENGTH_LONG).show()
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2); return
        }
        listenMode = (listenMode + 1) % 3
        guide?.listenMode = listenMode
        val msg = when (listenMode) {
            0 -> "Listening OFF - the microphone is turned off."
            1 -> "Listening AUTO - listens only while someone is in view."
            else -> "Listening ON - always listening for commands."
        }
        modeToast?.cancel()
        modeToast = android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_LONG).also { it.show() }
        log("LISTEN mode=${arrayOf("off", "auto", "on")[listenMode]}")
        applyListening()
    }

    /** Starts or stops the microphone to match the mode (AUTO = only while a face was seen in the last 5 s). Cheap; called every frame. */
    @Synchronized private fun applyListening() {
        val want = listenMode == 2 || (listenMode == 1 && System.currentTimeMillis() - lastFaceAt < 5000)
        if (want == voiceRunning) return
        voiceRunning = want
        voiceExec.execute {
            if (want) {
                startVoice()
                Thread.sleep(500)
                val ok = voice?.isLive == true
                guide?.micLive = ok
                if (!ok && !destroyed) {   // no model, no permission or the mic is busy: fall back to OFF instead of showing "starting" forever
                    log("microphone could not be started")
                    runOnUiThread {
                        listenMode = 0; guide?.listenMode = 0
                        android.widget.Toast.makeText(this, "Could not start the microphone - listening is OFF", android.widget.Toast.LENGTH_LONG).show()
                    }
                    synchronized(this) { voiceRunning = false }
                }
            } else {
                guide?.micLive = false; guide?.micLevel = 0.0
                voice?.stopLive()
            }
        }
    }

    private fun startVoice() {
        if (!loadVoice()) { lastVoice = "(no model)"; return }
        voice!!.startLive({ text, ms ->
            voiceFinals++; lastVoice = text
            log("VOICE '$text' (ms after last partial: $ms)")
            guide?.onHeard(text)?.let { log("VOICE_MATCH '$it'") }
            val m = Regex("this is ([a-z]+)").find(text)
            val who = engine.recognisedNow()
            if (m != null && engine.phase == Phase.MATCHING && who >= 0 && engine.nameOf(who) == null) { engine.rename(who, m.groupValues[1].replaceFirstChar { it.uppercase() }); runOnUiThread { refreshButtons(engine.phase) } }
        }, { level -> guide?.micLevel = level })
    }

    private fun live() {
        status = "live"
        guide?.loadMsg = "Loading face models…"
        startCamera(500, Size(1280, 960))
        guide?.loadMsg = "Waiting for the first camera picture…"
        while (!destroyed) { Thread.sleep(1000) }
    }

    // ------------------------------------------------------------------ soak (gate G3)

    private fun soak(minutes: Int) {
        status = "soak ${minutes} min"
        startVoice()
        startCamera(500, Size(1280, 960))
        val t0 = System.currentTimeMillis()
        data class W(val t: Long, val ticks: Int, val conv: Double, val det: Double, val emb: Double, val pss: Int, val temp: Double, val lvl: Int)
        val windows = ArrayList<W>()
        var prevTicks = 0
        log("SOAK start minutes=$minutes pss=${pssMb()}MB temp=${batteryTemp()}C level=${batteryLevel()}%")
        while (!destroyed && System.currentTimeMillis() - t0 < minutes * 60_000L) {
            Thread.sleep(30_000)
            val n = ticks - prevTicks; prevTicks = ticks
            val w = W((System.currentTimeMillis() - t0) / 1000, n, mean(convMs, n.coerceAtLeast(1)), mean(detMs, n.coerceAtLeast(1)), mean(embMs, n.coerceAtLeast(1)), pssMb(), batteryTemp(), batteryLevel())
            windows.add(w)
            log("SOAK t=%ds ticks/30s=%d conv=%.0f det=%.0f emb=%.0f ms pss=%dMB temp=%.1fC level=%d%% realFaces=%d voiceFinals=%d".format(w.t, w.ticks, w.conv, w.det, w.emb, w.pss, w.temp, w.lvl, realFaces, voiceFinals))
            refreshUi()
        }
        fun avg(l: List<W>, f: (W) -> Double) = if (l.isEmpty()) 0.0 else l.map(f).average()
        val first = windows.take(4); val last = windows.takeLast(4)
        log("SOAK SUMMARY first2min vs last2min: ticks/30s %.1f -> %.1f | det ms %.0f -> %.0f | emb ms %.0f -> %.0f | pss %.0f -> %.0f MB | temp %.1f -> %.1f C (rise %.1f)".format(
            avg(first) { it.ticks.toDouble() }, avg(last) { it.ticks.toDouble() }, avg(first) { it.det }, avg(last) { it.det }, avg(first) { it.emb }, avg(last) { it.emb },
            avg(first) { it.pss.toDouble() }, avg(last) { it.pss.toDouble() }, avg(first) { it.temp }, avg(last) { it.temp }, avg(last) { it.temp } - (windows.firstOrNull()?.temp ?: 0.0)))
        log("SOAK DONE totalTicks=$ticks realFaceTicks=$realFaces")
        log("DONE")
    }

    // ------------------------------------------------------------------ YUV_420_888 -> rotated ARGB

    private fun yuvToArgb(img: Yuv, rot: Int): Triple<IntArray, Int, Int> {
        val w = img.w; val h = img.h
        val yb = img.y; val ub = img.u; val vb = img.v
        val yrs = img.yrs; val urs = img.urs; val ups = img.ups; val vrs = img.vrs; val vps = img.vps
        val ow = if (rot % 180 == 0) w else h; val oh = if (rot % 180 == 0) h else w
        val out = argbBuf
        for (y in 0 until h) {
            val yi = y * yrs; val uvr = y shr 1
            for (x in 0 until w) {
                val yy = yb[yi + x].toInt() and 255
                val u = (ub[uvr * urs + (x shr 1) * ups].toInt() and 255) - 128
                val v = (vb[uvr * vrs + (x shr 1) * vps].toInt() and 255) - 128
                var r = yy + ((359 * v) shr 8); var g = yy - ((88 * u + 183 * v) shr 8); var b = yy + ((454 * u) shr 8)
                r = if (r < 0) 0 else if (r > 255) 255 else r; g = if (g < 0) 0 else if (g > 255) 255 else g; b = if (b < 0) 0 else if (b > 255) 255 else b
                val dst = when (rot) {
                    90 -> x * ow + (h - 1 - y)                            // dst(col = h-1-y, row = x)
                    180 -> (h - 1 - y) * ow + (w - 1 - x)
                    270 -> (w - 1 - x) * ow + y                           // dst(col = y, row = w-1-x)
                    else -> y * ow + x
                }
                out[dst] = (255 shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        return Triple(out, ow, oh)
    }

    override fun onDestroy() {
        destroyed = true
        super.onDestroy()
        camera?.close(); reader?.close(); camThread.quitSafely()
        worker.shutdown()
        // Let an in-flight frame finish before freeing the native sessions it is using.
        runCatching { worker.awaitTermination(3, TimeUnit.SECONDS) }
        voiceExec.shutdownNow()
        voice?.close(); pipeline?.close()
    }
}
