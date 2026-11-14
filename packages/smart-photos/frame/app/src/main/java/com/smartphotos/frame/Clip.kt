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

    /** Decodes with the largest power-of-two subsample that keeps the shortest side >= [minSide], then applies EXIF orientation. */
    fun decode(f: File, minSide: Int, maxSide: Int = Int.MAX_VALUE): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, o)
        if (o.outWidth <= 0) return null
        var s = 1
        while (min(o.outWidth, o.outHeight) / (s * 2) >= minSide && maxOf(o.outWidth, o.outHeight) / s > maxSide) s *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = s; inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val b = BitmapFactory.decodeFile(f.absolutePath, opts) ?: return null
        return fixed(b, orientation(f))
    }

    /** CHW float tensor (3x224x224) for the CLIP vision tower. */
    fun clipInput(f: File): FloatArray? {
        val b = decode(f, 448, 1000) ?: return null
        val sc = 224f / min(b.width, b.height)
        val w = maxOf(224, Math.round(b.width * sc)); val h = maxOf(224, Math.round(b.height * sc))
        val small = Bitmap.createScaledBitmap(b, w, h, true)
        val l = (w - 224) / 2; val t = (h - 224) / 2
        val px = IntArray(224 * 224); small.getPixels(px, 0, 224, l, t, 224, 224)
        if (small !== b) small.recycle(); b.recycle()
        val out = FloatArray(3 * 224 * 224); val plane = 224 * 224
        for (i in px.indices) {
            val c = px[i]
            out[i] = (((c shr 16) and 255) / 255f - MEAN[0]) / STD[0]
            out[plane + i] = (((c shr 8) and 255) / 255f - MEAN[1]) / STD[1]
            out[2 * plane + i] = ((c and 255) / 255f - MEAN[2]) / STD[2]
        }
        return out
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
