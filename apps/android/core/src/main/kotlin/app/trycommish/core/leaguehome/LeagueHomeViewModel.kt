package app.trycommish.core.leaguehome

import androidx.lifecycle.ViewModel
import app.trycommish.api.Transport
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.Scoreboard
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

/** The League home's two reads as the API answers them, the envelope's body whole, so the cache keeps
 * exactly what the API sent. */
interface LeagueReads {
    suspend fun sync(leagueId: String): String

    suspend fun scoreboard(leagueId: String): String
}

/** The reads through the generated client. */
class ApiLeagueReads(
    private val transport: Transport,
) : LeagueReads {
    override suspend fun sync(leagueId: String): String =
        transport
            .leagueSync()
            .leagueSync(UUID.fromString(leagueId))
            .response
            .bodyAsText()

    override suspend fun scoreboard(leagueId: String): String =
        transport
            .leagueSync()
            .leagueScoreboard(UUID.fromString(leagueId))
            .response
            .bodyAsText()
}

/** The cache's keys, the routes the answers came from. */
object LeagueHomeKeys {
    fun sync(leagueId: String): String = "/leagues/attached/$leagueId/sync"

    fun scoreboard(leagueId: String): String = "/leagues/attached/$leagueId/scoreboard"
}

sealed interface LeagueHomeState {
    data object Loading : LeagueHomeState

    /** The page, the instant its answer was read, and whether it is the kept answer while the API
     * cannot be reached. */
    data class Loaded(
        val model: LeagueHomeModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : LeagueHomeState

    /** Nothing kept and no answer: a sentence for the member. */
    data class Failed(
        val message: String,
    ) : LeagueHomeState
}

/**
 * The League home: the kept answer at once, dated, then the API's. With no connection the kept page
 * stays (stale); with nothing kept, a sentence. The clock dates fresh answers and draws the page.
 */
class LeagueHomeViewModel(
    private val reads: LeagueReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
) : ViewModel() {
    private val mutableState = MutableStateFlow<LeagueHomeState>(LeagueHomeState.Loading)
    val state: StateFlow<LeagueHomeState> = mutableState.asStateFlow()

    suspend fun load(leagueId: String) {
        val kept = fromCache(leagueId)
        mutableState.value = kept ?: LeagueHomeState.Loading
        mutableState.value = fresh(leagueId) ?: kept?.copy(stale = true) ?: LeagueHomeState.Failed(LeagueHomeWords.cannotLoad)
    }

    private fun fromCache(leagueId: String): LeagueHomeState.Loaded? {
        val sync = cache.read(LeagueHomeKeys.sync(leagueId)) ?: return null
        val board = cache.read(LeagueHomeKeys.scoreboard(leagueId))
        return draw(sync.body, board?.body, sync.stamp, stale = true)
    }

    private suspend fun fresh(leagueId: String): LeagueHomeState.Loaded? {
        val (sync, board) =
            orNull {
                coroutineScope {
                    val board = async { orNull { reads.scoreboard(leagueId) } }
                    reads.sync(leagueId) to board.await()
                }
            } ?: return null
        val stamp = clock.now()
        val drawn = draw(sync, board, stamp, stale = false) ?: return null
        cache.write(LeagueHomeKeys.sync(leagueId), Cached(sync, stamp))
        board?.let { cache.write(LeagueHomeKeys.scoreboard(leagueId), Cached(it, stamp)) }
        return drawn
    }

    /** The page from two bodies, null when the league's answer is not one (an error envelope). A
     * scoreboard that does not read leaves the page without its games. */
    private fun draw(
        syncBody: String,
        boardBody: String?,
        stamp: Instant,
        stale: Boolean,
    ): LeagueHomeState.Loaded? {
        val sync = orNull { decodeEnvelope<LeagueSync>(syncBody) } ?: return null
        val board = boardBody?.let { orNull { decodeEnvelope<Scoreboard>(it) } }
        return LeagueHomeState.Loaded(leagueHomeModel(sync, board, clock.now(), zone), stamp, stale)
    }
}

/** The value, or null when making it throws anything but a cancellation. */
private inline fun <T> orNull(block: () -> T): T? =
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        null
    }
