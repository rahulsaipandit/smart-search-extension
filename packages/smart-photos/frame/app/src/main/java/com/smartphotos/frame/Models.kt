package com.smartphotos.frame

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipInputStream

/** One file the frame needs but does not contain. [unzipTo] set = a zip that unpacks into that folder under `models/`. */
class ModelSpec(val id: String, val title: String, val url: String, val bytes: Long, val sha256: String, val target: String, val unzipTo: String? = null, val unpackedBytes: Long = bytes)

/**
 * The models the app downloads on first run (docs/MODELS.md). The two CLIP files are the project's own MatMul-only int8 builds, hosted in a
 * public Hugging Face repo; the voice model is published by its maker. Each file is checked against a fixed SHA-256 and refused on a mismatch,
 * because search vectors only match when every tablet uses the identical files.
 */
object Models {
    private const val CLIP = "https://huggingface.co/GuideAxon/smart-photos-clip-b32-q8mm/resolve/main/"

    val SPECS = listOf(
        ModelSpec("clip-vision", "Photo search: image model", CLIP + "clip_b32_vision_q8mm.onnx", 96_308_691L,
            "0a8e2bba4c35a7549f7d0611d4f7e5df7b979ef94178b8c4ab1e7d71d6accd6a", "clip_b32_vision_q8mm.onnx"),
        ModelSpec("clip-text", "Photo search: text model", CLIP + "clip_b32_text_q8mm.onnx", 140_536_263L,
            "bb57af7e847e6154b11552fe21e1157765b9fa327e10279703775ca48523a4ae", "clip_b32_text_q8mm.onnx"),
        ModelSpec("vosk", "Voice commands: speech model", "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip", 41_205_931L,
            "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498", "vosk-model-small-en-us-0.15.zip",
            unzipTo = "vosk-model-small-en-us-0.15", unpackedBytes = 71_000_000L),
    )

    /** Debug builds only (test hook): make the first file's expected fingerprint wrong, to prove a bad file is refused and deleted. */
    @Volatile var debugBadHash = false

    fun dir(base: File) = File(base, "models")

    /**
     * Present = right size (for a file) or its marker file exists (for an unpacked folder). Files copied by hand with `adb` during development
     * count as present; their fingerprint is checked only when downloaded.
     */
    fun installed(base: File, s: ModelSpec): Boolean =
        if (s.unzipTo != null) File(dir(base), s.unzipTo + "/am/final.mdl").exists()
        else File(dir(base), s.target).let { it.isFile && it.length() == s.bytes }

    fun missing(base: File): List<ModelSpec> = SPECS.filter { !installed(base, it) }

    /** What still has to be fetched, in bytes (counts a partly downloaded file as partly done). */
    fun remainingBytes(base: File, specs: List<ModelSpec> = missing(base)): Long = specs.sumOf { s ->
        val part = File(dir(base), s.target + ".part")
        s.bytes - (if (part.exists()) minOf(part.length(), s.bytes) else 0L)
    }

    /** Peak disk space needed (a zip and its unpacked folder exist side by side before the zip is deleted), plus the room to keep free. */
    fun diskNeeded(specs: List<ModelSpec>) = specs.sumOf { if (it.unzipTo != null) it.bytes + it.unpackedBytes else it.bytes }
    const val KEEP_FREE = 300L * 1024 * 1024
}

class ModelProgress(val index: Int, val count: Int, val title: String, val done: Long, val total: Long, val overallDone: Long, val overallTotal: Long)

/**
 * Downloads [specs] one after another into `models/`: HTTPS only, resumes a partly downloaded file (`.part`, HTTP Range) after a break or an app
 * restart, retries a few times by itself, verifies the SHA-256 and only then moves the file into place. Never sends anything but a plain
 * User-Agent: no photo, face, voice or device data leaves the tablet.
 */
