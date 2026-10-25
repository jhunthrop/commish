package app.trycommish.core.leaguehome

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.Scoreboard
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

sealed interface LeagueHomeState {
    data object Loading : LeagueHomeState

    /** The page and the instant its answer was read. `stale` only once a refresh has failed: the kept
     * page is on screen because the API cannot be reached. */
    data class Loaded(
        val model: LeagueHomeModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : LeagueHomeState

    /** No page to draw: a sentence for the member, never an error code. */
    data class Failed(
        val message: String,
    ) : LeagueHomeState

    /** The API no longer takes the device's token; the app has signed it out. */
    data object SignedOut : LeagueHomeState
}

/**
 * A league's home, the League tab's or one pushed from the league switch: [load] draws the league the
 * shell shows (ShellViewModel, from GET /me): the kept page at once, dated, then the API's. With no connection the kept page stays (stale); with nothing kept, a
 * sentence; a 401 anywhere signs the device out. Each call cancels the one before it and runs in the
 * view model's scope, so leaving the tab or pulling twice never races.
 */
class LeagueHomeViewModel(
    private val reads: LeagueReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableState = MutableStateFlow<LeagueHomeState>(LeagueHomeState.Loading)
    private val mutableRefreshing = MutableStateFlow(false)
    private var job: Job? = null

    val state: StateFlow<LeagueHomeState> = mutableState.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The league last asked for, so a screen coming back into view does not read it again. */
    var shown: String? = null
        private set

    fun load(leagueId: String): Job {
        shown = leagueId
        return replace { loadLeague(leagueId) }
    }

    private fun replace(block: suspend () -> Unit): Job {
        job?.cancel()
        return viewModelScope
            .launch {
                mutableRefreshing.value = true
                try {
                    block()
                } finally {
                    mutableRefreshing.value = false
                }
            }.also { job = it }
    }

    private suspend fun loadLeague(leagueId: String) {
        showKept(leagueId)
        try {
            val drawn = fresh(leagueId)
            if (drawn != null) mutableState.value = drawn else markStale()
        } catch (e: Unauthorized) {
            signOut()
        }
    }

    /** The kept page, unmarked while the refresh runs; Loading when nothing is kept. */
    private fun showKept(leagueId: String) {
        mutableState.value = fromCache(leagueId) ?: LeagueHomeState.Loading
    }

    /** The refresh failed: the kept page stays, marked stale; with none, the sentence. */
    private fun markStale() {
        mutableState.value = (mutableState.value as? LeagueHomeState.Loaded)?.copy(stale = true)
            ?: LeagueHomeState.Failed(AppWords.cannotLoad)
    }

    private fun signOut() {
        sessionEnd.signedOut()
        mutableState.value = LeagueHomeState.SignedOut
    }

    private fun fromCache(leagueId: String): LeagueHomeState.Loaded? {
        val sync = cache.read(LeagueHomeKeys.sync(leagueId)) ?: return null
        val board = cache.read(LeagueHomeKeys.scoreboard(leagueId))
        return draw(sync.body, board?.body, sync.stamp)
    }

    /** The API's page, null when it cannot be reached or answers no league; Unauthorized passes. */
    private suspend fun fresh(leagueId: String): LeagueHomeState.Loaded? {
        val (sync, board) =
            orNull {
                coroutineScope {
                    val board = async { orNull { reads.scoreboard(leagueId) } }
                    reads.sync(leagueId) to board.await()
                }
            } ?: return null
        val stamp = clock.now()
        val drawn = draw(sync, board, stamp) ?: return null
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
    ): LeagueHomeState.Loaded? {
        val sync = orNull { decodeEnvelope<LeagueSync>(syncBody) } ?: return null
        val board = boardBody?.let { orNull { decodeEnvelope<Scoreboard>(it) } }
        return LeagueHomeState.Loaded(leagueHomeModel(sync, board, clock.now(), zone), stamp, stale = false)
    }
}

/** The value, or null when making it throws anything but a cancellation or Unauthorized, which pass. */
private inline fun <T> orNull(block: () -> T): T? =
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Unauthorized) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        null
    }
