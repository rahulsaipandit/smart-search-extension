package com.smartphotos.frame

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** One detected face in source-image pixels. `lm` = 5 landmarks (x0,y0,...): right eye, left eye, nose, right mouth, left mouth (image-left first). */
class Face(val x: Float, val y: Float, val w: Float, val h: Float, val score: Float, val lm: FloatArray)

/**
 * YuNet detection + 5-point alignment + SFace embedding via ONNX Runtime. A direct port of
 * `tools/faces/face_ref.py` (which follows OpenCV's FaceDetectorYN / FaceRecognizerSF); numbers must match it.
 * Pixels are `ARGB_8888` ints (as from `Bitmap.getPixels`).
 */
class FacePipeline(yunet: ByteArray, sface: ByteArray, threads: Int = 4, private val scoreThr: Float = 0.6f, private val nmsThr: Float = 0.3f) {
    private val env = OrtEnvironment.getEnvironment()
    private val det: OrtSession
    private val rec: OrtSession
    private val input = FloatArray(3 * 640 * 640)
    /** Reusable native buffer: avoids a 4.9 MB heap-to-native copy inside ONNX Runtime on every call. */
    private val inputDirect: FloatBuffer = ByteBuffer.allocateDirect(4 * 3 * 640 * 640).order(ByteOrder.nativeOrder()).asFloatBuffer()
    private val alignedDirect: FloatBuffer = ByteBuffer.allocateDirect(4 * 3 * 112 * 112).order(ByteOrder.nativeOrder()).asFloatBuffer()
    @Volatile var lastTensorMs = 0.0

