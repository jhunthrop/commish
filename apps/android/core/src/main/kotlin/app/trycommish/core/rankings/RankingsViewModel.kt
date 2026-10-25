package app.trycommish.core.rankings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.OrderAdvice
import app.trycommish.api.models.WeekOrderAdvice
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.shell.SheetPlayer
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

/** How long a search waits after the last letter before it reads (OrderScreen's SEARCH_PAUSE_MS). */
const val SEARCH_PAUSE_MS = 250L

/** What the Rankings draw: our order, or the kickers' or defenses' week. */
sealed interface RankingsContent {
    data class Order(
        val model: RankingsModel,
    ) : RankingsContent

    data class Week(
        val model: WeekRankingsModel,
    ) : RankingsContent

    /** The players the sheet may hold, by id, for its parent refresh. */
    val sheetPlayers: List<SheetPlayer>
        get() =
            when (this) {
                is Order -> model.rows.mapNotNull { it.player.sheetPlayer }
                is Week -> model.rows.mapNotNull { it.player.sheetPlayer }
            }
}

sealed interface RankingsState {
    data object Loading : RankingsState

    /** What is drawn, when its read was made, and whether it is a saved one. */
    data class Loaded(
        val content: RankingsContent,
        val stamp: Instant,
        val stale: Boolean,
    ) : RankingsState

    data class Failed(
        val message: String,
    ) : RankingsState

    data object SignedOut : RankingsState
}

/** The screen's state and the controls' choices, held together so the sheet opened from a row and closed
 * again finds them as they were. */
data class RankingsUi(
    val state: RankingsState = RankingsState.Loading,
    val chip: RankingsChip? = null,
    val query: String = "",
    val limit: Int = PAGE_ROWS,
    /** Why the chip or search asked for last could not be read while an earlier answer stays drawn, said
     * once over the rows; null once a read lands. */
    val problem: String? = null,
) {
    /** Whether a search's letters wait for the order's read (the week filters what it holds). */
    val searchReads: Boolean get() = chip?.weekPosition == null

    /** Whether Show more is offered: the API holds more rows and the limit allows them. */
    val more: Boolean
        get() {
            val content = (state as? RankingsState.Loaded)?.content as? RankingsContent.Order ?: return false
            return content.model.more && limit < MAX_ROWS
        }

    companion object {
        /** The rows one read asks for and Show more adds, and the API's limit (OrderScreen's). */
        const val PAGE_ROWS = 100
        const val MAX_ROWS = 400
    }
}

/**
 * The Rankings screen's view model (the web's Players page in season, OrderScreen.svelte), the iOS one's:
 * the order's routes, the cache and the clock injected; a chip's or a search's saved read at once, dated,
 * then the API's; a failed read keeps what is shown, stale with its stamp, the chip put back to the one
 * its rows were read for and the letters left as typed, the reason said once over the rows. A search on
 * our order is the API's (its matches keep their places in the order), read once the letters rest; on
 * the kickers' and defenses' week it filters the week's rows on the phone, as the web's does. The screen
 * decides nothing. A 401 signs the device out.
 */
