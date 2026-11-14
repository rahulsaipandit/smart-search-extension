package com.smartphotos.frame

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File

/**
 * One photo or video. [vecs] are L2-normalised CLIP image embeddings: one for a photo, a few keyframes for a video.
 * null = not indexed yet; empty = indexed but nothing usable (unreadable file), which is not retried on every launch.
 */
class Photo(val path: String, val mtime: Long, val size: Long, @Volatile var vecs: List<FloatArray>?) {
    val video: Boolean get() = path.substringAfterLast('.').lowercase() in PhotoStore.VIDEO_EXT
}

/** What a deleted photo looked like, so "undo" can put it back. */
class Trashed(val photo: Photo, val original: File, val inTrash: File)

/**
 * The frame's library: every image under [root] (dot-folders are skipped, so `.trash` is not shown), plus the search index.
 * The index lives in the app's private storage ([dataDir]); the photos themselves are never modified except by delete (moved to `.trash`).
 */
class PhotoStore(val root: File, private val dataDir: File) {
    private val lock = Any()
    private val saveLock = Any()   // one writer at a time: the indexer and delete/undo can both save
    private val photos = ArrayList<Photo>()
    private val indexFile = File(dataDir, "index.bin")
    val trashDir = File(root, ".trash")
    val dim = 512

    fun snapshot(): List<Photo> = synchronized(lock) { ArrayList(photos) }
    fun count() = synchronized(lock) { photos.size }
    fun indexedCount() = synchronized(lock) { photos.count { it.vecs != null } }

    /** Loads the saved index, then reconciles it with what is on disk (new files get vec = null, vanished files are dropped). */
    fun load() {
        val known = HashMap<String, Photo>()
        if (indexFile.exists()) runCatching {
            DataInputStream(BufferedInputStream(indexFile.inputStream())).use { d ->
                // An index from an older preprocessing (or an older layout) is discarded: its vectors are not comparable with new ones.
                if (d.readInt() != MAGIC || d.readInt() != PREP_VERSION || d.readInt() != dim) return@use
                repeat(d.readInt()) {
                    val p = d.readUTF(); val m = d.readLong(); val s = d.readLong()
                    val n = d.readByte().toInt()
                    var v = if (n < 0) null else List(n) { FloatArray(dim) { d.readFloat() } }
                    if (p.substringAfterLast('.').lowercase() in VIDEO_EXT && v?.isEmpty() == true) v = null   // retry videos that gave no frames
                    known[p] = Photo(p, m, s, v)
                }
            }
        }
        val found = ArrayList<Photo>()
        root.mkdirs()
        root.walkTopDown().onEnter { !it.name.startsWith(".") || it == root }.filter { it.isFile && it.extension.lowercase() in (IMAGE_EXT + VIDEO_EXT) }.forEach { f ->
            val old = known[f.absolutePath]
            // Same path, same size and time: keep the vector. A changed file is re-indexed.
            found.add(if (old != null && old.mtime == f.lastModified() && old.size == f.length()) old else Photo(f.absolutePath, f.lastModified(), f.length(), null))
        }
        synchronized(lock) { photos.clear(); photos.addAll(found) }
    }

    /** Writes the index atomically (temp file, then rename). Called every few dozen photos while indexing. */
    fun save() = synchronized(saveLock) {
        val snap = snapshot()
        dataDir.mkdirs()
        val tmp = File(dataDir, "index.bin.tmp")
        DataOutputStream(BufferedOutputStream(tmp.outputStream())).use { d ->
            d.writeInt(MAGIC); d.writeInt(PREP_VERSION); d.writeInt(dim); d.writeInt(snap.size)
            for (p in snap) {
                d.writeUTF(p.path); d.writeLong(p.mtime); d.writeLong(p.size)
                val v = p.vecs
                d.writeByte(v?.size ?: -1)
                if (v != null) for (vec in v) for (x in vec) d.writeFloat(x)
            }
        }
        if (!tmp.renameTo(indexFile)) { indexFile.delete(); tmp.renameTo(indexFile) }
    }

    /** Photos best matching [query] (a unit vector): at most [k], and only those within [margin] of the best score and above [floor]. */
    fun search(query: FloatArray, k: Int = 60, margin: Float = 0.05f, floor: Float = 0.17f, only: Set<String>? = null): List<Pair<Photo, Float>> {
        // A video scores as its best keyframe.
        val scored = snapshot().mapNotNull { p ->
            if (only != null && p.path !in only) return@mapNotNull null
            val vs = p.vecs
            if (vs.isNullOrEmpty()) null else p to vs.maxOf { v -> var s = 0f; for (i in v.indices) s += v[i] * query[i]; s }
        }.sortedByDescending { it.second }
        if (scored.isEmpty()) return emptyList()
        val best = scored[0].second
        return scored.take(k).filter { it.second >= floor && it.second >= best - margin }
    }