    init {
        fun opts() = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(threads)
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        }
        det = env.createSession(yunet, opts())
        rec = env.createSession(sface, opts())
    }

    fun close() { det.close(); rec.close() }

    /** Letterbox (top-left, no stretch) into 640x640, BGR, raw 0..255, bilinear. */
    private fun fillInput(px: IntArray, w: Int, h: Int): Float {
        val s = min(640f / w, 640f / h)
        val nw = max(1, Math.round(w * s)); val nh = max(1, Math.round(h * s))
        java.util.Arrays.fill(input, 0f)
        val plane = 640 * 640
        for (y in 0 until nh) {
            val sy = ((y + 0.5f) / s - 0.5f).coerceIn(0f, h - 1f)
            val y0 = sy.toInt(); val y1 = min(y0 + 1, h - 1); val fy = sy - y0
            for (x in 0 until nw) {
                val sx = ((x + 0.5f) / s - 0.5f).coerceIn(0f, w - 1f)
                val x0 = sx.toInt(); val x1 = min(x0 + 1, w - 1); val fx = sx - x0
                val p00 = px[y0 * w + x0]; val p01 = px[y0 * w + x1]; val p10 = px[y1 * w + x0]; val p11 = px[y1 * w + x1]
                val o = y * 640 + x
                for (c in 0..2) { // c=0 -> B, 1 -> G, 2 -> R
                    val sh = 8 * c
                    val v = ((p00 shr sh) and 255) * (1 - fx) * (1 - fy) + ((p01 shr sh) and 255) * fx * (1 - fy) +
                        ((p10 shr sh) and 255) * (1 - fx) * fy + ((p11 shr sh) and 255) * fx * fy
                    input[c * plane + o] = v
                }
            }
        }
        return s
    }

    /** Timing breakdown of the last [detect] call, in ms: letterbox resize, ONNX inference, decode+NMS. */
    @Volatile var lastPrepMs = 0.0; @Volatile var lastRunMs = 0.0; @Volatile var lastDecodeMs = 0.0

    fun detect(px: IntArray, w: Int, h: Int): List<Face> {
        val tp = System.nanoTime()
        val s = fillInput(px, w, h)
        lastPrepMs = (System.nanoTime() - tp) / 1e6
        val faces = ArrayList<Face>()
        val tt = System.nanoTime()
        inputDirect.clear(); inputDirect.put(input); inputDirect.rewind()
        OnnxTensor.createTensor(env, inputDirect, longArrayOf(1, 3, 640, 640)).use { t ->
            lastTensorMs = (System.nanoTime() - tt) / 1e6
            val tr = System.nanoTime()
            det.run(mapOf("input" to t)).use { res ->
                lastRunMs = (System.nanoTime() - tr) / 1e6
                val td = System.nanoTime()
                fun out(n: String): FloatArray { val b = (res.get(n).get() as OnnxTensor).floatBuffer; return FloatArray(b.remaining()).also { b.get(it) } }
                for (stride in intArrayOf(8, 16, 32)) {
                    val cols = 640 / stride
                    val cls = out("cls_$stride"); val obj = out("obj_$stride"); val bb = out("bbox_$stride"); val kp = out("kps_$stride")
                    for (i in cls.indices) {
                        val score = sqrt(cls[i].coerceIn(0f, 1f) * obj[i].coerceIn(0f, 1f))
                        if (score < scoreThr) continue
                        val r = i / cols; val c = i % cols
                        val cx = (c + bb[4 * i]) * stride; val cy = (r + bb[4 * i + 1]) * stride
                        val bw = exp(bb[4 * i + 2]) * stride; val bh = exp(bb[4 * i + 3]) * stride
                        val lm = FloatArray(10) { k -> ((kp[10 * i + k] + if (k % 2 == 0) c else r) * stride) / s }
                        faces.add(Face((cx - bw / 2) / s, (cy - bh / 2) / s, bw / s, bh / s, score, lm))
                    }
                }
                lastDecodeMs = (System.nanoTime() - td) / 1e6
            }
        }
        faces.sortByDescending { it.score }
        val keep = ArrayList<Face>()
        for (f in faces) if (keep.all { iou(f, it) < nmsThr }) keep.add(f)
        return keep
    }

    private fun iou(a: Face, b: Face): Float {
        val x1 = max(a.x, b.x); val y1 = max(a.y, b.y); val x2 = min(a.x + a.w, b.x + b.w); val y2 = min(a.y + a.h, b.y + b.h)
        val inter = max(0f, x2 - x1) * max(0f, y2 - y1)
        return inter / (a.w * a.h + b.w * b.h - inter + 1e-9f)
    }

    /** 112x112 aligned RGB (0..255) NCHW from the source pixels and the 5 landmarks. */
    private fun align(px: IntArray, w: Int, h: Int, lm: FloatArray): FloatArray {
        val n = 5
        var mx = 0f; var my = 0f; var mu = 0f; var mv = 0f
        for (i in 0 until n) { mx += lm[2 * i]; my += lm[2 * i + 1]; mu += TEMPLATE[2 * i]; mv += TEMPLATE[2 * i + 1] }
        mx /= n; my /= n; mu /= n; mv /= n
        var num1 = 0f; var num2 = 0f; var den = 0f
        for (i in 0 until n) {
            val x = lm[2 * i] - mx; val y = lm[2 * i + 1] - my; val u = TEMPLATE[2 * i] - mu; val v = TEMPLATE[2 * i + 1] - mv
            num1 += x * u + y * v; num2 += x * v - y * u; den += x * x + y * y
        }
        if (den < 1e-6f) return FloatArray(3 * 112 * 112)   // degenerate landmarks: blank crop instead of NaNs
        val a = num1 / den; val b = num2 / den
        val tx = mu - a * mx + b * my; val ty = mv - b * mx - a * my
        val det2 = a * a + b * b
        val out = FloatArray(3 * 112 * 112)
        val plane = 112 * 112
        for (v in 0 until 112) for (u in 0 until 112) {
            val du = u - tx; val dv = v - ty
            val sx = (a * du + b * dv) / det2; val sy = (-b * du + a * dv) / det2
            val x0 = Math.floor(sx.toDouble()).toInt(); val y0 = Math.floor(sy.toDouble()).toInt()
            val fx = sx - x0; val fy = sy - y0
            for (c in 0..2) { // output RGB: c=0 -> R
                val sh = 16 - 8 * c
                fun p(yy: Int, xx: Int): Float = if (xx < 0 || xx >= w || yy < 0 || yy >= h) 0f else ((px[yy * w + xx] shr sh) and 255).toFloat()
                out[c * plane + v * 112 + u] = p(y0, x0) * (1 - fx) * (1 - fy) + p(y0, x0 + 1) * fx * (1 - fy) + p(y0 + 1, x0) * (1 - fx) * fy + p(y0 + 1, x0 + 1) * fx * fy
            }
        }
        return out
    }

    /** L2-normalised 128-d SFace embedding of the face with landmarks `lm`. */
    fun embed(px: IntArray, w: Int, h: Int, lm: FloatArray): FloatArray = embedAligned(align(px, w, h, lm))

    fun embedAligned(aligned: FloatArray): FloatArray {
        alignedDirect.clear(); alignedDirect.put(aligned); alignedDirect.rewind()
        OnnxTensor.createTensor(env, alignedDirect, longArrayOf(1, 3, 112, 112)).use { t ->
            rec.run(mapOf("data" to t)).use { res ->
                val b = (res.get(0) as OnnxTensor).floatBuffer
                val v = FloatArray(b.remaining()).also { b.get(it) }
                var n = 0f; for (x in v) n += x * x
                n = sqrt(n); for (i in v.indices) v[i] /= n
                return v
            }
        }
    }

    companion object {
        /** ArcFace 112x112 template (x0,y0,x1,y1,...). */
        val TEMPLATE = floatArrayOf(38.2946f, 51.6963f, 73.5318f, 51.5014f, 56.0252f, 71.7366f, 41.5493f, 92.3655f, 70.7299f, 92.2041f)
        fun cosine(a: FloatArray, b: FloatArray): Float { var s = 0f; for (i in a.indices) s += a[i] * b[i]; return s }
    }
}
