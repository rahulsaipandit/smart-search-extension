package com.smartphotos.frame

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Size
import android.view.Surface
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** What the camera currently sees, in terms the slideshow policy needs. */
class Sighting(val faceCount: Int, val known: List<Person>)

/**
 * Walk-up detection (docs section 7.7): the front camera runs at a low rate, finds faces, and recognises the known people among them.
 * Frames are processed in memory and dropped; nothing is stored and there is no preview. Recognition uses the exemplars of [People].
 *
 * Hysteresis: the same non-empty group of known people must be seen [enterTicks] analyses in a row to be reported by [onEnter];
 * [onLeave] fires when no known person was seen for [leaveMs]. [onSeen] fires with every analysis (used for "microphone only while someone is in view").
 * Duty cycle: [fastMs] between analyses while someone is around, [slowMs] after [idleAfterMs] without any face.
 */
class Presence(
    private val act: Activity,
    private val people: People,
    private val pipeline: () -> FacePipeline?,
    private val onSeen: (Sighting) -> Unit,
    private val onEnter: (List<Person>) -> Unit,
    private val onLeave: () -> Unit,
    private val onFailure: (String) -> Unit,
) {
    var enterTicks = 3
    var leaveMs = 30_000L
    var fastMs = 1000L
    var slowMs = 2000L
    var idleAfterMs = 120_000L

    @Volatile var running = false; private set
    @Volatile var lastFaceAt = 0L; private set
    @Volatile private var destroyed = false

    private var camThread: HandlerThread? = null
    private var camHandler: Handler? = null
    private var camera: CameraDevice? = null
    private var reader: ImageReader? = null
    private var sensorOrientation = 270
    private val worker = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    @Volatile private var lastTick = 0L

    // frame copy (reused) so the camera buffer is released immediately
    private var yb = ByteArray(0); private var ub = ByteArray(0); private var vb = ByteArray(0)
    private var fw = 0; private var fh = 0; private var yrs = 0; private var urs = 0; private var ups = 0; private var vrs = 0; private var vps = 0
    private var argb = IntArray(0)

    // hysteresis state (worker thread only)
    private var candidate: Set<Long> = emptySet(); private var candidateRuns = 0
    private var present: Set<Long> = emptySet(); private var lastKnownAt = 0L

    fun hasPermission() = act.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun currentRot(): Int {
        @Suppress("DEPRECATION") val disp = when (act.windowManager.defaultDisplay.rotation) { Surface.ROTATION_90 -> 90; Surface.ROTATION_180 -> 180; Surface.ROTATION_270 -> 270; else -> 0 }
        return (sensorOrientation + disp) % 360
    }

    fun start() {
        if (running || !hasPermission()) return
        running = true; destroyed = false; started = System.currentTimeMillis(); candidate = emptySet(); candidateRuns = 0; present = emptySet(); lastKnownAt = 0
        val t = HandlerThread("presence-cam").also { it.start() }; camThread = t
        val h = Handler(t.looper); camHandler = h
        try {
            val cm = act.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val id = cm.cameraIdList.first { cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT }
            sensorOrientation = cm.getCameraCharacteristics(id).get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 270
            val size = Size(640, 480)   // plenty for a face at arm's length to a few metres; the detector letterboxes to 640 anyway
            val r = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 3).also { reader = it }
            r.setOnImageAvailableListener({ rd -> onImage(rd) }, h)
            cm.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(c: CameraDevice) {
                    camera = c
                    @Suppress("DEPRECATION")
                    c.createCaptureSession(listOf(r.surface), object : CameraCaptureSession.StateCallback() {
                        override fun onConfigured(s: CameraCaptureSession) {
                            s.setRepeatingRequest(c.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(r.surface) }.build(), null, h)
                        }
                        override fun onConfigureFailed(s: CameraCaptureSession) = fail("Camera could not start")
                    }, h)
                }
                override fun onDisconnected(c: CameraDevice) { c.close(); fail("Camera disconnected") }
                override fun onError(c: CameraDevice, e: Int) { c.close(); fail("Camera error $e") }
            }, h)
        } catch (t2: Throwable) { fail("Camera unavailable: $t2") }
    }

    private fun fail(msg: String) { Log.w("FRAME", "presence: $msg"); stop(); onFailure(msg) }

    fun stop() {
        if (!running) return
        running = false
        runCatching { camera?.close() }; camera = null
        runCatching { reader?.close() }; reader = null
        runCatching { camThread?.quitSafely() }; camThread = null; camHandler = null
        if (present.isNotEmpty()) { present = emptySet(); onLeave() }
    }

    /** Stops the camera and waits for an analysis in flight, so the caller can free the face models safely afterwards. */
    fun destroy() { destroyed = true; stop(); worker.shutdown(); runCatching { worker.awaitTermination(3, java.util.concurrent.TimeUnit.SECONDS) } }

    /** Fast while someone was seen recently, slow after [idleAfterMs] with nobody (saves power overnight and in an empty room). */
    private fun interval(now: Long) = if (now - maxOf(lastFaceAt, started) > idleAfterMs) slowMs else fastMs
    private var started = 0L

    private fun onImage(rd: ImageReader) {
        try {
            val img = rd.acquireLatestImage() ?: return
            val now = System.currentTimeMillis()
            if (busy.get() || now - lastTick < interval(now) || !running) { img.close(); return }
            busy.set(true); lastTick = now
            copy(img); img.close()
            val rot = currentRot()
            worker.execute {
                try { analyse(rot) } catch (t: Throwable) { Log.w("FRAME", "presence analyse: $t") }
                busy.set(false)
            }
        } catch (t: Throwable) { Log.w("FRAME", "presence listener: $t") }
    }

    private fun copy(img: Image) {
        fw = img.width; fh = img.height
        val p = img.planes
        fun grab(b: java.nio.ByteBuffer, old: ByteArray): ByteArray { b.rewind(); val a = if (old.size == b.remaining()) old else ByteArray(b.remaining()); b.get(a); return a }
        yb = grab(p[0].buffer, yb); ub = grab(p[1].buffer, ub); vb = grab(p[2].buffer, vb)
        yrs = p[0].rowStride; urs = p[1].rowStride; ups = p[1].pixelStride; vrs = p[2].rowStride; vps = p[2].pixelStride
    }

    /** YUV_420_888 to upright packed RGB (BT.601), same maths as the slice. */
    private fun toArgb(rot: Int): Triple<IntArray, Int, Int> {
        val w = fw; val h = fh
        val ow = if (rot % 180 == 0) w else h; val oh = if (rot % 180 == 0) h else w
        if (argb.size < ow * oh) argb = IntArray(ow * oh)
        for (y in 0 until h) {
            val yi = y * yrs; val ur = (y shr 1) * urs; val vr = (y shr 1) * vrs
            val base: Int; val step: Int
            when (rot) { 90 -> { base = h - 1 - y; step = ow }; 180 -> { base = (h - 1 - y) * ow + (w - 1); step = -1 }; 270 -> { base = (w - 1) * ow + y; step = -ow }; else -> { base = y * ow; step = 1 } }
            for (x in 0 until w) {
                val yy = yb[yi + x].toInt() and 255
                val u = (ub[ur + (x shr 1) * ups].toInt() and 255) - 128; val v = (vb[vr + (x shr 1) * vps].toInt() and 255) - 128
                var r = yy + ((359 * v) shr 8); var g = yy - ((88 * u + 183 * v) shr 8); var b = yy + ((454 * u) shr 8)
                r = r.coerceIn(0, 255); g = g.coerceIn(0, 255); b = b.coerceIn(0, 255)
                argb[base + x * step] = (255 shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        return Triple(argb, ow, oh)
    }

    private fun analyse(rot: Int) {
        val t0 = System.nanoTime()
        val (px, w, h) = toArgb(rot)
        analysePixels(px, w, h, t0)
    }

    /** Debug builds: run a library photo through exactly the path a camera frame takes (detect, embed, match, hysteresis). */
    @Volatile private var debugInjecting = false
    fun debugInject(px: IntArray, w: Int, h: Int) { debugInjecting = true; try { analysePixels(px, w, h, System.nanoTime()) } finally { debugInjecting = false } }

    private fun analysePixels(px: IntArray, w: Int, h: Int, t0: Long) {
        val fp = pipeline() ?: return
        val now = System.currentTimeMillis()
        val found = fp.detect(px, w, h).filter { it.w >= w * 0.06f }.sortedByDescending { it.w }.take(3)
        if (found.isEmpty()) { lastMs = (System.nanoTime() - t0) / 1_000_000; sighted(now, 0, emptyList()); return }
        lastFaceAt = now
        val known = LinkedHashMap<Long, Person>()
        for (f in found) people.match(fp.embed(px, w, h, f.lm))?.let { known[it.first.id] = it.first }
        lastMs = (System.nanoTime() - t0) / 1_000_000
        sighted(now, found.size, known.values.toList())
    }

    private var lastLog = ""
    private var lastMs = 0L

    private fun sighted(now: Long, faces: Int, known: List<Person>) {
        if (!running && !debugInjecting) return   // stopped while this analysis was in flight: report nothing
        onSeen(Sighting(faces, known))
        val msg = "faces=$faces known=${known.joinToString { it.name }}"
        if (msg != lastLog) { lastLog = msg; Log.i("FRAME", "PRESENCE sighting $msg (analysis ${lastMs} ms)") }
        val ids = known.map { it.id }.toSet()
        if (ids.isNotEmpty()) {
            lastKnownAt = now
            if (ids == candidate) candidateRuns++ else { candidate = ids; candidateRuns = 1 }
            if (candidateRuns >= enterTicks && ids != present) { present = ids; onEnter(known) }
        } else {
            candidate = emptySet(); candidateRuns = 0
            if (present.isNotEmpty() && now - lastKnownAt >= leaveMs) { present = emptySet(); onLeave() }
        }
    }
}