    /** Moves the photo into `.trash` and forgets it. Returns null if the file could not be moved. */
    fun trash(p: Photo): Trashed? {
        val src = File(p.path)
        trashDir.mkdirs()
        var dst = File(trashDir, src.name)
        var n = 1
        while (dst.exists()) dst = File(trashDir, "${src.nameWithoutExtension}-${n++}.${src.extension}")
        val moved = src.renameTo(dst) || runCatching { src.copyTo(dst); src.delete() }.getOrDefault(false)
        if (!moved || src.exists()) { dst.delete(); return null }
        dst.setLastModified(System.currentTimeMillis())   // retention counts from the day it was trashed, not from when the photo was taken
        synchronized(lock) { photos.remove(p) }
        runCatching { File(dataDir, "trash-log.txt").appendText("${System.currentTimeMillis()}\t${p.path}\n") }
        save()
        return Trashed(p, src, dst)
    }

    /** Deletes trash older than [days] (docs section 7.6: 30-day retention). Returns how many files were removed. */
    fun purgeTrash(days: Int = 30): Int {
        val cutoff = System.currentTimeMillis() - days * 86_400_000L
        return trashDir.listFiles()?.count { it.isFile && it.lastModified() < cutoff && it.delete() } ?: 0
    }

    fun restore(t: Trashed): Boolean {
        if (t.original.exists() || !t.inTrash.exists()) return false
        t.original.parentFile?.mkdirs()
        if (!(t.inTrash.renameTo(t.original) || runCatching { t.inTrash.copyTo(t.original); t.inTrash.delete() }.getOrDefault(false))) return false
        t.original.setLastModified(t.photo.mtime)   // back to the photo's own date, so the index entry still matches
        synchronized(lock) { photos.add(t.photo) }
        save()
        return true
    }

    companion object {
        const val MAGIC = 0x53504959
        /** Bump whenever image preprocessing changes: 3 = Pillow-exact bicubic resize + draft rule + raw (unconverted) RGB (1 = bilinear resize), videos indexed by keyframes. */
        const val PREP_VERSION = 3
        val IMAGE_EXT = setOf("jpg", "jpeg", "png", "webp")
        val VIDEO_EXT = setOf("mp4", "m4v", "mov", "3gp", "webm", "mkv")
    }
}

/** Embeds every photo that has no vector yet, newest first, saving as it goes so a restart resumes where it stopped. */
class Indexer(private val store: PhotoStore, private val clip: ClipEngine, private val onProgress: (done: Int, total: Int) -> Unit, private val onFinished: () -> Unit) {
    @Volatile private var stop = false
    private var thread: Thread? = null

    fun start() {
        if (thread != null) return
        thread = Thread {
            val todo = store.snapshot().filter { it.vecs == null }.sortedByDescending { it.mtime }
            var done = 0
            try {
                for (p in todo) {
                    if (stop) break
                    // One bad photo must not end indexing. A genuinely undecodable file gets a zero vector (matches nothing, not retried);
                    // a transient failure (e.g. out of memory) leaves vec null so the next launch tries again.
                    try {
                        if (p.video) videoVectors(File(p.path))?.let { p.vecs = it }   // null = failed: stays unindexed and is retried next launch
                        else p.vecs = ImagePrep.clipInput(File(p.path))?.let { listOf(clip.embedImage(it)) } ?: emptyList()
                    } catch (t: Throwable) { android.util.Log.w("FRAME", "skipping ${p.path}: $t") }
                    done++
                    if (done % 25 == 0) { store.save(); onProgress(done, todo.size) }
                }
            } catch (t: Throwable) { android.util.Log.e("FRAME", "indexer stopped early", t) }   // e.g. a failed save: still release the model below
            store.save(); onProgress(done, todo.size)
            clip.closeVision()   // the vision tower is only needed while indexing
            if (!stop) onFinished()
        }.also { it.name = "indexer"; it.priority = Thread.MIN_PRIORITY; it.start() }
    }

    /** A few evenly spaced keyframes of the video, each embedded like a photo; the video is later matched by its best frame. */
    private fun videoVectors(f: File): List<FloatArray>? {
        val r = android.media.MediaMetadataRetriever()
        try {
            r.setDataSource(f.absolutePath)
            val durMs = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val out = ArrayList<FloatArray>()
            for (frac in doubleArrayOf(0.15, 0.5, 0.85)) {
                val bmp = r.getFrameAtTime((durMs * 1000 * frac).toLong(), android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: continue
                out.add(clip.embedImage(ImagePrep.clipInput(bmp)))
            }
            return out
        } catch (t: Throwable) { android.util.Log.w("FRAME", "video ${f.name}: $t"); return null }
        finally { runCatching { r.release() } }
    }

    fun stop() { stop = true; thread?.join(5000) }
}
