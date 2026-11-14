package com.smartphotos.frame

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import kotlin.math.sqrt

private fun dot(a: FloatArray, b: FloatArray): Float { var s = 0f; for (i in a.indices) s += a[i] * b[i]; return s }

/** "mary  ann" -> "Mary Ann": trims, collapses spaces, upper-cases the first letter of every word. Blank -> null. */
fun tidyName(raw: String?): String? =
    raw?.trim()?.split(Regex("[ ]+"))?.filter { it.isNotEmpty() }?.joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }?.takeIf { it.isNotEmpty() }

/**
 * One face found in a library photo. Box coordinates are fractions (0..1) of the *upright* image (EXIF applied), so they map straight onto what
 * the slideshow shows. [widthPx] is the face width in the decoded image, a quality hint: tiny faces give unreliable embeddings.
 */
class FaceRec(val path: String, val x: Float, val y: Float, val w: Float, val h: Float, val score: Float, val widthPx: Int, val emb: FloatArray) {
    val usable: Boolean get() = widthPx >= MIN_PX && score >= MIN_SCORE
    companion object { const val MIN_PX = 40; const val MIN_SCORE = 0.70f }
}

/** Faces of every library photo, in app-private storage (they are biometric data). Keyed by path + mtime + size, like the CLIP index. */
class FaceStore(private val dataDir: File) {
    private class Entry(val mtime: Long, val size: Long, val faces: List<FaceRec>)
    private val lock = Any()
    private val saveLock = Any()
    private val byPath = HashMap<String, Entry>()
    private val file = File(dataDir, "faces.bin")

    fun load() {
        if (!file.exists()) return
        runCatching {
            DataInputStream(BufferedInputStream(file.inputStream())).use { d ->
                if (d.readInt() != MAGIC || d.readInt() != VERSION || d.readInt() != 128) return@use
                val map = HashMap<String, Entry>()
                repeat(d.readInt()) {
                    val p = d.readUTF(); val m = d.readLong(); val s = d.readLong()
                    val faces = List(d.readInt()) { FaceRec(p, d.readFloat(), d.readFloat(), d.readFloat(), d.readFloat(), d.readFloat(), d.readInt(), FloatArray(128) { d.readFloat() }) }
                    map[p] = Entry(m, s, faces)
                }
                synchronized(lock) { byPath.clear(); byPath.putAll(map) }
            }
        }
    }