class ModelDownloader(
    private val base: File,
    private val onProgress: (ModelProgress) -> Unit,
    private val onFinished: (error: String?) -> Unit,
) {
    @Volatile private var cancelled = false
    private var thread: Thread? = null
    val running: Boolean get() = thread?.isAlive == true

    fun cancel() { cancelled = true }

    fun start(specs: List<ModelSpec>) {
        if (running) return
        cancelled = false
        thread = Thread {
            val err = try { run(specs); null } catch (e: Cancelled) { "Paused. Your progress is kept; press Download to continue." } catch (t: Throwable) { t.message ?: t.toString() }
            onFinished(err)
        }.also { it.name = "model-download"; it.start() }
    }

    private class Cancelled : Exception()
    /** A failure that retrying cannot fix (a client error such as 404). */
    private class Fatal(m: String) : IOException(m)

    private fun run(specs: List<ModelSpec>) {
        val dir = Models.dir(base).also { it.mkdirs() }
        val free = runCatching { android.os.StatFs(dir.absolutePath).availableBytes }.getOrDefault(Long.MAX_VALUE)
        val need = Models.diskNeeded(specs) - specs.sumOf { s -> File(dir, s.target + ".part").let { if (it.exists()) it.length() else 0L } }
        if (need + Models.KEEP_FREE > free) throw IOException("Not enough space: about ${need / 1_000_000} MB needed, ${maxOf(0L, free - Models.KEEP_FREE) / 1_000_000} MB can be used. Free some space and try again.")
        val total = specs.sumOf { it.bytes }
        var before = 0L
        android.util.Log.i("FRAME", "MODELS download: ${specs.size} file(s), ${specs.sumOf { it.bytes } / 1_000_000} MB total")
        for ((i, s) in specs.withIndex()) {
            val part = File(dir, s.target + ".part")
            fetch(s, part) { done -> onProgress(ModelProgress(i, specs.size, s.title, done, s.bytes, before + done, total)) }
            if (cancelled) throw Cancelled()
            val want = if (Models.debugBadHash && s.id == "clip-vision") "0".repeat(64) else s.sha256
            val got = sha256(part)
            android.util.Log.i("FRAME", "MODELS ${s.id}: downloaded ${part.length()} bytes, sha256 ${if (got == want) "matches" else "DOES NOT MATCH"}")
            if (got != want) { part.delete(); throw IOException("${s.title}: the downloaded file does not match its fingerprint, so it was refused and deleted. Try again; if it keeps happening the file on the server has changed.") }
            if (s.unzipTo != null) { unzip(part, File(dir, s.unzipTo)); part.delete() }
            else if (!part.renameTo(File(dir, s.target))) throw IOException("Could not save ${s.title}")
            before += s.bytes
        }
        onProgress(ModelProgress(specs.size, specs.size, "Done", total, total, total, total))
    }

    /** Fills [part] up to [s].bytes, resuming from what is already there; retries up to 4 times on a network error. */
    private fun fetch(s: ModelSpec, part: File, progress: (Long) -> Unit) {
        var attempts = 0
        while (true) {
            if (cancelled) throw Cancelled()
            var have = if (part.exists()) part.length() else 0L
            android.util.Log.i("FRAME", "MODELS ${s.id}: ${if (have > 0) "resuming from $have bytes" else "starting"}")
            if (have == s.bytes) { progress(have); return }
            if (have > s.bytes) { part.delete(); have = 0 }
            try {
                val c = open(s.url, have)
                val code = c.responseCode
                val append = when {
                    code == 206 -> true
                    code == 200 && have == 0L -> false
                    code == 200 -> { part.delete(); false }    // the server ignored the resume request: start this file again
                    code == 416 -> { part.delete(); c.disconnect(); continue }
                    in 400..499 && code != 408 && code != 429 -> { c.disconnect(); throw Fatal("${s.title}: the server answered HTTP $code") }
                    else -> { c.disconnect(); throw IOException("${s.title}: the server answered HTTP $code") }
                }
                val written = if (append) have else 0L
                c.inputStream.use { input ->
                    FileOutputStream(part, append).use { out ->
                        val buf = ByteArray(64 * 1024); var n = written; var lastReport = 0L
                        while (true) {
                            if (cancelled) throw Cancelled()
                            val r = input.read(buf); if (r < 0) break
                            out.write(buf, 0, r); n += r
                            val now = System.nanoTime(); if (now - lastReport > 200_000_000L) { lastReport = now; progress(n) }
                        }
                        progress(n)
                    }
                }
                c.disconnect()
                if (part.length() == s.bytes) return
                throw IOException("${s.title}: the download ended early (${part.length()} of ${s.bytes} bytes)")
            } catch (e: Cancelled) { throw e
            } catch (e: Fatal) { throw e
            } catch (e: IOException) {
                if (++attempts >= 4) throw IOException("${s.title}: ${e.message ?: "network error"}. Check the internet connection and press Download to continue.")
                Thread.sleep(2000L * attempts)
            }
        }
    }

    /** Opens [url] following redirects by hand (HTTPS only), asking to resume from byte [from]. */
    private fun open(url: String, from: Long): HttpURLConnection {
        var u = url
        repeat(6) {
            val c = URL(u).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 20_000; c.readTimeout = 30_000
            c.setRequestProperty("User-Agent", "SmartPhotosFrame/0.1")
            if (from > 0) c.setRequestProperty("Range", "bytes=$from-")
            val code = c.responseCode
            if (code in intArrayOf(301, 302, 303, 307, 308)) {
                val next = URL(URL(u), c.getHeaderField("Location") ?: throw IOException("redirect without a location")).toString()
                c.disconnect()
                if (!next.startsWith("https://")) throw IOException("refused a redirect to a non-HTTPS address")
                u = next
            } else return c
        }
        throw IOException("too many redirects")
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input -> val buf = ByteArray(256 * 1024); while (true) { val r = input.read(buf); if (r < 0) break; md.update(buf, 0, r) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Unpacks a zip whose single top-level folder is named like [into]; refuses entries that would land outside it. */
    private fun unzip(zip: File, into: File) {
        val parent = into.parentFile!!
        val tmp = File(parent, ".unpacking-" + into.name).also { it.deleteRecursively(); it.mkdirs() }
        ZipInputStream(zip.inputStream().buffered()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                val out = File(tmp, e.name)
                if (!out.canonicalPath.startsWith(tmp.canonicalPath + File.separator)) throw IOException("unsafe path in the downloaded zip")
                if (e.isDirectory) out.mkdirs() else { out.parentFile?.mkdirs(); FileOutputStream(out).use { z.copyTo(it) } }
            }
        }
        val inner = File(tmp, into.name)
        into.deleteRecursively()
        if (!(inner.renameTo(into))) throw IOException("could not unpack the voice model")
        tmp.deleteRecursively()
    }
}
