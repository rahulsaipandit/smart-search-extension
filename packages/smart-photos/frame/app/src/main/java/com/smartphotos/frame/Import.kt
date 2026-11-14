package com.smartphotos.frame

import android.content.Context
import android.net.Uri
import android.os.StatFs
import android.provider.DocumentsContract
import java.io.File
import java.io.InputStream

/** One file offered for import: from a folder the user picked (a USB stick, an SD card, any folder) or, in debug builds, from a plain directory. */
class ImportItem(val name: String, val size: Long, val modified: Long, val open: () -> InputStream)

class ImportResult(val copied: Int, val duplicates: Int, val failed: Int, val error: String? = null)

/**
 * Copies photos and videos into the frame's own library. Copying (not indexing in place) keeps the frame working when the stick is removed
 * and lets the indexer read plain files. Each copy keeps the original date, because the search index and the face store key on
 * path + date + size.
 */
object Importer {
    private val MEDIA = PhotoStore.IMAGE_EXT + PhotoStore.VIDEO_EXT
    private const val FREE_MARGIN = 300L * 1024 * 1024   // never fill the tablet: keep 300 MB free

    /** Every photo and video under a folder picked with the system folder picker (Storage Access Framework). Dot-folders are skipped. */
    fun fromTree(ctx: Context, tree: Uri): List<ImportItem> {
        val out = ArrayList<ImportItem>()
        fun walk(docId: String) {
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
            val cols = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            ctx.contentResolver.query(children, cols, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getString(0); val name = c.getString(1) ?: continue
                    if (c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) { if (!name.startsWith(".")) walk(id); continue }
                    if (name.substringAfterLast('.', "").lowercase() !in MEDIA) continue
                    val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
                    out.add(ImportItem(name, c.getLong(3), c.getLong(4)) { ctx.contentResolver.openInputStream(uri) ?: throw java.io.IOException("cannot open $name") })
                }
            }
        }
        walk(DocumentsContract.getTreeDocumentId(tree))
        return out
    }

    /** Every photo and video under a plain directory (used by the debug-build test hook). */
    fun fromDir(dir: File): List<ImportItem> =
        dir.walkTopDown().filter { it.isFile && it.extension.lowercase() in MEDIA }.map { f -> ImportItem(f.name, f.length(), f.lastModified()) { f.inputStream() } }.toList()

    private fun key(size: Long, modifiedMs: Long) = "$size:${modifiedMs / 1000}"

    /**
     * Copies what is not already in the library into [dest]. A file with the same size and date as one the library has is a duplicate and is
     * skipped (even under another name or in another folder). Stops with an error, copying nothing, if the tablet would be left short of space.
     */
    fun run(items: List<ImportItem>, store: PhotoStore, dest: File, onProgress: (done: Int, total: Int) -> Unit): ImportResult {
        val have = HashSet<String>().also { s -> store.snapshot().forEach { s.add(key(it.size, it.mtime)) } }
        val fresh = ArrayList<ImportItem>(); var dup = 0
        for (it in items) {
            // Some providers report no size or date (0): such a file can never be proven a duplicate, so it is always copied.
            val known = it.size > 0 && it.modified > 0
            if (!known || have.add(key(it.size, it.modified))) fresh.add(it) else dup++
        }
        dest.mkdirs()
        val need = fresh.sumOf { it.size }
        val free = runCatching { StatFs(dest.absolutePath).availableBytes }.getOrDefault(Long.MAX_VALUE)
        if (need > free - FREE_MARGIN) return ImportResult(0, dup, 0, "Not enough space: need ${need / (1024 * 1024)} MB, only ${maxOf(0, free - FREE_MARGIN) / (1024 * 1024)} MB can be used")
        var copied = 0; var failed = 0
        for ((i, it) in fresh.withIndex()) {
            onProgress(i, fresh.size)
            if (copyOne(it, dest)) copied++ else failed++
        }
        onProgress(fresh.size, fresh.size)
        return ImportResult(copied, dup, failed)
    }

    private fun copyOne(item: ImportItem, dest: File): Boolean = try {
        val safe = item.name.replace(Regex("[^A-Za-z0-9._() -]"), "_")
        var target = File(dest, safe); var n = 1
        while (target.exists()) target = File(dest, "${safe.substringBeforeLast('.')}-${n++}.${safe.substringAfterLast('.', "jpg")}")
        val part = File(dest, target.name + ".part")
        try {
            item.open().use { input -> part.outputStream().use { out -> input.copyTo(out) } }
            if (item.modified > 0) part.setLastModified(item.modified)
            part.renameTo(target)
        } finally { if (part.exists()) part.delete() }   // after a successful rename the .part is gone; after a failure it is removed here
    } catch (t: Throwable) { android.util.Log.w("FRAME", "import: ${item.name}: $t"); false }
}
