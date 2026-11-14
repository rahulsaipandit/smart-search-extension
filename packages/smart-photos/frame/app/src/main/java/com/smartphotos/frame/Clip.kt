package com.smartphotos.frame

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import org.json.JSONObject
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.min
import kotlin.math.sqrt

/**
 * CLIP BPE tokenizer, read from the Hugging Face `tokenizer.json` of Xenova/clip-vit-base-patch32.
 * Same behaviour as the `tokenizers` library for ordinary English queries: NFC, whitespace collapse, lowercase,
 * the CLIP split pattern, byte-level BPE with an end-of-word suffix, `<|startoftext|>` ... `<|endoftext|>`.
 */
class ClipTokenizer(json: String) {
    private val vocab = HashMap<String, Int>()
    private val ranks = HashMap<String, Int>()
    private val cache = HashMap<String, IntArray>()
    private val byteChar = arrayOfNulls<String>(256)
    private val split = Regex("<\\|startoftext\\|>|<\\|endoftext\\|>|'s|'t|'re|'ve|'m|'ll|'d|[\\p{L}]+|[\\p{N}]|[^\\s\\p{L}\\p{N}]+")

    init {
        val model = JSONObject(json).getJSONObject("model")
        val v = model.getJSONObject("vocab")
        for (k in v.keys()) vocab[k] = v.getInt(k)
        val m = model.getJSONArray("merges")
        for (i in 0 until m.length()) ranks[m.getString(i)] = i
        // GPT-2 byte -> printable unicode table.
        val keep = ArrayList<Int>()
        keep.addAll(33..126); keep.addAll(161..172); keep.addAll(174..255)
        var extra = 0
        for (b in 0..255) byteChar[b] = if (b in keep) b.toChar().toString() else (256 + extra++).toChar().toString()
    }

    private fun bpe(word: String): IntArray = cache.getOrPut(word) {
        val syms = ArrayList<String>()
        val bytes = word.toByteArray(Charsets.UTF_8)
        for (i in bytes.indices) syms.add(byteChar[bytes[i].toInt() and 255]!! + if (i == bytes.size - 1) "</w>" else "")
        while (syms.size > 1) {
            var best = Int.MAX_VALUE; var at = -1
            for (i in 0 until syms.size - 1) { val r = ranks[syms[i] + " " + syms[i + 1]]; if (r != null && r < best) { best = r; at = i } }
            if (at < 0) break
            syms[at] = syms[at] + syms[at + 1]; syms.removeAt(at + 1)
        }
        IntArray(syms.size) { vocab[syms[it]] ?: EOS }
    }

    /** `<|startoftext|>` + tokens + `<|endoftext|>`, at most [maxLen] ids. */
    fun encode(text: String, maxLen: Int = 77): LongArray {
        val clean = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFC).replace(Regex("\\s+"), " ").trim().lowercase()
        val ids = ArrayList<Long>(); ids.add(BOS.toLong())
        for (m in split.findAll(clean)) for (id in bpe(m.value)) ids.add(id.toLong())
        if (ids.size > maxLen - 1) while (ids.size > maxLen - 1) ids.removeAt(ids.size - 1)
        ids.add(EOS.toLong())
        return ids.toLongArray()
    }

    companion object { const val BOS = 49406; const val EOS = 49407 }
}

/** Image decoding with EXIF orientation, and the CLIP preprocessing (shortest side 224, centre crop, normalise). */
object ImagePrep {
    private val MEAN = floatArrayOf(0.48145466f, 0.4578275f, 0.40821073f)
    private val STD = floatArrayOf(0.26862954f, 0.26130258f, 0.27577711f)

    private fun orientation(f: File): Int = runCatching { ExifInterface(f.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) }.getOrDefault(1)

