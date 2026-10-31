package app.trycommish.core.trades

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeCheckInput
import app.trycommish.api.models.TradeTeam
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

/**
 * The Trades screen's view model, the iOS one's in the Waivers' pattern: the reads, the cache and the clock
 * injected; the saved trades at once (dated), then the API's; the builder is the screen (Lane 260): it opens
 * on our best trade's team with nothing ticked, an idea loads its ticks, a tick or another team posts the
 * check of the trade built, keeping only the latest answer; the verb copies the built trade's offer and
 * opens the platform's trade page, Share copies it as text. A read that fails keeps what is shown, dated by
 * its stamp, unless the API refused it in its own words. A 401 anywhere signs the device out.
 */
class TradesViewModel(
    private val reads: TradeReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val host: LeagueHost,
    private val me: TradeMe,
    /** Puts the text on the clipboard and says whether it took. */
    private val copy: (String) -> Boolean,
    /** Opens the platform's trade page. */
    private val openPage: (String) -> Unit,
    private val sessionEnd: SessionEnd,
    /** The platform's words: the league's own, or the store graphics' neutral one (Lane 310). */
    private val words: HostWords = HostWords.of(host),
) : ViewModel() {
    private val mutableUi = MutableStateFlow(TradesUi())
    private val mutableRefreshing = MutableStateFlow(false)
    private var loadJob: Job? = null

    /** The trades' answer, which the ideas and the rosters are drawn from. */
    private var answer: TradeAdvice? = null

    /** The builder's picks, its latest answer with the picks it was read for, and why it has none. */
    private var picks: TradePicks? = null
    private var checked: TradeCheck? = null
    private var answered: TradePicks? = null
    private var checkProblem: String? = null
    private var checkAsk = 0

    /** The check being read: a newer tick cancels it, so only the latest is asked of the API. */
    private var checkJob: Job? = null

    val ui: StateFlow<TradesUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The league last asked for, so a screen coming back into view does not read it again. */
    var shown: String? = null
        private set

    private val platform: String get() = words.name

    /** "Last read Sat 12:00 pm" while the trades shown are a saved read. */
    fun stampWords(ui: TradesUi = this.ui.value): String? = tradesStamp(ui, zone)

    // Reads.

    /** The saved trades at once on the first open, then the API's; a failed read keeps them shown, dated;
     * a refused token signs out. The picks hold across a read again. Each call cancels the one before. */
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
        val key = TradeKeys.trades(leagueId)
        if (ui.value.state == TradesState.Loading) {
            cache.read(key)?.let { saved -> decoded(saved.body)?.let { show(it, saved.stamp, stale = true) } }
        }
        try {
            val body = reads.trades(leagueId, null)
            val fresh = decodeEnvelope<TradeAdvice>(body)
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
            mutableUi.update { ui -> ui.copy(state = ui.loaded?.copy(stale = true) ?: TradesState.Failed(failure(e))) }
        }
    }

    // The screen's own choices.

    /** "N more": every idea in place. */
    fun showAllIdeas() {
        mutableUi.update { it.copy(allIdeas = true) }
        redraw()
    }

    /** The roster switch: the member's roster or theirs. */
    fun show(side: PickSide) {
        mutableUi.update { it.copy(drawn = side) }
    }

    // The builder.

    /** One tap loads an idea into the ticks; the member changes it freely from there. */
    fun loadIdea(
        key: String,
        leagueId: String,
    ): Job? {
        val loaded = ui.value.model?.picks(key, clock.now()) ?: return null
        if (loaded.team != picks?.team) forgetAnswer()
        picks = loaded
        return ask(leagueId)
    }

    /** Another team: their side starts again, and the last answer, for the last team, goes. */
    fun chooseTeam(
        team: Int,
        leagueId: String,
    ): Job? {
        val current = picks ?: return null
        forgetAnswer()
        picks = TradePicks(team, current.give, emptyList())
        return ask(leagueId)
    }

    /** A tick on a roster's row: picked, or put back; the check asked again. */
    fun tap(
        side: PickSide,
        player: String,
        leagueId: String,
    ): Job? {
        val current = picks ?: return null
        picks = current.tapped(side, player)
        return ask(leagueId)
    }

    // The verbs.

    /** The verb: the built trade's offer on the clipboard and the line under it, while the answer is the
     * picks', then the platform's page, as the web's verb does. */
    fun pressBuilder() {
        val (team, check) = liveTrade() ?: return
        val done = copy(TradesWords.offer(team.name, check.trade))
        mutableUi.update { it.copy(builderCopied = TradesWords.copied(done, platform)) }
        answer?.hostTradesUrl?.ifEmpty { null }?.let(openPage)
    }

    /** Share: the built trade as text in our words, and the line beside it. */
    fun share() {
        val (team, check) = liveTrade() ?: return
        val done = copy(TradesWords.share(team.name, check.trade))
        mutableUi.update { it.copy(shared = if (done) Words.Analyzer.shared else Words.Trades.copyFailed) }
    }

    /** The team and the answer the verbs act on: only while the answer is the picks' (proposable). */
    private fun liveTrade(): Pair<TradeTeam, TradeCheck>? {
        if (ui.value.builder?.live != true) return null
        val check = checked ?: return null
        val team = answer?.teams?.firstOrNull { it.rosterId == picks?.team } ?: return null
        return team to check
    }

    /** Reads the check for the picks, keeping only the latest answer; the last answer stays, quieter, while
     * the next is read (TradeBuilder's ask). A newer tick cancels the read before it, and an answer that
     * still lands after a newer ask is dropped. */
    private fun ask(leagueId: String): Job? {
        checkProblem = null
        checkAsk += 1
        val mine = checkAsk
        checkJob?.cancel()
        checkJob = null
        val asked = picks
        val input = asked?.checkInput
        if (input == null) {
            forgetAnswer()
            mutableUi.update { it.copy(checking = false, builderCopied = null, shared = null) }
            redraw()
            return null
        }
        mutableUi.update { it.copy(checking = true, builderCopied = null, shared = null) }
        redraw()
        return viewModelScope
            .launch {
                checkAnswer(leagueId, input, asked, mine)
            }.also { checkJob = it }
    }

    private suspend fun checkAnswer(
        leagueId: String,
        input: TradeCheckInput,
        asked: TradePicks?,
        mine: Int,
    ) {
        try {
            val answer = reads.checkTrade(leagueId, input)
            if (mine != checkAsk) return
            checked = answer
            answered = if (answer == null) null else asked
            checkProblem = if (answer == null) Words.InSeason.narrowingUnread else null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
            return
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (mine != checkAsk) return
            forgetAnswer()
            checkProblem = unread(e)
            markStale(e)
        }
        mutableUi.update { it.copy(checking = false) }
        redraw()
    }

    private fun forgetAnswer() {
        checked = null
        answered = null
    }

    // Drawing.

    private fun show(
        advice: TradeAdvice,
        stamp: Instant,
        stale: Boolean,
    ) {
        answer = advice
        val model = TradesModel(advice, host, clock.now(), zone, words)
        if (picks == null) picks = model.opening
        mutableUi.update { it.copy(state = TradesState.Loaded(model, stamp, stale)) }
        redraw()
    }

    private fun redraw() {
        val advice = answer ?: return
        val model = ui.value.model ?: return
        val current = picks ?: return
        val now = clock.now()
        val builder =
            TradeBuilder.model(
                TradeBuilder.Inputs(
                    advice = TradeFinder.held(advice, now),
                    ideas = model.ideas,
                    allIdeas = ui.value.allIdeas,
                    picks = current,
                    answer = checked,
                    answered = answered,
                    problem = checkProblem,
                    me = me,
                    pageKnown = advice.hostTradesUrl.isNotEmpty(),
                    zone = zone,
                    now = now,
                ),
            )
        mutableUi.update { it.copy(builder = builder) }
    }

    /** A read that found no signal dates the trades shown; an API refusal does not. */
    private fun markStale(e: Exception) {
        if (e is ApiFailure) return
        mutableUi.update { ui -> ui.copy(state = ui.loaded?.copy(stale = true) ?: ui.state) }
    }

    private fun signOut() {
        sessionEnd.signedOut()
        mutableUi.update { it.copy(state = TradesState.SignedOut, checking = false) }
    }

    private fun decoded(body: String): TradeAdvice? =
        try {
            decodeEnvelope<TradeAdvice>(body)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    private companion object {
        /** With nothing shown: the API's own sentence where it answered one, else no connection. */
        fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad

        /** Why a check is missing: the API's own sentence where it refused, else the web's line that the
         * last read stands (state.ts Narrowing). */
        fun unread(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: Words.InSeason.narrowingUnread
    }
}
