package app.trycommish.core.trades

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeCheck
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.ValueWords
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
 * The Trades screen's view model, the iOS one's in the Waivers' pattern: the reads, the cache and the
 * clock injected; the saved finder at once (dated), then the API's; each team's best or every trade, by
 * either gain; the trades holding one player, read from the API as the picker narrows, the latest choice's
 * answer kept; a trade opened into its players; the builder, from a trade or new, posting the check of the
 * trade built as each pick lands and keeping only the latest answer; the verbs copy a trade's offer and
 * open the platform's trade page. A read that fails keeps what is shown, the finder dated by its stamp,
 * unless the API refused it in its own words. A 401 anywhere signs the device out.
 */
class TradesViewModel(
    private val reads: TradeReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val host: LeagueHost,
    private val me: TradeMe,
    /** Puts the offer on the clipboard and says whether it took. */
    private val copy: (String) -> Boolean,
    /** Opens the platform's trade page. */
    private val openPage: (String) -> Unit,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableUi = MutableStateFlow(TradesUi())
    private val mutableRefreshing = MutableStateFlow(false)
    private var loadJob: Job? = null

    /** The finder's answer, which the strip, the chips and the picker are drawn from. */
    private var answer: TradeAdvice? = null

    /** The trades holding the picked player, as the API answered. */
    private var narrowed: TradeAdvice? = null
    private var narrowAsk = 0

    /** The builder's picks while it is open, its latest answer and why it has none. */
    private var picks: TradePicks? = null
    private var checked: TradeCheck? = null
    private var checkProblem: String? = null
    private var checkAsk = 0

    val ui: StateFlow<TradesUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The league last asked for, so a screen coming back into view does not read it again. */
    var shown: String? = null
        private set

    private val platform: String get() = ValueWords.platform(host)

    /** "Last read Sat 12:00 pm" while the finder shown is a saved read. */
    fun stampWords(ui: TradesUi = this.ui.value): String? = tradesStamp(ui, zone)

    // Reads.

    /** The saved finder at once on the first open, then the API's; a failed read keeps the finder shown,
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

    // The finder.

    /** Every trade, or each team's best. */
    fun showEvery(every: Boolean) {
        mutableUi.update { it.copy(every = every) }
        redraw()
    }

    /** The finder by your gain or theirs. */
    fun sortBy(sort: TradeSort) {
        mutableUi.update { it.copy(sort = sort) }
        redraw()
    }

    /** Opens a trade's players under its row, or closes them. */
    fun toggle(key: String) {
        mutableUi.update { it.copy(opened = if (key in it.opened) it.opened - key else it.opened + key) }
    }

    /** The Trades holding picker (TradeScreen's pick): every trade again, or the trades holding one player
     * read from the API; a player our board does not place is in no trade, so nothing is read. The last
     * rows stay while the next are read, and only the latest choice's answer lands. */
    fun pick(
        key: String?,
        leagueId: String,
    ): Job? {
        narrowed = null
        narrowAsk += 1
        val mine = narrowAsk
        val asks = key != null && !key.startsWith(TradeFinder.UNPLACED)
        mutableUi.update { it.copy(holding = key, problem = null, narrowing = asks) }
        redraw()
        if (!asks) return null
        return viewModelScope.launch {
            try {
                val advice = decodeEnvelope<TradeAdvice>(reads.trades(leagueId, key))
                if (mine != narrowAsk) return@launch
                narrowed = advice
                mutableUi.update { it.copy(narrowing = false) }
                redraw()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                signOut()
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                if (mine != narrowAsk) return@launch
                mutableUi.update { it.copy(narrowing = false, problem = unread(e)) }
                markStale(e)
            }
        }
    }

    // The verbs.

    /** The verb on a finder row or a strip card: the trade's offer on the clipboard, the line under it,
     * then the platform's trade page, as the web's verb does. */
    fun press(key: String) {
        val model = ui.value.model ?: return
        val line = model.row(key) ?: cardLine(key) ?: return
        val done = copy(line.offer)
        mutableUi.update { it.copy(copied = it.copied + (key to TradesWords.copied(done, model.platform))) }
        model.page?.let(openPage)
    }

    /** The builder's verb: the built trade's offer, once its check has answered, then the platform's page. */
    fun pressBuilder() {
        val advice = answer ?: return
        val check = checked ?: return
        val team = advice.teams.firstOrNull { it.rosterId == picks?.team } ?: return
        val done = copy(TradesWords.offer(team.name, check.trade))
        mutableUi.update { it.copy(builderCopied = TradesWords.copied(done, platform)) }
        advice.hostTradesUrl.ifEmpty { null }?.let(openPage)
    }

    // The builder.

    /** Build a trade: the builder opened on the first team with a trade found. */
    fun buildNew() {
        val model = ui.value.model ?: return
        open(model.opening)
    }

    /** Build from this: the builder opened with a finder row's trade, its check read. */
    fun buildFrom(
        key: String,
        leagueId: String,
    ): Job? {
        val built =
            ui.value.model
                ?.row(key)
                ?.built ?: return null
        open(built)
        return ask(leagueId)
    }

    /** Not now: the builder closed. */
    fun closeBuilder() {
        picks = null
        checked = null
        checkProblem = null
        checkAsk += 1
        mutableUi.update { it.copy(builderCopied = null, checking = false) }
        redraw()
    }

    /** Another team: their side starts again. */
    fun chooseTeam(
        team: Int,
        leagueId: String,
    ): Job? {
        val current = picks ?: return null
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

    private fun open(next: TradePicks) {
        picks = next
        checked = null
        checkProblem = null
        mutableUi.update { it.copy(builderCopied = null) }
        redraw()
    }

    /** Reads the check for the picks, keeping only the latest answer; the last answer stays, quieter, while
     * the next is read (TradeBuilder's ask). */
    private fun ask(leagueId: String): Job? {
        checkProblem = null
        checkAsk += 1
        val mine = checkAsk
        val input = picks?.checkInput
        if (input == null) {
            checked = null
            mutableUi.update { it.copy(checking = false, builderCopied = null) }
            redraw()
            return null
        }
        mutableUi.update { it.copy(checking = true, builderCopied = null) }
        redraw()
        return viewModelScope.launch {
            try {
                val answer = reads.checkTrade(leagueId, input)
                if (mine != checkAsk) return@launch
                checked = answer
                checkProblem = if (answer == null) Words.InSeason.narrowingUnread else null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                signOut()
                return@launch
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                if (mine != checkAsk) return@launch
                checked = null
                checkProblem = unread(e)
                markStale(e)
            }
            mutableUi.update { it.copy(checking = false) }
            redraw()
        }
    }

    // Drawing.

    private fun show(
        advice: TradeAdvice,
        stamp: Instant,
        stale: Boolean,
    ) {
        answer = advice
        draw(stamp, stale)
    }

    private fun redraw() {
        val loaded = ui.value.loaded ?: return
        draw(loaded.stamp, loaded.stale)
    }

    private fun draw(
        stamp: Instant,
        stale: Boolean,
    ) {
        val advice = answer ?: return
        mutableUi.update { ui ->
            ui.copy(state = TradesState.Loaded(model(advice, ui), stamp, stale), builder = builder(advice))
        }
    }

    private fun model(
        advice: TradeAdvice,
        ui: TradesUi,
    ): TradesModel = TradesModel(advice, narrowed, ui.holding, host, me.name, ui.every, ui.sort, clock.now(), zone)

    private fun builder(advice: TradeAdvice): TradeBuilderModel? {
        val current = picks ?: return null
        val now = clock.now()
        return TradeBuilder.model(
            TradeBuilder.Inputs(
                advice = TradeFinder.held(advice, now),
                picks = current,
                answer = checked,
                problem = checkProblem,
                me = me,
                pageKnown = advice.hostTradesUrl.isNotEmpty(),
                zone = zone,
                now = now,
            ),
        )
    }

    /** A strip card's trade where the finder shown no longer lists it (narrowed to a player). */
    private fun cardLine(key: String): TradeLine? {
        val advice = answer ?: return null
        return TradesModel(advice, null, null, host, me.name, true, ui.value.sort, clock.now(), zone).row(key)
    }

    /** A read that found no signal dates the finder shown; an API refusal does not. */
    private fun markStale(e: Exception) {
        if (e is ApiFailure) return
        mutableUi.update { ui -> ui.copy(state = ui.loaded?.copy(stale = true) ?: ui.state) }
    }

    private fun signOut() {
        sessionEnd.signedOut()
        mutableUi.update { it.copy(state = TradesState.SignedOut, narrowing = false, checking = false) }
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

        /** Why a narrowed read or a check is missing: the API's own sentence where it refused, else the
         * web's line that the last read stands (state.ts Narrowing). */
        fun unread(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: Words.InSeason.narrowingUnread
    }
}