    private fun fixed(b: Bitmap, o: Int): Bitmap {
        val m = Matrix()
        when (o) {
            2 -> m.postScale(-1f, 1f); 3 -> m.postRotate(180f); 4 -> m.postScale(1f, -1f)
            5 -> { m.postRotate(90f); m.postScale(-1f, 1f) }; 6 -> m.postRotate(90f)
            7 -> { m.postRotate(270f); m.postScale(-1f, 1f) }; 8 -> m.postRotate(270f)
            else -> return b
        }
        val r = Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
        if (r !== b) b.recycle()
        return r
    }

    /**
     * Decodes with the largest power-of-two subsample (at most [maxSample]) that keeps the shortest side >= [minSide] while the longest side
     * still exceeds [maxSide], then applies EXIF orientation. With maxSide = 0 this is exactly Pillow's `Image.draft("RGB", (minSide, minSide))` rule.
     */
    fun decode(f: File, minSide: Int, maxSide: Int = Int.MAX_VALUE, maxSample: Int = 64): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, o)
        if (o.outWidth <= 0) return null
        var s = 1
        while (s * 2 <= maxSample && min(o.outWidth, o.outHeight) / (s * 2) >= minSide && maxOf(o.outWidth, o.outHeight) / s > maxSide) s *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = s; inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val b = BitmapFactory.decodeFile(f.absolutePath, opts) ?: return null
        return fixed(b, orientation(f))
    }

    /**
     * The bitmap's stored RGB values as packed ints, with NO colour-space conversion. `Bitmap.getPixels` converts wide-gamut images (Display P3,
     * common on phones) to sRGB; the desktop pipeline (Pillow) ignores the embedded profile and uses the raw values, so we must too.
     */
    private fun rawRgb(b: Bitmap): IntArray {
        val w = b.width; val h = b.height
        if (b.config != Bitmap.Config.ARGB_8888) {   // e.g. RGB_565 video frames: no wide-gamut data there, so the plain conversion is exact
            val out = IntArray(w * h); b.getPixels(out, 0, w, 0, 0, w, h); return out
        }
        val stride = b.rowBytes
        val bb = java.nio.ByteBuffer.allocate(stride * h); b.copyPixelsToBuffer(bb)
        val a = bb.array(); val out = IntArray(w * h)
        for (y in 0 until h) { var o = y * stride; for (x in 0 until w) { out[y * w + x] = (255 shl 24) or ((a[o].toInt() and 255) shl 16) or ((a[o + 1].toInt() and 255) shl 8) or (a[o + 2].toInt() and 255); o += 4 } }
        return out
    }

    /** A square-ish crop of one face (with a margin) from the library photo, scaled to [size] px, for the People screen. */
    fun faceThumb(f: File, face: FaceRec, size: Int): Bitmap? {
        val b = decode(f, 400, 0, 16) ?: return null
        val mx = face.w * 0.4f; val my = face.h * 0.4f
        val l = ((face.x - mx) * b.width).toInt().coerceIn(0, b.width - 2); val t = ((face.y - my) * b.height).toInt().coerceIn(0, b.height - 2)
        val r = ((face.x + face.w + mx) * b.width).toInt().coerceIn(l + 1, b.width); val bt = ((face.y + face.h + my) * b.height).toInt().coerceIn(t + 1, b.height)
        val crop = Bitmap.createBitmap(b, l, t, r - l, bt - t)
        val out = Bitmap.createScaledBitmap(crop, size, (size * (bt - t).toFloat() / (r - l)).toInt().coerceIn(size / 2, size * 2), true)
        if (crop !== b) b.recycle()
        return out
    }

    class Raw(val w: Int, val h: Int, val px: IntArray)

    /** Upright image as raw packed RGB (see [rawRgb]), decoded with the same power-of-two rule as [decode] (maxSide = 0). */
    fun decodeRaw(f: File, minSide: Int, maxSample: Int = 8): Raw? {
        val b = decode(f, minSide, 0, maxSample) ?: return null
        return Raw(b.width, b.height, rawRgb(b)).also { b.recycle() }
    }

    fun colorSpaceName(b: Bitmap): String = if (android.os.Build.VERSION.SDK_INT >= 26) (b.colorSpace?.name ?: "none") else "n/a"

    /** CHW float tensor (3x224x224) for the CLIP vision tower, from an image file. Mirrors the desktop (S2) preprocessing step for step. */
    fun clipInput(f: File): FloatArray? = decode(f, 448, 0, 8)?.let { clipInput(it) }

    /**
     * Shortest side to 224 with Pillow's BICUBIC (see [PilResize]), centre crop, scale to 0..1, normalise. Consumes (recycles) [b].
     * The size arithmetic uses doubles and round-half-even like the Python it mirrors.
     */
    fun clipInput(b: Bitmap): FloatArray {
        val w0 = b.width; val h0 = b.height
        val src = rawRgb(b); b.recycle()
        val sc = 224.0 / min(w0, h0)
        val w = maxOf(224, Math.rint(w0 * sc).toInt()); val h = maxOf(224, Math.rint(h0 * sc).toInt())
        val px = PilResize.bicubic(src, w0, h0, w, h)
        val l = (w - 224) / 2; val t = (h - 224) / 2
        val out = FloatArray(3 * 224 * 224); val plane = 224 * 224
        for (y in 0 until 224) for (x in 0 until 224) {
            val c = px[(y + t) * w + x + l]; val i = y * 224 + x
            out[i] = (((c shr 16) and 255) / 255f - MEAN[0]) / STD[0]
            out[plane + i] = (((c shr 8) and 255) / 255f - MEAN[1]) / STD[1]
            out[2 * plane + i] = ((c and 255) / 255f - MEAN[2]) / STD[2]
        }
        return out
    }
}

