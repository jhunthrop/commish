package app.trycommish.core

import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeParseException

/** The last answer of a route, with the instant it was read: shown at once on open, dated. */
data class Cached(
    val body: String,
    val stamp: Instant,
)

/** The last answer per route, kept on the device. A read or a write that fails is a miss, never a
 * crash: the page then reads the API as if nothing were kept. */
interface Cache {
    fun read(key: String): Cached?

    fun write(
        key: String,
        value: Cached,
    )

    /** Forgets every answer: a sign-out keeps no account's pages for the next. */
    fun clear()
}

/** A cache in memory, for tests and previews. */
class MemoryCache : Cache {
    private val entries = mutableMapOf<String, Cached>()

    override fun read(key: String): Cached? = entries[key]

    override fun write(
        key: String,
        value: Cached,
    ) {
        entries[key] = value
    }

    override fun clear() = entries.clear()
}

/** A cache of files in one folder (the app's cache dir), one file per route named by the key's hash:
 * the stamp on the first line, the answer after it. Written to a temp file and renamed, so a read
 * never sees half an answer. A failure goes to `onError` (the app's log) and is a miss. */
class FileCache(
    private val dir: File,
    private val onError: (String, Exception) -> Unit = { _, _ -> },
) : Cache {
    override fun read(key: String): Cached? {
        val file = fileFor(key)
        if (!file.exists()) return null
        return try {
            val text = file.readText()
            val split = text.indexOf('\n')
            if (split < 0) return null
            Cached(text.substring(split + 1), Instant.parse(text.substring(0, split)))
        } catch (e: IOException) {
            onError("cache read $key", e)
            null
        } catch (e: DateTimeParseException) {
            onError("cache read $key", e)
            null
        }
    }

    override fun write(
        key: String,
        value: Cached,
    ) {
        try {
            dir.mkdirs()
            val file = fileFor(key)
            val temp = File(dir, "${file.name}.tmp")
            temp.writeText("${value.stamp}\n${value.body}")
            if (!temp.renameTo(file)) {
                temp.delete()
                throw IOException("rename failed")
            }
        } catch (e: IOException) {
            onError("cache write $key", e)
        }
    }

    override fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun fileFor(key: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
        return File(dir, digest.joinToString("") { "%02x".format(it) })
    }
}
