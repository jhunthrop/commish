package app.trycommish.core.companion

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.CompanionPick
import app.trycommish.api.models.CompanionStatus
import app.trycommish.api.models.DraftCompanion
import app.trycommish.api.models.MockReport
import app.trycommish.api.models.RoomBoard
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** What the companion keeps of a followed draft: the latest answer, the picks held across reads and the
 * board read with the first, and the report once the draft is over, saved with its stamp so the screen
 * opens with no signal. */
@Serializable
data class CompanionAnswer(
    val companion: DraftCompanion,
    val picks: List<CompanionPick>,
    val board: RoomBoard,
    val report: MockReport? = null,
    /** How many name-matched picks the drafter was told of. */
    val seen: Int = 0,
)

/** Why the followed draft cannot be shown. */
enum class CompanionFailure {
    SignedOut,

    /** Not on this account (a 404): follow it again. */
    Missing,

    /** Never read and nothing saved. */
    Unreachable,
}

sealed interface CompanionState {
    data object Loading : CompanionState

    /** The draft at its latest read; stale while the last read failed or the screen shows a saved one. */
    data class Room(
        val model: CompanionModel,
        val stale: Boolean,
    ) : CompanionState

    /** The draft is over and its report is read. */
    data class Report(
        val report: DraftReportModel,
        val bar: CompanionBar,
    ) : CompanionState

    data class Failed(
        val failure: CompanionFailure,
    ) : CompanionState
}

/**
 * The followed draft's view model (CompanionPage.svelte), the iOS CompanionViewModel's: the reads, the cache
 * and the clock injected. The first read asks from pick 0 and takes the board; every later one names the
 * pick count held and merges the picks after it (model.ts mergePicks). While the screen is visible it reads
 * on the web's cadence, every three seconds (model.ts POLL_MS, never faster), until the platform says the
 * draft is over (CompanionPage's loop stops at complete, lost or not), and then reads the report once when
 * the draft was not lost; a report read that fails keeps the room with the reconnecting line and is not
 * tried again, as the web's. A failed draft read keeps the last picks on screen with their stamp and the
 * poll goes on; a refused token signs out; a draft the account does not hold says so and stops. Every read,
 * the poll's or a pull's, is the one in flight: a pull while one runs waits on it, a pull within the
 * interval of the last read finds it fresh enough, and a visible screen of a finished draft reads nothing.
 */