/**
 * Pillow's `Image.resize(size, Image.BICUBIC)` for RGB, reproduced exactly: bicubic kernel a = -0.5 stretched by the shrink factor (so it
 * low-passes like Pillow instead of aliasing like a plain bilinear filter), 22-bit fixed-point weights, horizontal pass first, then vertical,
 * each rounded and clamped to 8 bits. Input and output are packed ARGB ints (alpha ignored / set opaque).
 */
object PilResize {
    private const val PREC = 22

    private fun cubic(x0: Double): Double {
        val a = -0.5; val x = Math.abs(x0)
        return if (x < 1.0) ((a + 2.0) * x - (a + 3.0)) * x * x + 1.0 else if (x < 2.0) (((x - 5.0) * x + 8.0) * x - 4.0) * a else 0.0
    }

    private class Coeffs(val size: Int, val ksize: Int, val start: IntArray, val len: IntArray, val k: IntArray)

    private fun coeffs(inSize: Int, outSize: Int): Coeffs {
        val scale = inSize.toDouble() / outSize
        val fs = maxOf(scale, 1.0); val support = 2.0 * fs
        val ksize = Math.ceil(support).toInt() * 2 + 1
        val start = IntArray(outSize); val len = IntArray(outSize); val k = IntArray(outSize * ksize)
        val w = DoubleArray(ksize)
        for (xx in 0 until outSize) {
            val center = (xx + 0.5) * scale
            var xmin = (center - support + 0.5).toInt(); if (xmin < 0) xmin = 0
            var xmax = (center + support + 0.5).toInt(); if (xmax > inSize) xmax = inSize
            xmax -= xmin
            var sum = 0.0
            for (x in 0 until xmax) { w[x] = cubic((x + xmin - center + 0.5) / fs); sum += w[x] }
            for (x in 0 until xmax) {
                val n = if (sum != 0.0) w[x] / sum else w[x]
                k[xx * ksize + x] = if (n < 0) (-0.5 + n * (1 shl PREC)).toInt() else (0.5 + n * (1 shl PREC)).toInt()
            }
            start[xx] = xmin; len[xx] = xmax
        }
        return Coeffs(outSize, ksize, start, len, k)
    }

    private fun clip8(v: Int): Int { val r = v shr PREC; return if (r < 0) 0 else if (r > 255) 255 else r }

