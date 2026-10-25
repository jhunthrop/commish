package app.trycommish.core.start

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LineupAdvice
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.ValueWords
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

sealed interface StartState {
    data object Loading : StartState

    /** The lineup, when its answer was read, and whether that read is older than this open (the saved
     * one, shown at once or because the latest read failed). */
    data class Loaded(
        val model: StartModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : StartState

    /** No lineup to draw: a sentence for the member, never an error code. */
    data class Failed(
        val message: String,
    ) : StartState

    /** The API no longer takes the device's token; the app has signed it out. */
    data object SignedOut : StartState
}

/** Everything the screen draws from: the lineup, the move's step, the line under a copied lineup, the
 * rows whose evidence line is open. */
data class StartUi(
    val state: StartState = StartState.Loading,
    val step: MoveStep = MoveStep.Closed,
    val copied: List<List<FootRun>>? = null,
    val opened: Set<String> = emptySet(),
)

/** What the pin above the bar shows: the one verb and whether it can be pressed, the line under it, or
 * the move's confirmation in the verb's place (one verb on screen). */
data class StartPin(
    val verb: String?,
    val enabled: Boolean,
    val foot: List<List<FootRun>>,
    val panel: MovePanel?,
) {
    val isEmpty: Boolean get() = verb == null && foot.isEmpty() && panel == null
}

/** "Last read Sat 12:00 pm" while the lineup shown is a saved one, the instant in the member's zone. */
fun startStamp(
    ui: StartUi,
    zone: ZoneId,
): String? {
    val loaded = ui.state as? StartState.Loaded ?: return null
    return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
}

/** The pin: the confirmation while it is open; else the verb, disabled with the stamp's reason while the
 * lineup shown is a saved one (a move made from it would not be the platform's lineup). Pure, so a
 * snapshot draws it from a state as the screen does. */
fun startPin(
    ui: StartUi,
    platform: String,
    zone: ZoneId,
): StartPin {
    MovePanel.of(ui.step, platform)?.let { return StartPin(null, false, emptyList(), it) }
    val loaded = ui.state as? StartState.Loaded ?: return StartPin(null, false, emptyList(), null)
    val verb = loaded.model.verb?.title
    val stamp = startStamp(ui, zone)
    if (loaded.stale && verb != null && stamp != null) {
        return StartPin(verb, false, listOf(listOf(FootRun("$stamp. ${AppWords.readAgainToSet}"))), null)
    }
    return StartPin(verb, verb != null, ui.copied ?: loaded.model.foot, null)
}

/**
 * The Start screen's view model, the iOS one's in the League home's pattern: the reads, the cache and the
 * clock injected; the saved lineup at once (its verb disabled, dated), then the API's; the verb that
 * copies the lineup or plans and makes the move on the platform; the evidence lines a member opens. The
 * screen decides nothing. A 401 anywhere signs the device out.
 */
class StartViewModel(
    private val reads: LineupReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val league: LeagueHost,
    /** Puts the lineup on the clipboard and says whether it took. */
    private val copy: (String) -> Boolean,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableUi = MutableStateFlow(StartUi())
    private val mutableRefreshing = MutableStateFlow(false)
    private var loadJob: Job? = null

    /** The answer shown, so a press reads it again at the clock it is pressed at. */
    private var answer: LineupAdvice? = null

    /** The move as planned: the one the token makes, whatever the screen reads meanwhile. */
    private var planned: HostMoveInput? = null

    val ui: StateFlow<StartUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The league last asked for, so a screen coming back into view does not read it again. */
    var shown: String? = null
        private set

    val platform: String get() = ValueWords.platform(league)

    /** "Last read Sat 12:00 pm" while the lineup shown is a saved one. */
    fun stampWords(ui: StartUi = this.ui.value): String? = startStamp(ui, zone)

    /** The pin for the screen as it is. */
    fun pin(ui: StartUi = this.ui.value): StartPin = startPin(ui, platform, zone)

    /** The saved lineup at once on the first open, then the API's; a failed read keeps the lineup shown,
     * dated; a refused token signs out. Each call cancels the one before. */
    fun load(leagueId: String): Job {
        shown = leagueId
        loadJob?.cancel()
        return viewModelScope
            .launch {
                mutableRefreshing.value = true
                try {
                    read(leagueId)
                } finally {
                    mutableRefreshing.value = false
                }
            }.also { loadJob = it }
    }

    private suspend fun read(leagueId: String) {
        val key = StartKeys.lineup(leagueId)
        if (ui.value.state == StartState.Loading) {
            cache.read(key)?.let { saved -> decoded(saved.body)?.let { show(it, saved.stamp, stale = true) } }
        }
        try {
            val body = reads.lineup(leagueId)
            val fresh = decodeEnvelope<LineupAdvice>(body)
            val stamp = clock.now()
            cache.write(key, Cached(body, stamp))
            show(fresh, stamp, stale = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            mutableUi.update { ui ->
                val loaded = ui.state as? StartState.Loaded
                ui.copy(state = loaded?.copy(stale = true) ?: StartState.Failed(failure(e)))
            }
        }
    }

    /** The verb: the lineup read again at the clock it is pressed at (a game that kicked off since the
     * read takes its change back, and with nothing left to change nothing is sent), then the move planned
     * on the platform, or the lineup copied. Nothing while the lineup shown is a saved one. */
    fun press(leagueId: String): Job? {
        val loaded = ui.value.state as? StartState.Loaded ?: return null
        val shownAnswer = answer
        if (loaded.stale || shownAnswer == null || ui.value.step != MoveStep.Closed) return null
        val model = startModel(shownAnswer, league, clock.now(), zone)
        mutableUi.update { it.copy(state = loaded.copy(model = model)) }
        return when (model.verb) {
            StartVerb.Make -> plan(leagueId, model)
            StartVerb.Copy -> {
                mutableUi.update { it.copy(copied = model.copied(copy(model.copyText))) }
                null
            }
            null -> null
        }
    }

    private fun plan(
        leagueId: String,
        model: StartModel,
    ): Job {
        planned = model.move
        mutableUi.update { it.copy(step = MoveStep.Planning) }
        return viewModelScope.launch {
            val step =
                try {
                    MoveStep.planned(reads.planMove(leagueId, model.move))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Unauthorized) {
                    signOut()
                    MoveStep.Closed
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    MoveStep.failed(e, MoveStep.Stage.Plan, platform, model.page)
                }
            mutableUi.update { it.copy(step = step) }
        }
    }

    /** Makes the planned move once with its token, then reads the lineup again. */
    fun confirm(leagueId: String): Job? {
        val step = ui.value.step as? MoveStep.Confirm ?: return null
        val move = planned ?: return null
        mutableUi.update { it.copy(step = MoveStep.Sending(step.sentence)) }
        return viewModelScope.launch {
            try {
                val made = MoveStep.made(reads.makeMove(leagueId, move, step.token))
                mutableUi.update { it.copy(step = made) }
                read(leagueId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                mutableUi.update { it.copy(step = MoveStep.Closed) }
                signOut()
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                val page = (ui.value.state as? StartState.Loaded)?.model?.page
                mutableUi.update { it.copy(step = MoveStep.failed(e, MoveStep.Stage.Make, platform, page)) }
            }
        }
    }

    /** Closes the confirmation (Not now, Done); never while the move is on its way. */
    fun close() {
        if (ui.value.step is MoveStep.Sending) return
        planned = null
        mutableUi.update { it.copy(step = MoveStep.Closed) }
    }

    /** Opens or closes a swap's evidence line. */
    fun toggleWhy(id: String) {
        mutableUi.update { it.copy(opened = if (id in it.opened) it.opened - id else it.opened + id) }
    }

    private fun show(
        advice: LineupAdvice,
        stamp: Instant,
        stale: Boolean,
    ) {
        answer = advice
        val model = startModel(advice, league, clock.now(), zone)
        mutableUi.update { it.copy(state = StartState.Loaded(model, stamp, stale)) }
    }

    private fun signOut() {
        sessionEnd.signedOut()
        mutableUi.update { it.copy(state = StartState.SignedOut, step = MoveStep.Closed) }
    }

    /** With nothing shown: the API's own sentence where it answered one, else no connection. */
    private fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad

    private fun decoded(body: String): LineupAdvice? =
        try {
            decodeEnvelope<LineupAdvice>(body)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }
}
