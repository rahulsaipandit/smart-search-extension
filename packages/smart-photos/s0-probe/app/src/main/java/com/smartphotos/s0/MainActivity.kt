package com.smartphotos.s0

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import ai.onnxruntime.OnnxJavaType
import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Debug
import android.os.Handler
import android.os.HandlerThread
import android.os.BatteryManager
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import android.util.Size
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * S0 probe for the Smart Photos design (docs/SmartPhotos.md, spike S0).
 *
 * Measures what the design could only assume about the Fire HD: memory, camera output sizes and
 * real frame rates, microphone noise floor, whether ONNX Runtime runs on this 32-bit device and how
 * fast, and which speech/WebView components exist. Nothing is saved except the text report: camera
 * frames and audio are analysed in memory and discarded.
 */
class MainActivity : Activity() {
    private lateinit var view: TextView
    private val report = StringBuilder()
    private lateinit var reportFile: File

    private fun log(line: String) {
        android.util.Log.i("S0", line)
        synchronized(report) {
            report.append(line).append('\n')
            runCatching { reportFile.writeText(report.toString()) }
        }
        runOnUiThread { view.text = report.toString() }
    }

    private fun section(title: String) = log("\n== $title")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        view = TextView(this).apply { textSize = 12f; setPadding(24, 24, 24, 24); setTextIsSelectable(true) }
        setContentView(ScrollView(this).apply { addView(view) })
        reportFile = File(getExternalFilesDir(null) ?: filesDir, "report.txt")

