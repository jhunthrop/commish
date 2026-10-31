package app.trycommish.core.waivers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverRow
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.start.FootRun
import app.trycommish.core.start.MoveKind
import app.trycommish.core.start.MoveStep
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

/** How long a typed bid rests before the claim is planned again for it (WaiverScreen's BID_PAUSE_MS). */
const val BID_PAUSE_MS = 600L

/** An answer and the instant it was read at, which its rows are drawn at. */
private data class Read(
    val advice: WaiverAdvice,
    val at: Instant,
)

/**
 * The Waivers screen's view model, the iOS one's in the Start screen's pattern: the reads, the cache and
 * the clock injected; the saved answer at once (its verb disabled, dated), then the API's; the card or
 * open row the one verb acts on; the claim planned (and planned again for a typed bid once it rests) and
 * made once with its token, or the platform's page with his name copied; a position chosen read from the
 * API with the route's `position` query, the latest choice's answer kept; the table's sort and search.
 * The screen decides nothing. A 401 anywhere signs the device out.
 */
class WaiverViewModel(
    private val reads: WaiverReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val league: LeagueHost,
    /** Puts his name on the clipboard and says whether it took. */
    private val copy: (String) -> Boolean,
    /** Opens the platform's waiver page. */
    private val openPage: (String) -> Unit,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableUi = MutableStateFlow(WaiverUi())
    private val mutableRefreshing = MutableStateFlow(false)
    private var loadJob: Job? = null
    private var bidJob: Job? = null

    /** The page's answer, which the strip and the chips are drawn from. */
    private var answer: Read? = null

    /** The chosen position's own read, which the table is drawn from (WaiverScreen's narrowedAt). */
    private var narrowed: Read? = null

    /** Which position read is the latest: an earlier one's answer is overtaken (state.ts Narrowing). */
    private var latestNarrowing = 0

    /** The answer the last top-up was for (WaiverScreen.svelte toppedFor): an unchanged answer reads the
     * chosen position no second time; null once a top-up failed, so the next answer tries again. */
    private var toppedFor: String? = null

    /** The claim as last planned: the one the token makes, whatever is typed meanwhile. */
    private var planned: HostMoveInput? = null
    private var claiming: WaiverRow? = null

    val ui: StateFlow<WaiverUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The league last asked for, so a screen coming back into view does not read it again. */
    var shown: String? = null
        private set

    val platform: String get() = ValueWords.platform(league)

    private val kind: MoveKind get() = MoveKind.Claim(zone)

    /** "Last read Sat 12:00 pm" while the waivers shown are a saved read. */
    fun stampWords(ui: WaiverUi = this.ui.value): String? = waiverStamp(ui, zone)

    /** The pin for the screen as it is. */
    fun pin(ui: WaiverUi = this.ui.value): WaiverPin = waiverPin(ui, platform, zone)

    // Reads.

    /** The saved answer at once on the first open, then the API's; a failed read keeps the waivers
     * shown, dated; a refused token signs out. Each call cancels the one before. */
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
        val key = WaiverKeys.waivers(leagueId)
        if (ui.value.state == WaiverState.Loading) {
            cache.read(key)?.let { saved -> decoded(saved.body)?.let { show(it, saved.stamp, stale = true) } }
        }
        try {
            val body = reads.waivers(leagueId, null)
            val fresh = decodeEnvelope<WaiverAdvice>(body)
            val stamp = clock.now()
            cache.write(key, Cached(body, stamp))
            show(fresh, stamp, stale = false)
            topUp(leagueId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            mutableUi.update { ui ->
                val loaded = ui.loaded
                ui.copy(state = loaded?.copy(stale = true) ?: WaiverState.Failed(failure(e)))
            }
        }
    }

    // Choices.

    /** A card chosen: the pinned verb acts on it. */
    fun chooseCard(key: String) {
        mutableUi.update { it.copy(chosenCard = key, openRow = null, copied = null) }
    }

    /** A row's button: its drop panel opened or closed; a stash an open IR slot takes with no drop opens
     * the platform's page with his name, held on a saved read as the verb is. */
    fun tapRow(key: String) {
        val ui = ui.value
        val row = ui.model?.rows?.firstOrNull { it.key == key } ?: return
        if (row.opensPage) {
            if (ui.loaded?.stale == false) openPlatform(row.source)
            return
        }
        mutableUi.update { it.copy(openRow = if (it.openRow == key) null else key, chosenDrop = null, copied = null) }
    }

    /** The sheet's verb on his row: the platform's page for a stash with no drop, else his row opened with
     * the advice's drop and the claim pressed, as the web's shelf acts on the pair. */
    fun claimFromSheet(
        key: String,
        leagueId: String,
    ): Job? {
        val row =
            ui.value.model
                ?.rows
                ?.firstOrNull { it.key == key } ?: return null
        if (row.opensPage || ui.value.openRow != key) tapRow(key)
        return if (row.opensPage) null else press(leagueId)
    }

    /** A drop chosen in the open panel. */
    fun chooseDrop(key: String) {
        mutableUi.update { it.copy(chosenDrop = key, copied = null) }
    }

    /** A head chosen: the same head turns it around, a new one starts highest first (a name A to Z). */
    fun sortBy(key: WaiverSortKey) {
        mutableUi.update { it.copy(sort = it.sort.next(key)) }
    }

    /** The search as typed. */
    fun find(query: String) {
        mutableUi.update { it.copy(query = query) }
    }

    /** A position chosen (null: every position, the page's answer): its rows read from the API with the
     * position as the route's query, the last rows standing quieter meanwhile; only the latest choice's
     * answer is kept; a failed read says the API's sentence, the last read standing; a refused token signs
     * out (WaiverScreen.svelte choose, state.ts Narrowing). */
    fun choosePosition(
        next: WaiverPosition?,
        leagueId: String,
    ): Job? {
        narrowed = null
        latestNarrowing += 1
        val mine = latestNarrowing
        mutableUi.update { it.copy(position = next, problem = null, openRow = null, reading = next != null) }
        redraw()
        if (next == null) return null
        return viewModelScope.launch {
            try {
                val advice = decodeEnvelope<WaiverAdvice>(reads.waivers(leagueId, next))
                if (mine != latestNarrowing) return@launch
                narrowed = Read(advice, clock.now())
                mutableUi.update { it.copy(reading = false) }
                redraw()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                signOut()
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                if (mine != latestNarrowing) return@launch
                val said = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: Words.InSeason.narrowingUnread
                mutableUi.update { it.copy(reading = false, problem = said) }
            }
        }
    }

    // The verb.

    /** The verb: the claim planned where it is made from here, else his name copied and the platform's
     * page opened. Nothing while the waivers shown are a saved read or a claim is open. */
    fun press(leagueId: String): Job? = ui.value.target?.let { act(it, leagueId) }

    /** The toggle: the cards' figures and the list's order together (ruling 4). */
    fun choosePanelMode(mode: PanelMode) {
        mutableUi.update { it.copy(panelMode = mode, sort = WaiverNav.sort(mode)) }
    }

    /** A card chosen: All, or a position read of its own. */
    fun chooseNav(
        key: String,
        leagueId: String,
    ): Job? = choosePosition(WaiverPosition.entries.firstOrNull { it.query == key }, leagueId)

    /** The chosen position read again without dimming its rows or closing an open Add (WaiverScreen.svelte
     * topUp): once a page's answer lands, after a claim too. An unchanged answer reads it no second time. A
     * failed top-up keeps the position's own list where it has one, saying nothing; with none yet, the
     * page's rows there stay and the line says so. */
    private suspend fun topUp(leagueId: String) {
        val key = ui.value.position ?: return
        val page = answer?.advice ?: return
        val mark = WaiverNav.mark(page)
        if (mark == toppedFor) return
        toppedFor = mark
        latestNarrowing += 1
        val mine = latestNarrowing
        try {
            val advice = decodeEnvelope<WaiverAdvice>(reads.waivers(leagueId, key))
            if (mine != latestNarrowing || ui.value.position != key) return
            narrowed = Read(advice, clock.now())
            mutableUi.update { it.copy(reading = false, problem = null) }
            redraw()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (mine != latestNarrowing || ui.value.position != key) return
            toppedFor = null
            val said = if (narrowed == null) WaiverNav.firstRead(StartRows.positionWord(key.query)) else null
            mutableUi.update { it.copy(reading = false, problem = said ?: it.problem) }
        }
    }

    /** The one verb on an add (WaiverScreen.svelte act): the claim planned where it is made from here,
     * else his name copied and the platform's page opened. Nothing on a saved read or with a claim open. */
    private fun act(
        target: WaiverRow,
        leagueId: String,
    ): Job? {
        val ui = ui.value
        val loaded = ui.loaded ?: return null
        if (loaded.stale || ui.step != MoveStep.Closed) return null
        if (!loaded.model.claimsHere(target)) {
            openPlatform(target)
            return null
        }
        claiming = target
        mutableUi.update { it.copy(typed = "", bid = null) }
        return viewModelScope.launch { plan(leagueId, target, null) }
    }

    /** A typed bid: the claim is planned again for it once it rests [BID_PAUSE_MS], when the league takes
     * it and it is not the one planned. */
    fun typeBid(
        leagueId: String,
        typed: String,
    ): Job {
        mutableUi.update { it.copy(typed = typed) }
        bidJob?.cancel()
        return viewModelScope
            .launch {
                delay(BID_PAUSE_MS)
                replanBid(leagueId)
            }.also { bidJob = it }
    }

    /** The typed bid planned again, when it is one the league takes and not the one planned. */
    private suspend fun replanBid(leagueId: String) {
        val ui = ui.value
        val bid = ui.bid ?: return
        val source = claiming ?: return
        if (ui.step !is MoveStep.Confirm || WaiverWords.bidProblem(platform, ui.typed, bid) != null) return
        val value = WaiverWords.bidValue(ui.typed.trim()) ?: return
        if (value == planned?.claim?.bid) return
        plan(leagueId, source, value)
    }

    /** Makes the planned claim once with its token, then reads the waivers again. */
    fun confirm(leagueId: String): Job? {
        val ui = ui.value
        val step = ui.step as? MoveStep.Confirm ?: return null
        val move = planned ?: return null
        if (ui.waits(platform)) return null
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
                val page =
                    this@WaiverViewModel
                        .ui.value.model
                        ?.page
                mutableUi.update { it.copy(step = MoveStep.failed(e, MoveStep.Stage.Make, platform, page, kind)) }
            }
        }
    }

    /** Closes the confirmation (Not now, Done); never while the claim is on its way. */
    fun close() {
        if (ui.value.step is MoveStep.Sending) return
        planned = null
        claiming = null
        bidJob?.cancel()
        mutableUi.update { it.copy(step = MoveStep.Closed, bid = null, typed = "", replanning = false) }
    }

    /** Plans the claim with the bid (null: none typed yet; the plan says the league's least where it bids,
     * and is planned again as that number so the token makes the bid the member sees). Only the latest
     * plan is kept. */
    private suspend fun plan(
        leagueId: String,
        source: WaiverRow,
        amount: Int?,
    ) {
        val model = ui.value.model ?: return
        val move = model.claim(source, amount)
        planned = move
        mutableUi.update { if (amount == null) it.copy(step = MoveStep.Planning) else it.copy(replanning = true) }
        try {
            val answer = reads.planMove(leagueId, move)
            if (planned != move) return
            val least = answer.bid
            mutableUi.update { it.copy(step = MoveStep.planned(answer), bid = least, replanning = false) }
            if (amount == null && least != null) {
                mutableUi.update { it.copy(typed = least.amount.toString()) }
                plan(leagueId, source, least.amount)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            mutableUi.update { it.copy(step = MoveStep.Closed) }
            signOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (planned != move) return
            mutableUi.update {
                it.copy(replanning = false, step = MoveStep.failed(e, MoveStep.Stage.Plan, platform, model.page, kind))
            }
        }
    }

    /** The platform verb: his name on the clipboard and the platform's waiver page opened, the line under
     * the verb saying which. */
    private fun openPlatform(source: WaiverRow) {
        val model = ui.value.model ?: return
        val didCopy = copy(source.add.player.name)
        model.page?.let(openPage)
        val words = WaiverWords.copied(platform, model.shortName(source), didCopy)
        val line = listOf(FootRun("${words.said} "), FootRun(words.page, model.page), FootRun("."))
        mutableUi.update { it.copy(copied = listOf(line)) }
    }

    private fun show(
        advice: WaiverAdvice,
        stamp: Instant,
        stale: Boolean,
    ) {
        val first = answer == null
        answer = Read(advice, clock.now())
        if (first) {
            // The first answer sets the card the screen opens on: the weakest Need, else All.
            val opening = WaiverNav.opening(advice)
            mutableUi.update { ui -> ui.copy(position = WaiverPosition.entries.firstOrNull { it.query == opening }) }
        }
        draw(stamp, stale)
    }

    /** The model again from the page's answer and the position's own read, keeping the stamp. */
    private fun redraw() {
        val loaded = ui.value.loaded ?: return
        draw(loaded.stamp, loaded.stale)
    }

    private fun draw(
        stamp: Instant,
        stale: Boolean,
    ) {
        val page = answer ?: return
        val shownRead = narrowed
        val model = WaiverModel(page.advice, shown(page.advice), league, shownRead?.at ?: page.at, zone, page.at)
        mutableUi.update { it.copy(state = WaiverState.Loaded(model, stamp, stale)) }
    }

    /** The answer the table draws (WaiverScreen.svelte shown): the chosen position's own read, less anyone
     * the page's fresher answer has on the member's roster; until it lands the page's rows at the position;
     * the page's own for All. */
    private fun shown(page: WaiverAdvice): WaiverAdvice? {
        narrowed?.let { return WaiverNav.withoutRostered(it.advice, page.roster).copy(roster = page.roster) }
        return ui.value.position?.let { WaiverNav.atPosition(page, it.query) }
    }

    private fun signOut() {
        sessionEnd.signedOut()
        mutableUi.update { it.copy(state = WaiverState.SignedOut, step = MoveStep.Closed) }
    }

    /** With nothing shown: the API's own sentence where it answered one, else no connection. */
    private fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad

    private fun decoded(body: String): WaiverAdvice? =
        try {
            decodeEnvelope<WaiverAdvice>(body)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }
}