class RankingsViewModel(
    private val reads: RankingsReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    /** Names the page "Rankings" and says the week's game beside each player. */
    private val inSeason: Boolean,
    /** The search the shell opened the screen with. */
    query: String,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableUi = MutableStateFlow(RankingsUi(query = query))
    private val mutableRefreshing = MutableStateFlow(false)
    private var loadJob: Job? = null
    private var searchJob: Job? = null
    private var shown: Shown? = null

    val ui: StateFlow<RankingsUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The page's name: "Rankings" in season. */
    val name: String get() = RankingsWords.name(inSeason)

    /** An answer as the API sent it, decoded. */
    private sealed interface Answer {
        data class Order(
            val advice: OrderAdvice,
        ) : Answer

        data class Week(
            val advice: WeekOrderAdvice,
        ) : Answer
    }

    /** What is drawn: the read's route, the chip and the letters it was asked for, its answer and when. */
    private data class Shown(
        val route: String,
        val chip: RankingsChip?,
        val query: String,
        val answer: Answer,
        val stamp: Instant,
        val stale: Boolean,
    )

    /** One read as asked: its route (the cache key), the chip and the letters, and the order's query. */
    private data class Asked(
        val route: String,
        val chip: RankingsChip?,
        val query: String,
        val order: OrderQuery,
    )

    /** The sentence under the name: on our order's chips the week's game beside each player, on the
     * week's none (its basis line says it). */
    fun lead(ui: RankingsUi = this.ui.value): String? =
        when (val state = ui.state) {
            is RankingsState.Loaded ->
                when (val content = state.content) {
                    is RankingsContent.Order -> content.model.lead
                    is RankingsContent.Week -> RankingsWords.lead(inSeason, onWeekChip = true, week = null)
                }
            else -> if (ui.chip?.weekPosition == null) RankingsWords.lead(inSeason, onWeekChip = false, week = null) else null
        }

    /** "Last read Sat 12:00 pm" while what is shown is a saved read. */
    fun stampWords(ui: RankingsUi = this.ui.value): String? {
        val loaded = ui.state as? RankingsState.Loaded ?: return null
        return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
    }

    /** The read the chips and the search name now, captured before any wait so its request and its cache
     * key are the same read whatever is typed or chosen meanwhile (review M1). */
    private fun asked(ui: RankingsUi): Asked {
        val order = OrderQuery.of(ui.chip?.orderPosition, ui.query, ui.limit)
        val route = ui.chip?.weekPosition?.let { "/order/week?position=${it.name}" } ?: order.route
        return Asked(route, ui.chip, ui.query, order)
    }

    /** The chips' and the search's read: its saved answer at once when nothing of it is shown, then the
     * API's. Each call cancels the one before, so only the latest read's answer is drawn. */
    fun load(): Job {
        searchJob?.cancel()
        loadJob?.cancel()
        val asked = asked(ui.value)
        return viewModelScope
            .launch {
                mutableRefreshing.value = true
                try {
                    read(asked)
                } finally {
                    mutableRefreshing.value = false
                }
            }.also { loadJob = it }
    }

    private suspend fun read(asked: Asked) {
        if (shown?.route != asked.route) {
            cache.read(asked.route)?.let { saved ->
                decoded(
                    asked.route,
                    saved.body,
                )?.let { show(Shown(asked.route, asked.chip, lettersFor(it, asked), it, saved.stamp, stale = true)) }
            }
        }
        try {
            val chosen = asked.chip?.weekPosition
            val body = if (chosen != null) reads.weekOrder(chosen) else reads.order(asked.order)
            val answer = if (chosen != null) Answer.Week(decodeEnvelope(body)) else Answer.Order(decodeEnvelope(body))
            val stamp = clock.now()
            cache.write(asked.route, Cached(body, stamp))
            mutableUi.update { it.copy(problem = null) }
            show(Shown(asked.route, asked.chip, lettersFor(answer, asked), answer, stamp, stale = false))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            sessionEnd.signedOut()
            mutableUi.update { it.copy(state = RankingsState.SignedOut) }
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            failed(asked, failure(e))
        }
    }

    /** The letters an answer is drawn with: on our order the ones its read asked for (the API filtered
     * by them); on the week's, which the phone filters, the ones in the field as it lands, so a search
     * typed while the week was read holds (review M1). The read's route and request stay the captured. */
    private fun lettersFor(
        answer: Answer,
        asked: Asked,
    ): String = if (answer is Answer.Week) ui.value.query else asked.query

    /** A failed read keeps what is shown, stale; a chip or search never read says why over the rows and
     * the chip goes back to the one they were read for (review H1); with nothing shown, the sentence. */
    private fun failed(
        asked: Asked,
        sentence: String,
    ) {
        val kept = shown
        if (kept == null) {
            mutableUi.update { it.copy(state = RankingsState.Failed(sentence)) }
            return
        }
        if (kept.route != asked.route) mutableUi.update { it.copy(problem = sentence, chip = kept.chip) }
        show(kept.copy(stale = true))
    }

    /** A chip: All, one of our order's positions, or the week's kickers or defenses. */
    fun choose(chip: RankingsChip?): Job? {
        if (chip == ui.value.chip) return null
        mutableUi.update { it.copy(chip = chip, limit = RankingsUi.PAGE_ROWS) }
        return load()
    }

    /** The search's letters: on the week's rows a filter at once; on our order a read once the letters
     * rest [SEARCH_PAUSE_MS]. */
    fun find(letters: String): Job? {
        mutableUi.update { it.copy(query = letters, limit = RankingsUi.PAGE_ROWS) }
        searchJob?.cancel()
        val kept = shown
        if (kept != null && kept.answer is Answer.Week) show(kept.copy(query = letters))
        if (!ui.value.searchReads) return null
        return viewModelScope
            .launch {
                delay(SEARCH_PAUSE_MS)
                searchJob = null
                load()
            }.also { searchJob = it }
    }

    /** Show more: a hundred rows more, up to the API's limit. */
    fun showMore(): Job {
        mutableUi.update { it.copy(limit = minOf(RankingsUi.MAX_ROWS, it.limit + RankingsUi.PAGE_ROWS)) }
        return load()
    }

    private fun show(next: Shown) {
        shown = next
        val now = clock.now()
        val content =
            when (val answer = next.answer) {
                is Answer.Order -> RankingsContent.Order(rankingsModel(answer.advice, next.chip, next.query, inSeason, zone, now))
                is Answer.Week -> {
                    val position = if (answer.advice.position == WeekOrderAdvice.Position.DEF) WeekPosition.DEF else WeekPosition.K
                    val scoring = ValueWords.format(answer.advice.projectionScoring.format)
                    RankingsContent.Week(weekRankingsModel(answer.advice, position, next.query, scoring, zone, now))
                }
            }
        mutableUi.update { it.copy(state = RankingsState.Loaded(content, next.stamp, next.stale)) }
    }

    /** With nothing shown: the API's own sentence where it answered one, else no connection. */
    private fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad

    private fun decoded(
        route: String,
        body: String,
    ): Answer? =
        try {
            if (route.startsWith(WEEK_ROUTE)) Answer.Week(decodeEnvelope(body)) else Answer.Order(decodeEnvelope(body))
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    private companion object {
        const val WEEK_ROUTE = "/order/week"
    }
}
