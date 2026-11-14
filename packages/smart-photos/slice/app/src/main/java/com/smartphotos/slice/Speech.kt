package com.smartphotos.slice

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.io.RandomAccessFile

/** The closed command grammar for the frame (docs/SmartPhotos.md §8.2). Names such as "rahul" may be out of vocabulary on purpose. */
val COMMANDS = listOf(
    "pause", "resume", "next photo", "previous photo", "delete this photo", "yes", "cancel", "show me the beach",
    "show me the ocean", "show me seaside", "show me birthday photos", "name the faces", "this is rahul", "this is priya",
    "stop listening", "dim the screen", "show everything", "sound on", "sound off", "slower", "faster",
)

/** Offline Vosk recogniser restricted to [COMMANDS] (+ `[unk]` so unrelated speech is rejected, not forced onto a command). */
class VoiceCommands(modelDir: File) {
    private val model: Model
    private val grammar = "[" + (COMMANDS + "[unk]").joinToString(",") { "\"$it\"" } + "]"
    @Volatile private var live: Thread? = null   // non-null while the mic loop should run
    private var liveThread: Thread? = null

    init {
        LibVosk.setLogLevel(LogLevel.WARNINGS)
        model = Model(modelDir.absolutePath)
    }

    private fun textOf(json: String) = JSONObject(json).optString("text", "")

    /** Feeds a 16 kHz mono 16-bit PCM WAV through the recogniser; returns (text, wall ms for the whole decode, audio seconds). */
    fun recognizeWav(f: File): Triple<String, Long, Double> {
        val bytes = RandomAccessFile(f, "r").use { raf ->
            // Walk the RIFF chunks to find "data" (headers vary: SAPI writes an 18-byte fmt chunk, so audio is not always at byte 44).
            raf.seek(12)
            var dataLen = 0L
            while (raf.filePointer + 8 <= raf.length()) {
                val id = ByteArray(4).also { raf.readFully(it) }
                val len = Integer.reverseBytes(raf.readInt()).toLong() and 0xFFFFFFFFL
                if (String(id) == "data") { dataLen = minOf(len, raf.length() - raf.filePointer); break }
                raf.seek(raf.filePointer + len + (len and 1L))
            }
            ByteArray(dataLen.toInt()).also { raf.readFully(it) }
        }
        val shorts = ShortArray(bytes.size / 2) { ((bytes[2 * it + 1].toInt() shl 8) or (bytes[2 * it].toInt() and 0xFF)).toShort() }
        val t0 = System.nanoTime()
        val sb = StringBuilder()
        Recognizer(model, 16000f, grammar).use { rec ->
            var i = 0
            while (i < shorts.size) {
                val n = minOf(4000, shorts.size - i)
                if (rec.acceptWaveForm(shorts.copyOfRange(i, i + n), n)) sb.append(' ').append(textOf(rec.result))
                i += n
            }
            sb.append(' ').append(textOf(rec.finalResult))
        }
        val ms = (System.nanoTime() - t0) / 1_000_000
        return Triple(sb.toString().trim().replace(Regex("\\s+"), " "), ms, shorts.size / 16000.0)
    }

    /** Live microphone loop; [onFinal] gets (text, millis between last non-empty partial and the final result). */
    fun startLive(onFinal: (String, Long) -> Unit, onLevel: (Double) -> Unit = {}) {
        if (live != null) return
        val t = Thread {
            val minBuf = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val rec = AudioRecord(MediaRecorder.AudioSource.MIC, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBuf * 4)
            if (minBuf <= 0 || rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); live = null; return@Thread }
            val r = Recognizer(model, 16000f, grammar)
            val buf = ShortArray(2000)
            var lastPartialAt = 0L
            var lastPartial = ""
            rec.startRecording()
            while (live != null) {
                val n = rec.read(buf, 0, buf.size)
                if (n < 0) break
                if (n == 0) continue
                var s = 0.0; for (i in 0 until n) s += buf[i].toDouble() * buf[i]
                onLevel(Math.sqrt(s / n))
                if (r.acceptWaveForm(buf, n)) {
                    val text = textOf(r.result)
                    if (text.isNotEmpty()) onFinal(text, if (lastPartialAt > 0) System.currentTimeMillis() - lastPartialAt else -1)
                    lastPartial = ""; lastPartialAt = 0
                } else {
                    val p = JSONObject(r.partialResult).optString("partial", "")
                    if (p.isNotEmpty() && p != lastPartial) { lastPartial = p; lastPartialAt = System.currentTimeMillis() }
                }
            }
            runCatching { rec.stop() }; rec.release(); r.close()
        }
        t.name = "vosk-live"; live = t; liveThread = t; t.start()
    }

    fun stopLive() { live = null }

    /** Stops the mic loop and waits for it to finish before freeing the model it is still using. */
    fun close() { stopLive(); liveThread?.join(2000); liveThread = null; model.close() }
}