    fun bicubic(src: IntArray, w0: Int, h0: Int, w1: Int, h1: Int): IntArray {
        var cur = src; var cw = w0
        if (w1 != w0) {   // horizontal pass: h0 rows, w0 -> w1 columns
            val c = coeffs(w0, w1); val out = IntArray(w1 * h0)
            for (y in 0 until h0) {
                val row = y * w0
                for (x in 0 until w1) {
                    var r = 1 shl (PREC - 1); var g = r; var b = r
                    val st = c.start[x]; val kb = x * c.ksize
                    for (i in 0 until c.len[x]) { val kk = c.k[kb + i]; val p = cur[row + st + i]; r += ((p shr 16) and 255) * kk; g += ((p shr 8) and 255) * kk; b += (p and 255) * kk }
                    out[y * w1 + x] = (255 shl 24) or (clip8(r) shl 16) or (clip8(g) shl 8) or clip8(b)
                }
            }
            cur = out; cw = w1
        }
        if (h1 != h0) {   // vertical pass: cw columns, h0 -> h1 rows
            val c = coeffs(h0, h1); val out = IntArray(cw * h1)
            for (y in 0 until h1) {
                val st = c.start[y]; val kb = y * c.ksize
                for (x in 0 until cw) {
                    var r = 1 shl (PREC - 1); var g = r; var b = r
                    for (i in 0 until c.len[y]) { val kk = c.k[kb + i]; val p = cur[(st + i) * cw + x]; r += ((p shr 16) and 255) * kk; g += ((p shr 8) and 255) * kk; b += (p and 255) * kk }
                    out[y * cw + x] = (255 shl 24) or (clip8(r) shl 16) or (clip8(g) shl 8) or clip8(b)
                }
            }
            cur = out
        }
        return cur
    }
}

/** The two CLIP ViT-B/32 towers (MatMul-only int8, S2 configuration C). Loaded lazily and released separately so they are never both resident longer than needed. */
class ClipEngine(private val modelsDir: File, private val tok: ClipTokenizer, private val threads: Int = 4) {
    private val env = OrtEnvironment.getEnvironment()
    private var vis: OrtSession? = null
    private var txt: OrtSession? = null
    @Volatile var lastTextUse = 0L

    private fun opts() = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(threads)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    }

    val available: Boolean get() = File(modelsDir, VISION).exists() && File(modelsDir, TEXT).exists()

    private fun norm(v: FloatArray): FloatArray { var n = 0f; for (x in v) n += x * x; n = sqrt(n); for (i in v.indices) v[i] /= n; return v }

    @Synchronized fun embedImage(chw: FloatArray): FloatArray {
        val s = vis ?: env.createSession(File(modelsDir, VISION).absolutePath, opts()).also { vis = it }
        OnnxTensor.createTensor(env, FloatBuffer.wrap(chw), longArrayOf(1, 3, 224, 224)).use { t ->
            s.run(mapOf("pixel_values" to t)).use { r ->
                val b = (r.get(0) as OnnxTensor).floatBuffer
                return norm(FloatArray(b.remaining()).also { b.get(it) })
            }
        }
    }

    @Synchronized fun embedText(query: String): FloatArray {
        val s = txt ?: env.createSession(File(modelsDir, TEXT).absolutePath, opts()).also { txt = it }
        val ids = tok.encode("a photo of $query")
        OnnxTensor.createTensor(env, LongBuffer.wrap(ids), longArrayOf(1, ids.size.toLong())).use { t ->
            s.run(mapOf("input_ids" to t)).use { r ->
                val b = (r.get(0) as OnnxTensor).floatBuffer
                lastTextUse = System.currentTimeMillis()
                return norm(FloatArray(b.remaining()).also { b.get(it) })
            }
        }
    }

    @Synchronized fun closeVision() { vis?.close(); vis = null }
    @Synchronized fun closeText() { txt?.close(); txt = null }
    @Synchronized fun textLoaded() = txt != null
    fun close() { closeVision(); closeText() }

    companion object { const val VISION = "clip_b32_vision_q8mm.onnx"; const val TEXT = "clip_b32_text_q8mm.onnx" }
}
