package com.smartphotos.frame

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Bitmap
import android.os.Handler
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import java.io.File
import java.util.concurrent.ExecutorService

/**
 * Everything about people: the People screen (named people + unnamed face groups to name), naming the faces of the photo on screen
 * left to right (docs section 8.3), and person-aware search ("photos of Ritu", "Ritu at the beach").
 */
class PeopleController(
    private val act: Activity, private val ui: Handler, private val bg: ExecutorService,
    private val store: PhotoStore, private val faces: FaceStore, val people: People,
    private val overlay: FaceOverlay, private val toastFn: (String, Long) -> Unit,
    private val onPeopleChanged: () -> Unit, private val showAlbum: (String) -> Unit,
    private val spell: (String, (String) -> Unit) -> Unit,
) {
    private fun toast(t: String, ms: Long = 3500) = toastFn(t, ms)
    private var screen: FrameLayout? = null
    private var list: LinearLayout? = null
    private var host: FrameLayout? = null

    // ------------------------------------------------------------------ who is in which photo

    private var cacheKey = -1L
    private var cache: Map<String, Set<Long>> = emptyMap()

    /** path -> ids of the known people in that photo (usable faces only). Cached until people or the face index change. */
    @Synchronized fun personIndex(): Map<String, Set<Long>> {
        val live = store.snapshot().mapTo(HashSet()) { it.path }
        val key = people.version * 1_000_000_000L + faces.scannedCount() * 1_000L + live.size
        if (key == cacheKey) return cache
        val m = HashMap<String, MutableSet<Long>>()
        if (people.all().isNotEmpty()) for (f in faces.all()) if (f.usable && f.path in live) people.match(f.emb)?.let { m.getOrPut(f.path) { HashSet() }.add(it.first.id) }
        cache = m; cacheKey = key
        return m
    }

    fun photoCount(p: Person): Int = personIndex().count { p.id in it.value }

    private val stop = setOf("photos", "photo", "pictures", "picture", "of", "show", "me", "the", "at", "with", "and", "in", "on", "a", "pics")

    /** Splits a query into the known people it names and the rest ("Ritu at the beach" gives [Ritu] and "beach"). */
    fun parseQuery(q: String): Pair<List<Person>, String> {
        var rest = " " + q.lowercase().replace(Regex("[^a-z0-9' ]"), " ").replace(Regex("[ ]+"), " ") + " "
        val found = ArrayList<Person>()
        for (p in people.all().sortedByDescending { it.name.length }) {
            val n = " " + p.name.lowercase() + " "
            if (rest.contains(n)) { found.add(p); rest = rest.replace(n, " ") }
        }
        val words = rest.trim().split(" ").filter { it.isNotEmpty() && it !in stop }
        return found to words.joinToString(" ")
    }

    /** Photos containing all of [ps]; if none do, photos containing any of them (the Boolean says which). */
    fun photosWith(ps: List<Person>, requireAll: Boolean = true): Pair<List<Photo>, Boolean> {
        val idx = personIndex(); val ids = ps.map { it.id }
        val snap = store.snapshot()
        val all = if (requireAll) snap.filter { p -> idx[p.path]?.containsAll(ids) == true } else emptyList()
        if (all.isNotEmpty() || (requireAll && ps.size < 2)) return all to true
        return snap.filter { p -> idx[p.path]?.any { it in ids } == true } to false
    }

    // ------------------------------------------------------------------ naming the faces of the photo on screen

    var naming = false; private set
    private var nFaces: List<FaceRec> = emptyList()

    fun startNaming(photo: Photo?): Boolean {
        if (photo == null || photo.video) { toast("Open a photo first"); return false }
        val fs = faces.facesOf(photo.path).filter { it.widthPx >= 24 }.sortedBy { it.x + it.w / 2 }   // left to right on screen
        if (fs.isEmpty()) { toast(if (faces.has(photo)) "No faces found in this photo" else "Faces in this photo are not scanned yet"); return false }
        naming = true; nFaces = fs
        overlay.onTap = { i -> chooseName("Who is face ${i + 1}?") { nameFace(i, it) } }
        refreshOverlay(); overlay.visibility = View.VISIBLE
        toast("Tap a face to name it, or say \"this is ...\"", 6000)
        return true
    }

    fun refreshOverlay() {
        overlay.faces = nFaces; overlay.names = nFaces.map { people.match(it.emb)?.first?.name }; overlay.invalidate()
    }

    fun stopNaming() { naming = false; nFaces = emptyList(); overlay.visibility = View.GONE; overlay.faces = emptyList() }

    fun nameFace(i: Int, name: String) {
        val f = nFaces.getOrNull(i) ?: return
        val p = people.assign(name, listOf(f.emb))
        onPeopleChanged(); refreshOverlay()
        toast("Face ${i + 1} is ${p.name} (${photoCount(p)} photos)")
    }

    /** Voice: "this is Ritu" names the first unnamed face from the left; "number two is Ritu" names face 2. */
    fun voiceName(name: String, number: Int?) {
        if (!naming) { toast("Say \"name the faces\" first"); return }
        if (name.isBlank()) { toast("I did not catch the name - tap the face to type it"); return }
        val i = number?.minus(1) ?: nFaces.indexOfFirst { people.match(it.emb) == null }
        if (i < 0 || i >= nFaces.size) { toast("Every face here already has a name"); return }
        nameFace(i, name)
    }

    // ------------------------------------------------------------------ dialogs

    /** Pick an existing person or type a new name. */
    fun chooseName(title: String, done: (String) -> Unit) {
        val existing = people.all().map { it.name }
        fun typed() {
            val et = EditText(act).apply { hint = "Name"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS; setSingleLine() }
            AlertDialog.Builder(act).setTitle(title).setView(et)
                .setPositiveButton("Save") { _, _ -> tidyName(et.text.toString())?.let(done) }
                .setNegativeButton("Cancel", null).show()
        }
        // A new name can be typed, or spelled out loud letter by letter (the voice recogniser cannot hear a name it has never seen).
        fun newName() {
            AlertDialog.Builder(act).setTitle("Give the new name").setItems(arrayOf("Type it", "Spell it out")) { _, w -> if (w == 0) typed() else spell(title, done) }
                .setNegativeButton("Cancel", null).show()
        }
        if (existing.isEmpty()) { newName(); return }
        val items = (existing + "New person...").toTypedArray()
        AlertDialog.Builder(act).setTitle(title).setItems(items) { _, w -> if (w < existing.size) done(existing[w]) else newName() }
            .setNegativeButton("Cancel", null).show()
    }

    // ------------------------------------------------------------------ People screen

    var onClose: () -> Unit = {}
    val screenOpen: Boolean get() = screen != null

    fun showScreen(root: FrameLayout) {
        if (screen != null) return
        val s = FrameLayout(act).apply { setBackgroundColor(0xF2101418.toInt()); isClickable = true }
        val col = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setPadding(act.dp(28), act.dp(24), act.dp(28), act.dp(40)) }
        list = col
        s.addView(ScrollView(act).apply { addView(col) }, FrameLayout.LayoutParams(-1, -1))
        root.addView(s, FrameLayout.LayoutParams(-1, -1))
        screen = s; host = root
        refreshScreen()
    }

    fun hideScreen() { screen?.let { host?.removeView(it) }; screen = null; list = null }

    private fun header(t: String) = act.uiLabel(t, 22f, true).apply { setPadding(0, act.dp(22), 0, act.dp(8)) }

    private fun refreshScreen() {
        val col = list ?: return
        col.removeAllViews()
        col.addView(act.uiLabel("Loading people...", 18f))
        bg.execute {
            val live = store.snapshot().mapTo(HashSet()) { it.path }
            val clusters = Clusters.build(faces.all().filter { it.path in live }, people)
            // Thumbnails come from photos only (a video frame has no still to crop); a group seen only in videos cannot be shown, so it is not listed.
            fun isVideo(f: FaceRec) = f.path.substringAfterLast('.').lowercase() in PhotoStore.VIDEO_EXT
            val shown = clusters.filter { c -> c.members.any { !isVideo(it) } }
            val thumbs = shown.map { c -> c.members.filter { !isVideo(it) }.take(4).mapNotNull { m -> runCatching { ImagePrep.faceThumb(File(m.path), m, act.dp(96)) }.getOrNull() } }
            val known = people.all().map { it to photoCount(it) }
            val scanned = faces.scannedCount(); val total = store.snapshot().size
            ui.post { if (list === col) render(col, known, shown, thumbs, scanned, total) }
        }
    }

    private fun render(col: LinearLayout, known: List<Pair<Person, Int>>, clusters: List<Cluster>, thumbs: List<List<Bitmap>>, scanned: Int, total: Int) {
        col.removeAllViews()
        val top = LinearLayout(act).apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(act.uiLabel("People", 30f, true), LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(act.uiButton("Close") { onClose() })
        col.addView(top)
        col.addView(act.uiLabel(if (scanned < total) "Scanning photos for faces: $scanned of $total" else "All $total photos scanned for faces", 15f).apply { setTextColor(0xFF8A97A3.toInt()) })

        col.addView(header(if (known.isEmpty()) "Nobody named yet" else "Known people"))
        for ((p, n) in known) {
            val row = LinearLayout(act).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, act.dp(6), 0, act.dp(6)) }
            row.addView(act.uiLabel("${p.name}   -   $n photos", 20f), LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(act.uiButton("Show") { onClose(); showAlbum(p.name) })
            row.addView(act.uiButton(if (p.private) "Private: on" else "Private", if (p.private) 0xFF2563EB.toInt() else 0xCC20262C.toInt()) { p.private = !p.private; people.save(); refreshScreen() }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = act.dp(8) })
            row.addView(act.uiButton("Rename") { chooseRename(p) }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = act.dp(8) })
            row.addView(act.uiButton("Remove", 0xCC8E2A2A.toInt()) { confirm("Remove ${p.name}? Their photos stay; only the name and face samples are forgotten.") { people.remove(p); onPeopleChanged(); refreshScreen() } }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = act.dp(8) })
            col.addView(row)
        }

        col.addView(header(if (clusters.isEmpty()) "No unnamed groups of faces yet" else "Faces to name (${clusters.size} groups)"))
        for ((ci, c) in clusters.withIndex()) {
            val row = LinearLayout(act).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, act.dp(6), 0, act.dp(6)) }
            for (b in thumbs[ci]) row.addView(ImageView(act).apply { setImageBitmap(b); scaleType = ImageView.ScaleType.CENTER_CROP },
                LinearLayout.LayoutParams(act.dp(96), act.dp(96)).apply { rightMargin = act.dp(8) })
            row.addView(act.uiLabel("${c.photos} photos", 18f), LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = act.dp(8) })
            row.addView(act.uiButton("Name", 0xFF2563EB.toInt()) {
                chooseName("Who is this?") { name ->
                    val p = people.assign(name, diverse(c.members))
                    onPeopleChanged(); toast("${p.name}: ${photoCount(p)} photos"); refreshScreen()
                }
            })
            col.addView(row)
        }

        col.addView(header("Privacy"))
        col.addView(act.uiLabel("Faces and names stay on this tablet. Nothing is sent anywhere.", 15f).apply { setTextColor(0xFF8A97A3.toInt()) })
        col.addView(act.uiButton("Delete all face data", 0xCC8E2A2A.toInt()) {
            confirm("Delete every saved face, group and person? The photos are not touched.") { faces.clear(); people.clear(); onPeopleChanged(); refreshScreen(); toast("All face data deleted") }
        }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = act.dp(10) })
    }

    private fun chooseRename(p: Person) {
        val et = EditText(act).apply { setText(p.name); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS; setSingleLine() }
        AlertDialog.Builder(act).setTitle("Rename ${p.name}").setView(et)
            .setPositiveButton("Save") { _, _ -> people.rename(p, et.text.toString()); onPeopleChanged(); refreshScreen() }
            .setNegativeButton("Cancel", null).show()
    }

    private fun confirm(msg: String, yes: () -> Unit) {
        AlertDialog.Builder(act).setMessage(msg).setPositiveButton("Yes") { _, _ -> yes() }.setNegativeButton("Cancel", null).show()
    }

    /** Up to 6 faces of a group that differ from each other (best faces first), as exemplars. */
    private fun diverse(members: List<FaceRec>): List<FloatArray> {
        val out = ArrayList<FloatArray>()
        for (m in members.sortedByDescending { it.widthPx * it.score }) {
            if (out.size >= 6) break
            if (out.none { e -> var s = 0f; for (i in e.indices) s += e[i] * m.emb[i]; s > 0.85f }) out.add(m.emb)
        }
        return out
    }
}