    fun save() = synchronized(saveLock) {
        val snap = synchronized(lock) { HashMap(byPath) }
        dataDir.mkdirs()
        val tmp = File(dataDir, "faces.bin.tmp")
        DataOutputStream(BufferedOutputStream(tmp.outputStream())).use { d ->
            d.writeInt(MAGIC); d.writeInt(VERSION); d.writeInt(128); d.writeInt(snap.size)
            for ((p, e) in snap) {
                d.writeUTF(p); d.writeLong(e.mtime); d.writeLong(e.size); d.writeInt(e.faces.size)
                for (f in e.faces) { d.writeFloat(f.x); d.writeFloat(f.y); d.writeFloat(f.w); d.writeFloat(f.h); d.writeFloat(f.score); d.writeInt(f.widthPx); for (v in f.emb) d.writeFloat(v) }
            }
        }
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    /** Has this exact photo (same path, mtime and size) been scanned? */
    fun has(p: Photo): Boolean = synchronized(lock) { byPath[p.path]?.let { it.mtime == p.mtime && it.size == p.size } == true }
    fun put(p: Photo, faces: List<FaceRec>) { synchronized(lock) { byPath[p.path] = Entry(p.mtime, p.size, faces) } }
    fun facesOf(path: String): List<FaceRec> = synchronized(lock) { byPath[path]?.faces ?: emptyList() }
    fun all(): List<FaceRec> = synchronized(lock) { byPath.values.flatMap { it.faces } }
    fun scannedCount() = synchronized(lock) { byPath.size }
    fun forget(path: String) { synchronized(lock) { byPath.remove(path) } }

    /** "Delete all face data": the whole face index goes (people are separate, see [People]). */
    fun clear() { synchronized(lock) { byPath.clear() }; file.delete() }

    companion object { const val MAGIC = 0x53504646; const val VERSION = 1 }
}

/** Scans every library image for faces (newest first, resumable), after the search index is built. */
class FaceIndexer(
    private val store: PhotoStore, private val faces: FaceStore, private val pipeline: FacePipeline,
    private val onProgress: (done: Int, total: Int) -> Unit, private val onFinished: () -> Unit,
) {
    @Volatile private var stop = false
    private var thread: Thread? = null

    fun start() {
        if (thread != null) return
        thread = Thread {
            val todo = store.snapshot().filter { !it.video && !faces.has(it) }.sortedByDescending { it.mtime }
            var done = 0
            for (p in todo) {
                if (stop) break
                try {
                    val raw = ImagePrep.decodeRaw(File(p.path), 640, 8)
                    faces.put(p, if (raw == null) emptyList() else find(p.path, raw))
                } catch (t: Throwable) { android.util.Log.w("FRAME", "faces: skipping ${p.path}: $t"); continue }
                done++
                if (done % 25 == 0) { faces.save(); onProgress(done, todo.size) }
            }
            faces.save(); onProgress(done, todo.size)
            if (!stop) onFinished()
        }.also { it.name = "face-indexer"; it.priority = Thread.MIN_PRIORITY; it.start() }
    }

    private fun find(path: String, raw: ImagePrep.Raw): List<FaceRec> {
        val found = pipeline.detect(raw.px, raw.w, raw.h).filter { it.w >= 24f }.sortedByDescending { it.w }.take(12)
        return found.map { f ->
            FaceRec(path, f.x / raw.w, f.y / raw.h, f.w / raw.w, f.h / raw.h, f.score, f.w.toInt(), pipeline.embed(raw.px, raw.w, raw.h, f.lm))
        }
    }

    fun stop() { stop = true; thread?.join(5000) }
}

/** A named person: the embeddings of a few good faces ("exemplars") that new faces are compared with. */
class Person(val id: Long, var name: String, val ex: MutableList<FloatArray>, var private: Boolean = false)

/**
 * Everyone the frame knows. Recognition = best cosine against a person's exemplars (OpenCV's documented SFace threshold, 0.363).
 * Stored app-private as JSON (biometric data: never leaves the device, never in a backup, removable with [clear]).
 */
class People(private val dataDir: File) {
    private val file = File(dataDir, "people.json")
    private val list = ArrayList<Person>()
    private var nextId = 1L
    /** Bumped on every change, so caches derived from the people (who is in which photo) know when to rebuild. */
    @Volatile var version = 0L; private set

    @Synchronized fun all(): List<Person> = ArrayList(list)
    @Synchronized fun byName(n: String): Person? = list.firstOrNull { it.name.equals(n, ignoreCase = true) }
    @Synchronized fun byId(id: Long): Person? = list.firstOrNull { it.id == id }

