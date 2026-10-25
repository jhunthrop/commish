package app.trycommish.core.board

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.RunFormat
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.UnknownHostException
import java.time.Instant
import java.time.ZoneId

/** What the Board's chips have chosen: the run's format and the view. Held by the view model, so a
 * sheet opened over the board and closed again finds the same chips pressed. */
data class BoardFilter(
    /** The format as the run's manifest names it ("ppr-12"); null for the run's default, its first. */
    val format: String? = null,
    /** null is the All view. */
    val position: BoardPosition? = null,
)

/** Why a board shown is a saved one: no connection, or the latest read failed another way. */
enum class BoardStale { Offline, Failed }

sealed interface BoardState {
    data object Loading : BoardState

    /** The board, when its read was made, and why it is a saved one, null for this open's read. */
    data class Loaded(
        val model: BoardModel,
        val stamp: Instant,
        val stale: BoardStale?,
    ) : BoardState

    /** No board to draw: a sentence for the member, never an error code. */
    data class Failed(
        val message: String,
    ) : BoardState

    /** The API no longer takes the device's token; the app has signed it out. */
    data object SignedOut : BoardState
}

/**
 * The Board screen's view model (the iOS BoardViewModel's twin, in the Matchup's pattern): the run's
 * reads, the cache and the clock injected; each format's saved read at once, dated, then the run read
 * again naming the ETags kept, so an unchanged run costs five 304s and only refreshes the read's stamp.
 * A failed read keeps the saved board, stale with its reason. The chips' choice is held here, so the
 * sheet opened from a row and closed again, or a pull, leaves them as they were. One read runs at a
 * time: a new one cancels the last.
 */
class BoardViewModel(
    private val reads: RunReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    /** The bar's season: the Rest of season item in season, the Board item before the draft. */
    private val inSeason: Boolean,
    /** The member follows a league. */
    private val following: Boolean,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableState = MutableStateFlow<BoardState>(BoardState.Loading)
    private val mutableFilter = MutableStateFlow(BoardFilter())
    private val mutableFormats = MutableStateFlow<List<RunFormat>>(emptyList())
    private val mutableRefreshing = MutableStateFlow(false)
    private var pull: Job? = null

    /** The read shown, so a position chip redraws it without a read and a failed read keeps it. */
    private var shown: Shown? = null

    private class Shown(
        val format: String?,
        val read: RunBoardRead,
        val stamp: Instant,
        val stale: BoardStale?,
    )

    val state: StateFlow<BoardState> = mutableState.asStateFlow()
    val filter: StateFlow<BoardFilter> = mutableFilter.asStateFlow()

    /** The run's formats as last read, for the format chips over a board that could not be read. */
    val formats: StateFlow<List<RunFormat>> = mutableFormats.asStateFlow()

    /** A pull's read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** Said over a saved board: "You're offline, so this is the last board this device saved, updated
     * Oct 21." with no connection, "Last read Sat 12:00 pm" when the read failed another way. */
    fun stampWords(state: BoardState = this.state.value): String? {
        val loaded = state as? BoardState.Loaded ?: return null
        return when (loaded.stale) {
            null -> null
            BoardStale.Offline -> shown?.read?.let { RunWords.offline(it.manifest) }
            BoardStale.Failed -> "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}"
        }
    }

    /** Reads the run, cancelling a read already running; the spinner shows while it runs. */
    fun load(): Job {
        pull?.cancel()
        return viewModelScope
            .launch {
                mutableRefreshing.value = true
                try {
                    read()
                } finally {
                    mutableRefreshing.value = false
                }
            }.also { pull = it }
    }

    /** A format chip: that format's board, saved or read, in the same view; null when it is the one shown. */
    fun choose(format: String): Job? {
        if (format == (mutableFilter.value.format ?: mutableFormats.value.firstOrNull()?.id)) return null
        mutableFilter.value = mutableFilter.value.copy(format = format)
        shown = null
        mutableState.value = BoardState.Loading
        return load()
    }

    /** A position chip: the same board in another view, with no read. */
    fun choose(position: BoardPosition?) {
        mutableFilter.value = mutableFilter.value.copy(position = position)
        shown?.let { show(it.read, it.stamp, it.stale) }
    }

    /** The format's saved read at once when nothing of it is shown, then the run's routes, each naming its
     * kept ETag; a failed read keeps the board shown, stale with its reason; a refused token signs out. */
    private suspend fun read() {
        val format = mutableFilter.value.format
        val saved = cache.read(route(format))?.let(::decoded)
        if (shown == null && saved != null) show(saved.first, saved.second, BoardStale.Failed)
        try {
            val fresh = RunBoardReader.read(reads, format, shown?.read?.bodies ?: saved?.first?.bodies)
            // A format the run no longer lists reads as the run's default, under the default's key.
            val kept = format?.takeIf { it == fresh.bodies.format }
            if (kept != format) mutableFilter.value = mutableFilter.value.copy(format = kept)
            val stamp = clock.now()
            cache.write(route(kept), Cached(CommishJson.encodeToString(RunBoardBodies.serializer(), fresh.bodies), stamp))
            show(fresh, stamp, stale = null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            sessionEnd.signedOut()
            mutableState.value = BoardState.SignedOut
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            val kept = shown?.takeIf { it.format == format }
            if (kept != null) {
                show(kept.read, kept.stamp, if (offline(e)) BoardStale.Offline else BoardStale.Failed)
            } else {
                mutableState.value = BoardState.Failed(failure(e))
            }
        }
    }

    private fun show(
        read: RunBoardRead,
        stamp: Instant,
        stale: BoardStale?,
    ) {
        shown = Shown(mutableFilter.value.format, read, stamp, stale)
        mutableFormats.value = read.manifest.formats
        mutableState.value =
            BoardState.Loaded(
                BoardModel.of(read, mutableFilter.value.position, inSeason, following, clock.now(), zone),
                stamp,
                stale,
            )
    }

    private fun decoded(saved: Cached): Pair<RunBoardRead, Instant>? =
        try {
            RunBoardRead.of(CommishJson.decodeFromString(RunBoardBodies.serializer(), saved.body)) to saved.stamp
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    /** With nothing shown: the API's own sentence where it answered one, else no connection. */
    private fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad

    companion object {
        /** The cache key of a format's read, the run's default under its own. */
        fun route(format: String?): String = format?.let { "/run/boards/$it" } ?: "/run/boards"

        /** No connection at all, as against a read that failed another way (a timeout, a refused answer):
         * only these say "You're offline" (the iOS review's L5, narrowed). */
        fun offline(e: Throwable): Boolean =
            generateSequence(e) { it.cause }.any { it is UnknownHostException || it is ConnectException || it is NoRouteToHostException }
    }
}