class CompanionViewModel(
    val id: String,
    private val reads: CompanionReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableState = MutableStateFlow<CompanionState>(CompanionState.Loading)
    private val mutableFilter = MutableStateFlow(RoomDraft.ALL)
    private val mutableRefreshing = MutableStateFlow(false)
    private var answer: CompanionAnswer? = null

    /** Whether this view model has read the API yet: the first read asks from pick 0, for the board. */
    private var hasRead = false
    private var poll: Job? = null
    private var inFlight: Deferred<Unit>? = null

    /** When the last read finished, on the injected clock. */
    private var lastRead: Instant? = null

    val state: StateFlow<CompanionState> = mutableState.asStateFlow()

    /** The pool's chip. */
    val filter: StateFlow<String> = mutableFilter.asStateFlow()

    /** A pull's read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** When the picks shown were read. */
    var stamp: Instant? = null
        private set

    /** The poll runs: the screen is visible. */
    val polling: Boolean get() = poll?.isActive == true

    /** "Last read Sun 2:14 pm" beside the reconnecting line while the picks shown are not the latest. */
    fun stampWords(state: CompanionState = this.state.value): String? {
        val shown = stamp ?: return null
        return if ((state as? CompanionState.Room)?.stale == true) "${AppWords.lastRead} ${Format.weekdayTime(shown, zone)}" else null
    }

    /** Whether the poll has more to read: not once the platform says the draft is over (its report read,
     * refused, or never built for a draft the engine lost), nor after a refusal that ends the screen. */
    val done: Boolean
        get() =
            when (mutableState.value) {
                is CompanionState.Report, is CompanionState.Failed -> true
                CompanionState.Loading -> false
                is CompanionState.Room -> answer?.companion?.status == CompanionStatus.complete
            }

    /** The pool's chip: the rows under it from the picks held, no read. */
    fun choose(filter: String) {
        if (filter !in RoomDraft.filters || filter == mutableFilter.value) return
        mutableFilter.value = filter
        val room = mutableState.value as? CompanionState.Room ?: return
        answer?.let { mutableState.value = room.copy(model = model(it)) }
    }

    /** The visibility signal: visible reads at once and then every interval until the draft is done; hidden
     * stops the poll. Saying the same twice changes nothing, and a finished draft is never read again. */
    fun setVisible(visible: Boolean) {
        if (visible == polling) return
        poll?.cancel()
        poll = null
        if (!visible || done) return
        poll =
            viewModelScope.launch {
                while (isActive) {
                    load()
                    if (done) return@launch
                    delay(POLL_MS)
                }
            }
    }

    /** A fresh poll after a failure the member asks to try again: it reads at once. */
    fun retry() {
        if (mutableState.value is CompanionState.Failed) mutableState.value = CompanionState.Loading
        setVisible(false)
        setVisible(true)
    }

    /** A pull to refresh: the read in flight if there is one, nothing within the interval of the last read
     * or once the draft is done, else one read. Never faster than the poll. */
    fun refresh(): Job =
        viewModelScope.launch {
            mutableRefreshing.value = true
            try {
                val running = inFlight?.takeIf { it.isActive }
                val fresh = lastRead?.let { Duration.between(it, clock.now()).toMillis() < POLL_MS } == true
                when {
                    running != null -> running.await()
                    done || fresh -> Unit
                    else -> load()
                }
            } finally {
                mutableRefreshing.value = false
            }
        }

    /** One read, shared: a caller while a read runs waits on that read. */
    suspend fun load() {
        val running = inFlight?.takeIf { it.isActive } ?: viewModelScope.async { read() }.also { inFlight = it }
        running.await()
    }

    /** The read: the saved draft at once on the first open, then the API's since the picks held, and the
     * report once the draft is over and was not lost. */
    private suspend fun read() {
        if (mutableState.value == CompanionState.Loading) showSaved()
        try {
            val since = if (hasRead) answer?.companion?.pickCount ?: 0 else 0
            val fresh = reads.companion(id, since)
            hasRead = true
            val next = merged(fresh)
            keep(next)
            if (fresh.status == CompanionStatus.complete && fresh.lostAt == null && next.report == null) {
                keep(next.copy(report = reads.report(id)))
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            mutableState.value = CompanionState.Failed(CompanionFailure.SignedOut)
            sessionEnd.signedOut()
        } catch (e: ApiFailure) {
            if (e.code == NOT_FOUND) mutableState.value = CompanionState.Failed(CompanionFailure.Missing) else kept()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            kept()
        } finally {
            lastRead = clock.now()
        }
    }

    /** A failed read: the picks held, stale with their stamp, or with none the words for never read. */
    private fun kept() {
        val held = answer
        mutableState.value = if (held != null) shown(held, stale = true) else CompanionState.Failed(CompanionFailure.Unreachable)
    }

    private fun showSaved() {
        val saved = cache.read(route(id)) ?: return
        val decoded =
            try {
                CommishJson.decodeFromString(CompanionAnswer.serializer(), saved.body)
            } catch (e: SerializationException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            } ?: return
        answer = decoded
        stamp = saved.stamp
        mutableState.value = shown(decoded, stale = true)
    }

    /** A fresh answer kept, saved with its stamp and shown. */
    private fun keep(next: CompanionAnswer) {
        val now = clock.now()
        answer = next
        stamp = now
        cache.write(route(id), Cached(CommishJson.encodeToString(CompanionAnswer.serializer(), next), now))
        mutableState.value = shown(next, stale = false)
    }

    /** The answer onto what is held: the board kept from the first read, the picks merged after the answer's
     * since, and the name-matched picks told so far (CompanionRoom's namedSeen). */
    private fun merged(fresh: DraftCompanion): CompanionAnswer {
        val held = answer
        val board = fresh.board ?: held?.board ?: throw ApiFailure(0, "empty", "The first read carried no board.")
        val picks = held?.picks.orEmpty().filter { it.pick <= fresh.since } + fresh.picks
        val seen = held?.companion?.let { if (it.yourTurn) held.seen else it.placedByName.size } ?: 0
        val report = if (fresh.status == CompanionStatus.complete) held?.report else null
        return CompanionAnswer(fresh.copy(board = null), picks, board, report, seen)
    }

    private fun shown(
        held: CompanionAnswer,
        stale: Boolean,
    ): CompanionState {
        val model = model(held)
        val report = held.report ?: return CompanionState.Room(model, stale)
        val names = model.names
        return CompanionState.Report(
            DraftReportModel.of(report, names, CompanionWords.leagueOn(held.companion.host), Words.Companion.reshuffled),
            model.bar,
        )
    }

    private fun model(held: CompanionAnswer): CompanionModel =
        CompanionModel.of(held.companion, held.picks, RoomBoardView.of(held.board, held.companion.teams), held.seen, mutableFilter.value)

    companion object {
        /** model.ts POLL_MS: the API reads the platform at most once every two seconds per draft, so three is
         * the web's cadence and the app's. */
        const val POLL_MS = 3_000L

        /** The cache key of a followed draft. */
        fun route(id: String): String = "/companions/$id"
    }
}
