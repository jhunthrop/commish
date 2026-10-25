package app.trycommish.core.player

import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.board.BoardViewModel
import app.trycommish.core.board.KeptBody
import app.trycommish.core.board.RunBoardReader
import app.trycommish.core.board.RunRead
import kotlinx.coroutines.CancellationException
import java.time.Instant

/** Why a read shown is a saved one: no connection, or the latest read failed another way. */
enum class SavedReason {
    Offline,
    Failed,
    ;

    companion object {
        fun of(e: Throwable): SavedReason = if (BoardViewModel.offline(e)) Offline else Failed
    }
}

/** When one read was made, and why it is a saved one (null for this open's read). */
data class ReadStamp(
    val stamp: Instant,
    val saved: SavedReason?,
)

/** When the reads behind a screen were made: the oldest read's stamp, and why any was a saved one. */
data class Freshness(
    val stamp: Instant,
    val saved: SavedReason?,
) {
    companion object {
        fun of(
            reads: List<ReadStamp>,
            now: Instant,
        ): Freshness {
            val oldest = reads.minOfOrNull { it.stamp } ?: return Freshness(now, null)
            val saved = if (reads.any { it.saved == SavedReason.Offline }) SavedReason.Offline else reads.firstNotNullOfOrNull { it.saved }
            return Freshness(oldest, saved)
        }
    }
}

/** A file or an answer as read now or as last saved: its value, and when and why. */
data class Read<Value>(
    val value: Value,
    val at: ReadStamp,
)

/**
 * The run's files the player sheet and page read, each kept on the phone with the ETag the API gave it
 * (Lane 185's ETags): a read names the kept ETag, a 304 keeps the copy and refreshes its stamp, and with
 * no answer the saved copy stands, saved with the reason. One entry per route under its own key, so the
 * sheet and the page share the index, the manifest and the capture whoever reads them first. A refused
 * answer (a page the run lacks or holds) is never kept and never stood in for; a refused token throws.
 */
class RunFiles(
    private val cache: Cache,
    private val clock: Clock,
) {
    suspend fun <Value> read(
        route: String,
        decode: (String) -> Value,
        fetch: suspend (String?) -> RunRead,
    ): Read<Value> {
        val saved = kept(route)
        return try {
            val kept = RunBoardReader.resolve(fetch(saved?.first?.tag), saved?.first)
            // Decoded before it is kept: a refusal's envelope throws here and is never written.
            val value = decode(kept.body)
            val stamp = clock.now()
            cache.write(key(route), Cached(CommishJson.encodeToString(KeptBody.serializer(), kept), stamp))
            Read(value, ReadStamp(stamp, null))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (refused(e) || saved == null) throw e
            Read(decode(saved.first.body), ReadStamp(saved.second, SavedReason.of(e)))
        }
    }

    private fun kept(route: String): Pair<KeptBody, Instant>? {
        val cached = cache.read(key(route)) ?: return null
        return try {
            CommishJson.decodeFromString(KeptBody.serializer(), cached.body) to cached.stamp
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }
    }

    companion object {
        /** The cache's key for a run file: its own, so no screen's saved read under the route is overwritten. */
        fun key(route: String): String = "run-file:$route"

        /** The API answered and said no (a page the run lacks or holds): no saved copy stands in for it. */
        fun refused(e: Throwable): Boolean = e is ApiFailure && (e.code == "not_found" || e.code == "bad_request")
    }
}

/** A non-run answer as read now or as last saved (his week): the same rule without an ETag. */
class AnswerFiles(
    private val cache: Cache,
    private val clock: Clock,
) {
    suspend fun <Value> read(
        route: String,
        decode: (String) -> Value,
        fetch: suspend () -> String,
    ): Read<Value> =
        try {
            val body = fetch()
            val value = decode(body)
            val stamp = clock.now()
            cache.write(route, Cached(body, stamp))
            Read(value, ReadStamp(stamp, null))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            val saved = cache.read(route) ?: throw e
            Read(decode(saved.body), ReadStamp(saved.stamp, SavedReason.of(e)))
        }
}
