package com.smartphotos.frame

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File

/** Fixed commands (docs/SmartPhotos.md §8.2). "show me X" phrases are added from the search vocabulary. */
val BASE_COMMANDS = listOf(
    "pause", "resume", "next photo", "previous photo", "delete this photo", "yes", "cancel", "undo that",
    "show everything", "slower", "faster", "sound on", "sound off", "dim the screen", "brighten the screen", "stop listening", "pause sensing", "search for", "name the faces", "skip", "done", "show people",
)

/** Words offered after "show me" - the S2 query list plus a few extras. Anything else is rejected by the recogniser, not guessed. */
val SEARCH_WORDS = listOf(
    "seaside", "ocean", "beach", "sunset", "birthday cake", "birthday photos", "snow", "mountains", "forest", "flowers", "dog", "cat", "food",
    "restaurant", "temple", "fireworks", "kids playing", "wedding", "city at night", "group photo", "selfie", "street", "boat", "lake",
    "garden", "festival", "baby", "bicycle", "river", "waterfall", "park", "christmas tree", "swimming pool", "hotel room", "building", "sky",
)

/** Offline Vosk recogniser restricted to a closed phrase list (+ `[unk]` so unrelated speech is rejected). */
class Voice(modelDir: File, phrases: List<String>) {
    private val model: Model
    /** null = open vocabulary (no grammar): used for one utterance after "search for", where any words must be accepted. */
    @Volatile private var grammar: String? = grammarOf(phrases)
    private fun grammarOf(p: List<String>) = "[" + (p + "[unk]").joinToString(",") { "\"$it\"" } + "]"

    /** Takes effect the next time [start] is called. */
    fun setOpen() { grammar = null }

    /** Takes effect the next time [start] is called (people were added or renamed, so their names must become recognisable). */
    fun setPhrases(p: List<String>) { grammar = grammarOf(p) }
    @Volatile private var live: Thread? = null
    private var liveThread: Thread? = null

    init { LibVosk.setLogLevel(LogLevel.WARNINGS); model = Model(modelDir.absolutePath) }

    val isLive: Boolean get() = live != null

    /** Mic loop on its own thread; [onFinal] gets each recognised phrase (without `[unk]`). */
    fun start(onFinal: (String) -> Unit) {
        if (live != null) return
        val t = Thread {
            val self = Thread.currentThread()
            val minBuf = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (minBuf <= 0) { if (live === self) live = null; return@Thread }
            val rec = runCatching { AudioRecord(MediaRecorder.AudioSource.MIC, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBuf * 4) }.getOrNull()
            if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) { rec?.release(); if (live === self) live = null; return@Thread }
            val g = grammar
            val r = if (g == null) Recognizer(model, 16000f) else Recognizer(model, 16000f, g)
            val buf = ShortArray(2000)
            try {
                rec.startRecording()
                while (live === self) {
                    val n = rec.read(buf, 0, buf.size)
                    if (n < 0) break
                    if (n == 0) continue
                    if (r.acceptWaveForm(buf, n)) {
                        val text = JSONObject(r.result).optString("text", "").replace("[unk]", " ").trim().replace(Regex("[ ]+"), " ")
                        if (text.isNotEmpty()) onFinal(text)
                    }
                }
            } finally { runCatching { rec.stop() }; rec.release(); r.close(); if (live === self) live = null }
        }
        t.name = "vosk-live"; live = t; liveThread = t; t.start()
    }

    /** Stops the mic loop and waits briefly for the microphone to be released. Call from a background thread. */
    fun stop() { live = null; liveThread?.join(1500); liveThread = null }
    fun close() { stop(); model.close() }
}