    @Synchronized fun load() {
        if (!file.exists()) return
        runCatching {
            val j = org.json.JSONObject(file.readText()); val a = j.getJSONArray("people")
            list.clear(); nextId = j.optLong("next", 1L)
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i); val ea = o.getJSONArray("ex")
                val ex = MutableList(ea.length()) { k -> val v = ea.getJSONArray(k); FloatArray(v.length()) { q -> v.getDouble(q).toFloat() } }.filter { it.size == 128 }.toMutableList()
                if (ex.isNotEmpty()) list.add(Person(o.getLong("id"), o.getString("name"), ex, o.optBoolean("private", false)))
            }
        }
    }

    @Synchronized fun save() {
        version++
        val arr = org.json.JSONArray()
        for (p in list) arr.put(org.json.JSONObject().put("id", p.id).put("name", p.name).put("private", p.private)
            .put("ex", org.json.JSONArray().also { ea -> for (e in p.ex) ea.put(org.json.JSONArray().also { a -> e.forEach { a.put(it.toDouble()) } }) }))
        dataDir.mkdirs()
        val tmp = File(dataDir, "people.json.tmp")
        tmp.writeText(org.json.JSONObject().put("people", arr).put("next", nextId).toString())
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    /** Best match over everybody, or null if nobody reaches [MATCH]. */
    @Synchronized fun match(emb: FloatArray, threshold: Float = MATCH): Pair<Person, Float>? {
        var bp: Person? = null; var bc = -1f
        for (p in list) for (e in p.ex) { val c = dot(e, emb); if (c > bc) { bc = c; bp = p } }
        return if (bp != null && bc >= threshold) bp to bc else null
    }

    /** Adds [embs] to the person called [name] (created if new). Returns the person. */
    @Synchronized fun assign(name: String, embs: List<FloatArray>): Person {
        val tidy = tidyName(name) ?: throw IllegalArgumentException("blank name")
        val p = byName(tidy) ?: Person(nextId++, tidy, ArrayList()).also { list.add(it) }
        for (e in embs) addExemplar(p, e)
        save(); return p
    }

    /** Keeps at most [MAX_EX] diverse exemplars: a new face that nearly duplicates an existing one is skipped, and the most redundant one is dropped when full. */
    private fun addExemplar(p: Person, e: FloatArray) {
        if (p.ex.any { dot(it, e) > 0.95f }) return
        p.ex.add(e)
        if (p.ex.size > MAX_EX) {
            var worst = 0; var wv = -1f
            for (i in p.ex.indices) { var m = -1f; for (j in p.ex.indices) if (i != j) m = maxOf(m, dot(p.ex[i], p.ex[j])); if (m > wv) { wv = m; worst = i } }
            p.ex.removeAt(worst)
        }
    }

    /** Renaming to a name somebody already has merges the two (their face samples are combined) instead of creating twins. */
    @Synchronized fun rename(p: Person, name: String) {
        val tidy = tidyName(name) ?: return
        val other = list.firstOrNull { it !== p && it.name.equals(tidy, ignoreCase = true) }
        if (other != null) { for (e in p.ex) addExemplar(other, e); list.remove(p) } else p.name = tidy
        save()
    }
    @Synchronized fun remove(p: Person) { list.remove(p); save() }
    @Synchronized fun clear() { list.clear(); file.delete(); version++ }

    companion object { const val MATCH = 0.363f; const val MAX_EX = 24 }
}

/** A group of unnamed faces that look like the same person. */
class Cluster(val members: List<FaceRec>, val centroid: FloatArray) {
    val photos: Int get() = members.map { it.path }.toSet().size
}

object Clusters {
    private fun norm(v: FloatArray): FloatArray { var n = 0f; for (x in v) n += x * x; n = sqrt(n); return FloatArray(v.size) { v[it] / n } }

    /**
     * Greedy centroid clustering of the usable faces nobody owns yet, best faces first, then a merge pass. [minSize] drops tiny groups
     * (one-off strangers). Thresholds are conservative: two clusters of one person are cheap to name twice, a merged pair of strangers is not.
     */
    fun build(faces: List<FaceRec>, people: People, minSize: Int = 3, join: Float = 0.45f, merge: Float = 0.55f): List<Cluster> {
        val pool = faces.filter { it.usable && people.match(it.emb) == null }.sortedByDescending { it.widthPx * it.score }
        val sums = ArrayList<FloatArray>(); val cents = ArrayList<FloatArray>(); val mem = ArrayList<MutableList<FaceRec>>()
        for (f in pool) {
            var bi = -1; var bc = join
            for (i in cents.indices) { val c = dot(cents[i], f.emb); if (c >= bc) { bc = c; bi = i } }
            if (bi < 0) { sums.add(f.emb.copyOf()); cents.add(f.emb.copyOf()); mem.add(mutableListOf(f)) }
            else { for (k in sums[bi].indices) sums[bi][k] += f.emb[k]; cents[bi] = norm(sums[bi]); mem[bi].add(f) }
        }
        var merged = true
        while (merged) {
            merged = false
            loop@ for (i in cents.indices) for (j in i + 1 until cents.size) if (dot(cents[i], cents[j]) >= merge) {
                for (k in sums[i].indices) sums[i][k] += sums[j][k]
                cents[i] = norm(sums[i]); mem[i].addAll(mem[j]); sums.removeAt(j); cents.removeAt(j); mem.removeAt(j)
                merged = true; break@loop
            }
        }
        return cents.indices.map { Cluster(mem[it], cents[it]) }.filter { it.members.size >= minSize }.sortedByDescending { it.members.size }
    }
}