        val need = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (need.isNotEmpty()) requestPermissions(need.toTypedArray(), 1) else start()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        start()
    }

    private var started = false
    private fun start() {
        if (started) return
        started = true
        thread(name = "s0-probe") {
            runCatching { runAll() }.onFailure { log("FATAL: $it\n${it.stackTraceToString()}") }
            log("\nDONE")
        }
    }

    private fun runAll() {
        log("S0 probe v0.1 started ${java.util.Date()} mode=${intent.getStringExtra("mode") ?: "all"}")
        if (intent.getStringExtra("mode") == "models") {
            deviceInfo()
            batteryTemp("before")
            modelBench()
            batteryTemp("after")
            return
        }
        deviceInfo()
        batteryTemp("before")
        webViewInfo()
        speechInfo()
        cameraInfo()
        audioProbe()
        ortBench()
        batteryTemp("after")
    }

    // ---------------------------------------------------------------- device

    private fun deviceInfo() {
        section("device")
        log("model=${Build.MODEL} device=${Build.DEVICE} hw=${Build.HARDWARE} sdk=${Build.VERSION.SDK_INT} release=${Build.VERSION.RELEASE}")
        log("abis=${Build.SUPPORTED_ABIS.joinToString()}  is64bitProcess=${android.os.Process.is64Bit()}")
        val am = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        log("totalMemMB=${mi.totalMem shr 20} availMemMB=${mi.availMem shr 20} lowMemoryThresholdMB=${mi.threshold shr 20}")
        log("memoryClassMB=${am.memoryClass} largeMemoryClassMB=${am.largeMemoryClass} isLowRamDevice=${am.isLowRamDevice}")
        log("javaMaxHeapMB=${Runtime.getRuntime().maxMemory() shr 20} cores=${Runtime.getRuntime().availableProcessors()}")
        runCatching {
            val maxFreqs = (0 until Runtime.getRuntime().availableProcessors()).map {
                File("/sys/devices/system/cpu/cpu$it/cpufreq/cpuinfo_max_freq").readText().trim().toLong() / 1000
            }
            log("cpuMaxMHz=$maxFreqs")
        }
    }

    private fun batteryTemp(tag: String) {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return
        val t = i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) / 10.0
        val lvl = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val plug = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
        log("battery[$tag] tempC=$t level=$lvl plugged=$plug (1=AC 2=USB)")
    }

    // ---------------------------------------------------------------- webview / speech

    private fun webViewInfo() {
        section("webview")
        val done = CountDownLatch(1)
        runOnUiThread {
            runCatching {
                log("provider=${WebView.getCurrentWebViewPackage()?.let { "${it.packageName} ${it.versionName}" }}")
                log("userAgent=${WebSettings.getDefaultUserAgent(this)}")
            }.onFailure { log("webview error: $it") }
            done.countDown()
        }
        done.await(10, TimeUnit.SECONDS)
    }

    private fun speechInfo() {
        section("speech")
        log("SpeechRecognizer.isRecognitionAvailable=${SpeechRecognizer.isRecognitionAvailable(this)}")
        val svcs = packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
        log("recognitionServices=${svcs.map { it.serviceInfo.packageName }}")
    }

    // ---------------------------------------------------------------- camera

    private fun cameraInfo() {
        section("camera")
        val cm = getSystemService(CAMERA_SERVICE) as CameraManager
        for (id in cm.cameraIdList) {
            val c = cm.getCameraCharacteristics(id)
            val facing = when (c.get(CameraCharacteristics.LENS_FACING)) {
                CameraCharacteristics.LENS_FACING_FRONT -> "front"
                CameraCharacteristics.LENS_FACING_BACK -> "back"
                else -> "external"
            }
            val level = when (c.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)) {
                CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "legacy"
                CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "limited"
                CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "full"
                CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "level3"
                else -> "?"
            }
            val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val yuv = map?.getOutputSizes(ImageFormat.YUV_420_888)?.sortedByDescending { it.width * it.height }
            val fov = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.toList()
            val sensor = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
            val minFocus = c.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE)
            val af = c.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.toList()
            val fps = c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)?.joinToString { "${it.lower}-${it.upper}" }
            val exp = c.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
            val iso = c.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
            log("camera $id facing=$facing level=$level sensor=$sensor orientation=${c.get(CameraCharacteristics.SENSOR_ORIENTATION)}")
            log("  yuvSizes=${yuv?.take(10)?.joinToString { "${it.width}x${it.height}" }}")
            log("  focalLengths=$fov minFocusDiopters=$minFocus afModes=$af aeFps=[$fps]")
            log("  exposureNs=${exp?.lower}..${exp?.upper} iso=${iso?.lower}..${iso?.upper}")
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            log("camera permission not granted: skipping live capture test"); return
        }
        val frontId = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
        } ?: return
        val map = cm.getCameraCharacteristics(frontId).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)!!
        val sizes = map.getOutputSizes(ImageFormat.YUV_420_888).toList()
        val wanted = listOf(Size(1600, 1200), Size(1280, 720), Size(640, 480)).filter { it in sizes }
        for (s in wanted) captureTest(cm, frontId, s, seconds = 4)
    }

    private fun captureTest(cm: CameraManager, id: String, size: Size, seconds: Int) {
        val ht = HandlerThread("cam").also { it.start() }
        val h = Handler(ht.looper)
        val reader = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 3)
        var frames = 0
        var firstMs = -1L
        var lumaSum = 0.0
        var lumaN = 0
        val t0 = System.nanoTime()
        reader.setOnImageAvailableListener({ r ->
            val img = r.acquireLatestImage() ?: return@setOnImageAvailableListener
            if (firstMs < 0) firstMs = (System.nanoTime() - t0) / 1_000_000
            frames++
            val buf = img.planes[0].buffer
            var i = 0
            var s = 0L
            var n = 0
            while (i < buf.limit()) { s += buf.get(i).toInt() and 0xFF; n++; i += 64 }
            lumaSum += s.toDouble() / n; lumaN++
            img.close()
        }, h)
        val opened = CountDownLatch(1)
        var dev: CameraDevice? = null
        try {
            cm.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) { dev = camera; opened.countDown() }
                override fun onDisconnected(camera: CameraDevice) { camera.close(); opened.countDown() }
                override fun onError(camera: CameraDevice, error: Int) { log("  camera error $error"); camera.close(); opened.countDown() }
            }, h)
        } catch (e: CameraAccessException) { log("  openCamera failed: $e"); ht.quitSafely(); return }
        if (!opened.await(8, TimeUnit.SECONDS) || dev == null) { log("  ${size.width}x${size.height}: could not open camera"); ht.quitSafely(); return }
        val d = dev!!
        val started = CountDownLatch(1)
        @Suppress("DEPRECATION")
        d.createCaptureSession(listOf(reader.surface), object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) {
                val req = d.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(reader.surface) }.build()
                session.setRepeatingRequest(req, null, h)
                started.countDown()
            }
            override fun onConfigureFailed(session: CameraCaptureSession) { log("  configure failed"); started.countDown() }
        }, h)
        started.await(8, TimeUnit.SECONDS)
        val tStart = System.nanoTime()
        Thread.sleep(seconds * 1000L)
        val elapsed = (System.nanoTime() - tStart) / 1e9
        val total = frames
        d.close(); reader.close(); ht.quitSafely()
        log("  capture ${size.width}x${size.height}: frames=$total fps=${"%.1f".format(total / elapsed)} firstFrameMs=$firstMs meanLuma=${"%.0f".format(if (lumaN > 0) lumaSum / lumaN else -1.0)}/255")
    }

    // ---------------------------------------------------------------- microphone

    private fun audioProbe() {
        section("microphone")
        for (rate in intArrayOf(8000, 16000, 44100, 48000)) {
            val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            log("rate=$rate minBuffer=$min")
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            log("audio permission not granted: skipping noise-floor test"); return
        }
        val rate = 16000
        val bufSize = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT) * 2
        val rec = AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize)
        if (rec.state != AudioRecord.STATE_INITIALIZED) { log("AudioRecord failed to initialise"); return }
        val data = ShortArray(rate * 3)
        rec.startRecording()
        var read = 0
        while (read < data.size) {
            val n = rec.read(data, read, data.size - read)
            if (n <= 0) break
            read += n
        }
        rec.stop(); rec.release()
        var sumSq = 0.0
        var peak = 0
        for (i in 0 until read) { val v = data[i].toInt(); sumSq += v.toDouble() * v; if (kotlin.math.abs(v) > peak) peak = kotlin.math.abs(v) }
        val rms = sqrt(sumSq / read.coerceAtLeast(1))
        log("3 s @16kHz: samples=$read rmsDbFS=${"%.1f".format(20 * log10(rms.coerceAtLeast(1.0) / 32768))} peakDbFS=${"%.1f".format(20 * log10(peak.coerceAtLeast(1) / 32768.0))}  (ambient noise floor; audio is not saved)")
    }

    // ---------------------------------------------------------------- ONNX Runtime

    private fun readAsset(name: String): ByteArray = assets.open(name).use { it.readBytes() }

    private fun nativeMb() = Debug.getNativeHeapAllocatedSize() shr 20

    private fun pssMb(): Int { val m = Debug.MemoryInfo(); Debug.getMemoryInfo(m); return m.totalPss / 1024 }

    private fun ortBench() {
        section("onnxruntime")
        val env = try { OrtEnvironment.getEnvironment() } catch (t: Throwable) { log("ORT failed to load: $t"); return }
        log("ort version=${env.version} providers=${OrtEnvironment.getAvailableProviders()} pssMB=${pssMb()}")
        data class M(val file: String, val shape: LongArray, val label: String)
        val models = listOf(
            M("bench_conv.onnx", longArrayOf(1, 3, 224, 224), "conv (~0.4 GFLOP, vision-encoder proxy)"),
            M("bench_matmul.onnx", longArrayOf(64, 512), "matmul (~0.27 GFLOP, text-encoder proxy)"),
        )
        for (m in models) {
            val bytes = readAsset(m.file)
            for (threads in intArrayOf(1, 2, 4, 8)) {
                runCatching {
                    val opts = OrtSession.SessionOptions().apply {
                        setIntraOpNumThreads(threads)
                        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                    }
                    val tLoad = System.nanoTime()
                    env.createSession(bytes, opts).use { s ->
                        val loadMs = (System.nanoTime() - tLoad) / 1_000_000
                        val n = m.shape.fold(1L) { a, b -> a * b }.toInt()
                        val input = FloatBuffer.allocate(n).also { b -> for (i in 0 until n) b.put(i, ((i % 255) / 255f)) }
                        val times = ArrayList<Double>()
                        for (iter in 0 until 12) {
                            OnnxTensor.createTensor(env, input, m.shape).use { t ->
                                val t0 = System.nanoTime()
                                s.run(mapOf("X" to t)).close()
                                val ms = (System.nanoTime() - t0) / 1e6
                                if (iter >= 2) times.add(ms)
                            }
                        }
                        times.sort()
                        log("${m.label} threads=$threads: load=${loadMs}ms median=${"%.1f".format(times[times.size / 2])}ms min=${"%.1f".format(times.first())}ms max=${"%.1f".format(times.last())}ms pssMB=${pssMb()} nativeMB=${nativeMb()}")
                    }
                    opts.close()
                }.onFailure { log("${m.file} threads=$threads failed: $it") }
            }
        }
        // XNNPACK and NNAPI are optional accelerators; each may be missing from this build or crash the
        // driver, so they run last and the report is flushed after every line.
        for (ep in listOf("xnnpack", "nnapi")) {
            runCatching {
                val opts = OrtSession.SessionOptions().apply {
                    when (ep) {
                        "xnnpack" -> addXnnpack(mapOf("intra_op_num_threads" to "4"))
                        else -> addNnapi()
                    }
                }
                val bytes = readAsset("bench_conv.onnx")
                env.createSession(bytes, opts).use { s ->
                    val n = 3 * 224 * 224
                    val input = FloatBuffer.allocate(n)
                    val times = ArrayList<Double>()
                    for (iter in 0 until 8) {
                        OnnxTensor.createTensor(env, input, longArrayOf(1, 3, 224, 224)).use { t ->
                            val t0 = System.nanoTime()
                            s.run(mapOf("X" to t)).close()
                            if (iter >= 2) times.add((System.nanoTime() - t0) / 1e6)
                        }
                    }
                    times.sort()
                    log("conv with $ep: median=${"%.1f".format(times[times.size / 2])}ms")
                }
            }.onFailure { log("$ep not usable: $it") }
        }
    }

    // ---------------------------------------------------------------- real-model benchmark (S1')

    /**
     * Times every `*.onnx` pushed to `<externalFiles>/models/` with dummy inputs: batch 1, 224x224
     * images, 77-token text. Reports file size, session load time, latency percentiles and memory
     * before/after load. Quality is not measured here (random inputs); that is spike S2.
     */
    private fun modelBench() {
        section("model benchmark (S1')")
        val dir = File(getExternalFilesDir(null), "models")
        val files = dir.listFiles { f -> f.name.endsWith(".onnx") }?.sortedBy { it.name } ?: emptyList()
        if (files.isEmpty()) { log("no models in $dir"); return }
        val env = OrtEnvironment.getEnvironment()
        for (f in files) {
            for (threads in intArrayOf(2, 4)) {
                System.gc()
                val pssBefore = pssMb()
                runCatching {
                    val opts = OrtSession.SessionOptions().apply {
                        setIntraOpNumThreads(threads)
                        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                    }
                    val t0 = System.nanoTime()
                    env.createSession(f.absolutePath, opts).use { s ->
                        val loadMs = (System.nanoTime() - t0) / 1_000_000
                        val pssLoaded = pssMb()
                        val ins = s.inputInfo.map { (name, ni) ->
                            val ti = ni.info as TensorInfo
                            val shape = ti.shape.map { if (it <= 0) 1L else it }.toLongArray()
                            // image input with dynamic channel/size axes: NCHW 3x224x224 unless the model fixes them
                            if (name == "pixel_values" && ti.shape.size == 4) {
                                shape[1] = if (ti.shape[1] > 0) ti.shape[1] else 3L
                                shape[2] = if (ti.shape[2] > 0) ti.shape[2] else 224L
                                shape[3] = if (ti.shape[3] > 0) ti.shape[3] else 224L
                            }
                            // dynamic text sequence axes default to 16 tokens (a typical short query; the CLIP limit is 77)
                            if (name.contains("input_ids") || name.contains("attention_mask")) { if (shape.size == 2) shape[1] = 16 }
                            Triple(name, ti.type, shape)
                        }
                        val times = ArrayList<Double>()
                        var outDesc = ""
                        for (iter in 0 until 12) {
                            val tensors = ins.map { (name, type, shape) ->
                                val n = shape.fold(1L) { a, b -> a * b }.toInt()
                                name to when (type) {
                                    OnnxJavaType.INT64 -> {
                                        val b = LongBuffer.allocate(n)
                                        for (i in 0 until n) b.put(i, if (name.contains("attention_mask")) (if (i < 8) 1L else 0L) else when (i) { 0 -> 49406L; 7 -> 49407L; else -> if (i < 7) (300L + i) else 0L })
                                        OnnxTensor.createTensor(env, b, shape)
                                    }
                                    else -> {
                                        val b = FloatBuffer.allocate(n)
                                        for (i in 0 until n) b.put(i, ((i % 251) / 251f) - 0.5f)
                                        OnnxTensor.createTensor(env, b, shape)
                                    }
                                }
                            }
                            val t1 = System.nanoTime()
                            val res = s.run(tensors.toMap())
                            val ms = (System.nanoTime() - t1) / 1e6
                            if (iter == 0) outDesc = res.joinToString { (it.value as OnnxTensor).info.shape.contentToString() }
                            res.close(); tensors.forEach { it.second.close() }
                            if (iter >= 2) times.add(ms)
                        }
                        times.sort()
                        val pssRun = pssMb()
                        log("${f.name} (${f.length() shr 20} MB) threads=$threads inputs=${ins.map { "${it.first}${it.third.contentToString()}" }} out=$outDesc")
                        log("   load=${loadMs}ms median=${"%.0f".format(times[times.size / 2])}ms p90=${"%.0f".format(times[(times.size * 0.9).toInt().coerceAtMost(times.size - 1)])}ms  pss before=${pssBefore}MB loaded=${pssLoaded}MB afterRun=${pssRun}MB (+${pssRun - pssBefore}MB)")
                    }
                    opts.close()
                }.onFailure { log("${f.name} threads=$threads FAILED: $it") }
            }
        }
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        log("cpuTempHint battery=${(i?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1) / 10.0}C")
    }
}
