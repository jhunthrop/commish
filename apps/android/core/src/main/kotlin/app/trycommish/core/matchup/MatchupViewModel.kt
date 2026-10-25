package app.trycommish.core.matchup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.MatchupBox
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId

sealed interface MatchupState {
    data object Loading : MatchupState

    /** The week, when its answer was read, and whether that read is older than the latest try (the saved
     * one shown at once, or kept because the latest read failed). */
    data class Loaded(
        val model: MatchupModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : MatchupState

    /** No week to draw: a sentence for the member, never an error code. */
    data class Failed(
        val message: String,
    ) : MatchupState

    /** The API no longer takes the device's token; the app has signed it out. */
    data object SignedOut : MatchupState
}

/** "Last read Sun 1:52 pm" while the week shown is a saved one or the latest read failed, the instant in
 * the member's zone. Pure, so a snapshot draws it from a state as the screen does. */
fun matchupStamp(
    state: MatchupState,
    zone: ZoneId,
): String? {
    val loaded = state as? MatchupState.Loaded ?: return null
    return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
}

/** The two bodies the Matchup reads, kept together under one stamp: the league read and the box score,
 * null where the API has none. */
@Serializable
internal data class MatchupBodies(
    val sync: String,
    val box: String?,
)

/** What the Matchup draws from: the league read and the box score. */
private data class MatchupAnswer(
    val sync: LeagueSync,
    val box: MatchupBox?,
)

/**
 * The Matchup screen's view model, the iOS one's in the League home's pattern: the reads, the cache and
 * the clock injected; the saved week at once, then the API's. While the screen is visible (on screen with
 * the app started) it reads again on the web's cadence (model.ts POLL_MS, once a minute) and stops the
 * moment it is hidden, backgrounded or the view model is cleared with its screen (the poll runs in the
 * view model's scope). A read that fails keeps the week shown with its stamp, never blank; a 401 signs
 * out and stops the poll.
 */
class MatchupViewModel(
    private val reads: MatchupReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableState = MutableStateFlow<MatchupState>(MatchupState.Loading)
    private val mutableRefreshing = MutableStateFlow(false)
    private var poll: Job? = null
    private var pull: Job? = null

    /** The answer shown, so a failed read redraws it at the clock it failed at. */
    private var answer: MatchupAnswer? = null

    val state: StateFlow<MatchupState> = mutableState.asStateFlow()

    /** A pull's read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The poll runs: the screen is visible. */
    val polling: Boolean get() = poll?.isActive == true

    /** "Last read Sun 1:52 pm" while the week shown is a saved one or the latest read failed. */
    fun stampWords(state: MatchupState = this.state.value): String? = matchupStamp(state, zone)

    /** The visibility signal: true while the screen is on screen with the app started. Visible reads at
     * once and then every [POLL_MS]; hidden stops the poll, so nothing is read in the background. Saying
     * the same twice changes nothing. */
    fun setVisible(
        visible: Boolean,
        leagueId: String,
    ) {
        if (visible == polling) return
        poll?.cancel()
        poll = null
        if (!visible || mutableState.value == MatchupState.SignedOut) return
        poll =
            viewModelScope.launch {
                while (isActive) {
                    read(leagueId)
                    if (mutableState.value == MatchupState.SignedOut) return@launch
                    delay(POLL_MS)
                }
            }
    }

    /** A pull: reads again at once, the spinner shown while it runs. */
    fun load(leagueId: String): Job {
        pull?.cancel()
        return viewModelScope
            .launch {
                mutableRefreshing.value = true
                try {
                    read(leagueId)
                } finally {
                    mutableRefreshing.value = false
                }
            }.also { pull = it }
    }

    /** The saved week at once on the first open, then the API's; a failed read keeps the week shown,
     * dated, redrawn at the clock it failed at; a refused token signs out. */
    private suspend fun read(leagueId: String) {
        val key = MatchupKeys.matchup(leagueId)
        if (mutableState.value == MatchupState.Loading) {
            cache.read(key)?.let { saved -> decoded(saved.body)?.let { show(it, saved.stamp, stale = true) } }
        }
        try {
            val bodies = fresh(leagueId)
            val decoded = MatchupAnswer(decodeEnvelope(bodies.sync), bodies.box?.let { decodeEnvelope<MatchupBox>(it) })
            val stamp = clock.now()
            cache.write(key, Cached(CommishJson.encodeToString(MatchupBodies.serializer(), bodies), stamp))
            show(decoded, stamp, stale = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            sessionEnd.signedOut()
            mutableState.value = MatchupState.SignedOut
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            val loaded = mutableState.value as? MatchupState.Loaded
            mutableState.value =
                loaded?.copy(model = answer?.let(::model) ?: loaded.model, stale = true) ?: MatchupState.Failed(failure(e))
        }
    }

    /** Both reads at once, as the web's Promise.all. */
    private suspend fun fresh(leagueId: String): MatchupBodies =
        coroutineScope {
            val box = async { reads.matchup(leagueId) }
            val sync = reads.sync(leagueId)
            MatchupBodies(sync, box.await())
        }

    private fun show(
        shown: MatchupAnswer,
        stamp: Instant,
        stale: Boolean,
    ) {
        answer = shown
        mutableState.value = MatchupState.Loaded(model(shown), stamp, stale)
    }

    private fun model(shown: MatchupAnswer): MatchupModel = matchupModel(shown.sync, shown.box, clock.now(), zone)

    /** With nothing shown: the API's own sentence where it answered one, else no connection. */
    private fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad

    private fun decoded(body: String): MatchupAnswer? =
        try {
            val bodies = CommishJson.decodeFromString(MatchupBodies.serializer(), body)
            MatchupAnswer(decodeEnvelope(bodies.sync), bodies.box?.let { decodeEnvelope<MatchupBox>(it) })
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    companion object {
        /** The web's cadence (web/src/lib/league/model.ts POLL_MS): the API reads the platform at most once
         * a minute whatever the number of viewers, so a faster poll would only see the same read. */
        const val POLL_MS = 60_000L
    }
}
