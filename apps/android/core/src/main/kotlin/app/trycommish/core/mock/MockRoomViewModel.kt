package app.trycommish.core.mock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.LeagueSettings
import app.trycommish.api.models.MockCreate
import app.trycommish.api.models.MockRoom
import app.trycommish.api.models.MockStatus
import app.trycommish.api.models.RoomBoard
import app.trycommish.api.models.RoomCard
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.core.companion.CallView
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import java.time.Instant
import java.time.ZoneId

/** What the room keeps of a mock: the latest answer, the board read with the first and the turn's card, saved
 * with its stamp so the room opens with no signal. */
@Serializable
data class MockSaved(
    val room: MockRoom,
    val board: RoomBoard,
    val card: RoomCard? = null,
)

sealed interface MockRoomState {
    data object Loading : MockRoomState

    /** The room at its latest answer; stale while the last read failed and a saved one shows; busy while a
     * write is on its way and the next turn's call is read. */
    data class Room(
        val model: MockRoomModel,
        val stale: Boolean,
        val busy: Boolean,
    ) : MockRoomState {
        /** Whether a write may go: a room read fresh, and nothing in flight. */
        val canWrite: Boolean get() = !stale && !busy
    }

    /** The draft is over and its report is read. */
    data class Report(
        val report: DraftReportModel,
        val shareCode: String?,
        val settings: LeagueSettings,
        val slot: Int,
    ) : MockRoomState

    data class Failed(
        val sentence: String,
    ) : MockRoomState
}

/**
 * The solo room's view model (web/src/routes/mock/[id]/+page.svelte), the iOS MockRoomViewModel's: the reads,
 * the cache and the clock injected. The room is rebuilt from each answer the API gives, never from a guess: a
 * pick, an undo, Pick for me, Finish and the queue each answer the room as it stands. Every write runs after
 * the one before it (the web's `write` chain), and the room stays busy until a write's answer has landed and
 * the next turn's call is read, so a second tap can never send a pick for a turn already made; a read begun
 * before a write never repaints over its answer. A read that fails shows the saved room, stale, with its verbs
 * held until a read succeeds; a refused write says the API's sentence and leaves the room as it was; a refused
 * token signs out. The finished draft reads its report.
 */
@Suppress("TooManyFunctions") // One verb per control of the room, as the web's page has them.
class MockRoomViewModel(
    val id: String,
    private val reads: MockReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableState = MutableStateFlow<MockRoomState>(MockRoomState.Loading)
    private val mutableRefusal = MutableStateFlow<String?>(null)
    private val mutableCopied = MutableStateFlow(false)
    private val mutableRefreshing = MutableStateFlow(false)

    val state: StateFlow<MockRoomState> = mutableState.asStateFlow()

    /** A write the API refused, in its words, until the next write. */
    val refusal: StateFlow<String?> = mutableRefusal.asStateFlow()

    /** "Link copied" shows in place of the share verb. */
    val copied: StateFlow<Boolean> = mutableCopied.asStateFlow()

    /** A pull's read is on its way: the pull-to-refresh spinner, which comes down when it lands. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** When the room shown was read. */
    var stamp: Instant? = null
        private set

    /** The room as last answered, with its board and the turn's card. */
    private var saved: MockSaved? = null
    private var ui = MockRoomUi()
    private var stale = false

    /** The queue as last set, shown at once until its writes land. */
    private var queued: List<String>? = null
    private var queueWrites = 0
    private val writes = Mutex()

    /** How many writes were chained, so a read begun before one can tell it was overtaken. */
    private var generation = 0
    private var boardView: Pair<RoomBoard, RoomBoardView>? = null

    /** Run it again on its way. */
    private var starting: Job? = null

    /** The room's line while the room shown is a saved one: the room could not be reached, and when it was
     * read. */
    fun staleWords(state: MockRoomState = this.state.value): String? {
        if ((state as? MockRoomState.Room)?.stale != true) return null
        return listOfNotNull(
            Words.Mock.unreachableStale,
            stamp?.let { "${AppWords.lastRead} ${Format.weekdayTime(it, zone)}" },
        ).joinToString(" ")
    }

    /** The link the bar's Save and share and the report's Copy a share link copy. */
    val shareUrl: String?
        get() =
            when (val now = mutableState.value) {
                is MockRoomState.Report -> now.shareCode?.let(::shareLink)
                is MockRoomState.Room -> saved?.room?.shareCode?.let(::shareLink)
                MockRoomState.Loading, is MockRoomState.Failed -> null
            }

    private val canWrite: Boolean get() = (mutableState.value as? MockRoomState.Room)?.let { !it.stale } == true && !ui.busy

    /** The saved room at once on the first open, then the API's. */
    fun load(): Job = viewModelScope.launch { read() }

    /** A pull to read the room again: only while nothing is being written, so a read never races a write (the
     * web has no manual read; this is the way back from a stale room). */
    fun refresh(): Job? {
        if (ui.busy || queueWrites > 0) return null
        mutableRefreshing.value = true
        return viewModelScope.launch {
            try {
                read()
            } finally {
                mutableRefreshing.value = false
            }
        }
    }

    /** The pool's chip. */
    fun choose(filter: String) {
        ui = ui.copy(filter = filter)
        show()
    }

    /** A row tapped: marked, its verbs shown; tapped again, let go. */
    fun mark(player: String) {
        ui = ui.copy(marked = if (ui.marked == player) null else player)
        show()
    }

    /** Draft him: the marked row, else our call, else with no call coming the pool's top row; the pick names
     * the overall pick on the clock, so one made on a stale screen is refused, not misapplied. */
    fun draft(player: String? = null): Job? {
        val room = saved?.room ?: return null
        if (!room.waiting || !canWrite) return null
        val choice = player ?: choice() ?: return null
        ui = ui.copy(marked = null, draftedAt = room.pickNumber)
        return write { reads.pick(id, choice, room.pickNumber) }
    }

    /** Undo: your latest pick taken back with every pick after it; the line says where the room went back to
     * and who is in the pool again. */
    fun undo(): Job? {
        val held = saved ?: return null
        val pick =
            held.room.picks
                .lastOrNull { it.seat == held.room.slot }
                ?.pick ?: return null
        if (!canWrite) return null
        val name =
            held.room.picks
                .firstOrNull { it.pick == pick }
                ?.let { board(held).byId[it.playerId]?.name }
        ui = ui.copy(draftedAt = null)
        return write(MockWords.undone(pick, held.room.teams, name)) { reads.undo(id, pick) }
    }

    /** Pick for me through the bar's round. */
    fun autopick(): Job? {
        val room = mutableState.value as? MockRoomState.Room ?: return null
        val round = room.model.bar?.autopickTo ?: return null
        if (!canWrite) return null
        ui = ui.copy(draftedAt = null)
        return write { reads.autopick(id, round) }
    }

    /** Finish the draft: every remaining turn made for you, then the report. */
    fun finish(): Job? {
        if (!canWrite) return null
        ui = ui.copy(draftedAt = null)
        return write { reads.finish(id) }
    }

    /** Queue or let go of a player: shown at once, sent as the whole queue in the write chain, so each lands in
     * order; a queue write never holds the room busy, so Draft him right after still acts, after it. */
    fun toggleQueue(player: String): Job? {
        val held = saved ?: return null
        if ((mutableState.value as? MockRoomState.Room)?.stale != false) return null
        val drafted =
            held.room.picks
                .map { it.playerId }
                .toSet()
        val current = (queued ?: held.room.queue).filter { it !in drafted }
        val sending = if (player in current) current - player else current + player
        queued = sending
        queueWrites++
        show()
        return viewModelScope.launch {
            chained {
                try {
                    settle(reads.queue(id, sending), held.board)
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    fail(e, reading = false)
                } finally {
                    queueWrites--
                    if (queueWrites == 0) {
                        queued = null
                        repaint()
                    }
                }
            }
        }
    }

    /** The link was copied: "Link copied" for a moment (actions.ts COPIED_MS). */
    fun linkCopied(): Job =
        viewModelScope.launch {
            mutableCopied.value = true
            try {
                delay(COPIED_MS)
            } finally {
                mutableCopied.value = false
            }
        }

    /** Run it again from the same slot, a new seed: the new room's id to `opened`. Once at a time: a second tap
     * while the first is on its way starts nothing. A refusal keeps the report on screen with its sentence. */
    fun runAgain(opened: (String) -> Unit): Job? {
        val report = mutableState.value as? MockRoomState.Report ?: return null
        if (starting?.isActive == true) return null
        mutableRefusal.value = null
        return viewModelScope
            .launch {
                try {
                    reads.create(MockCreate(settings = report.settings.copy(slot = report.slot))).id?.let { opened(it.toString()) }
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    fail(e, reading = false)
                }
            }.also { starting = it }
    }

    private suspend fun read() {
        if (mutableState.value == MockRoomState.Loading) showSaved()
        val began = generation
        try {
            val fresh = reads.mock(id)
            val board = fresh.board ?: saved?.board ?: throw ApiFailure(0, "empty", "")
            if (began != generation) return
            stale = false
            settle(fresh, board, began)
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (began == generation) fail(e, reading = true)
        }
    }

    /** The marked row, else our call, else with no call coming the pool's top row. */
    private fun choice(): String? {
        ui.marked?.let { return it }
        return when (val call = (mutableState.value as? MockRoomState.Room)?.model?.call) {
            is MockCallState.Call -> call.playerId
            is MockCallState.NoCall -> call.playerId
            is MockCallState.Reading, null -> null
        }
    }

    /** Runs `job` after every job chained before it. */
    private suspend fun chained(job: suspend () -> Unit) {
        generation++
        writes.withLock { job() }
    }

    /** One write: the room busy until its answer lands and the turn's call is read (the web's `act`). */
    private fun write(
        notice: String? = null,
        run: suspend () -> MockRoom,
    ): Job? {
        val held = saved ?: return null
        if (ui.busy) return null
        ui = ui.copy(busy = true)
        mutableRefusal.value = null
        show()
        return viewModelScope.launch {
            chained {
                try {
                    val answer = run()
                    ui = ui.copy(notice = notice)
                    settle(answer, held.board)
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    ui = ui.copy(draftedAt = null)
                    fail(e, reading = false)
                } finally {
                    ui = ui.copy(busy = false)
                    repaint()
                }
            }
        }
    }

    /** An answer onto the room: the board kept, the card kept for the same turn, else the answer's or the
     * route's; the finished draft's report. A read's answer (`began` set) overtaken by a write while its call
     * was read is dropped. */
    private suspend fun settle(
        fresh: MockRoom,
        board: RoomBoard,
        began: Int? = null,
    ) {
        val samePick = saved?.room?.pickNumber == fresh.pickNumber
        val answered = fresh.card?.takeIf { it.pickNumber == fresh.pickNumber }
        var card = answered ?: if (samePick) saved?.card else null
        val room = fresh.copy(board = null, card = null)
        ui = ui.copy(callMissing = false)
        if (!samePick) ui = ui.copy(marked = null, draftedAt = null)
        if (fresh.status == MockStatus.complete) {
            keep(MockSaved(room, board))
            readReport(room)
            return
        }
        if (card == null && fresh.waiting) card = readCard(fresh.pickNumber)
        if (began != null && began != generation) return
        keep(MockSaved(room, board, card))
        show()
    }

    /** The turn's call from the card route; the room never waits on one that is not coming. */
    private suspend fun readCard(pick: Int): RoomCard? {
        val card =
            try {
                reads.card(id)
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                null
            }
        if (card?.pickNumber == pick) return card
        ui = ui.copy(callMissing = true)
        return null
    }

    /** The finished draft's report; one that cannot be read says why, with Try again (which reads the room
     * and its report again), never a finished room with no verbs. */
    private suspend fun readReport(room: MockRoom) {
        try {
            report(room)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            mutableState.value = MockRoomState.Failed(sentence(e))
        }
    }

    private suspend fun report(room: MockRoom) {
        val report = reads.report(id)
        mutableState.value =
            MockRoomState.Report(
                DraftReportModel.of(
                    report,
                    MockWords.seatNames(report.teams, report.slot),
                    Words.Mock.botsByAdp,
                    Words.Mock.reshuffled,
                ),
                report.shareCode ?: room.shareCode,
                report.settings,
                report.slot,
            )
    }

    private fun keep(next: MockSaved) {
        saved = next
        val now = clock.now()
        stamp = now
        cache.write(route(id), Cached(CommishJson.encodeToString(MockSaved.serializer(), next), now))
    }

    private fun showSaved() {
        val kept = cache.read(route(id)) ?: return
        val decoded =
            try {
                CommishJson.decodeFromString(MockSaved.serializer(), kept.body)
            } catch (e: SerializationException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            } ?: return
        saved = decoded
        stamp = kept.stamp
        stale = true
        show()
    }

    /** The room drawn again, while the room is what shows (never over the report or a sign-out). */
    private fun repaint() {
        if (mutableState.value is MockRoomState.Room) show()
    }

    private fun show() {
        val held = saved ?: return
        val room = queued?.let { held.room.copy(queue = it) } ?: held.room
        val board = board(held)
        val drafted = room.picks.map { it.playerId }.toSet()
        if (room.waiting) held.card?.let { CallView.of(it, board, drafted, room.teams) }?.let { ui = ui.copy(lastCall = it) }
        mutableState.value = MockRoomState.Room(MockRoomModel.of(room, board, held.card, ui), stale, ui.busy)
    }

    /** The board as the room reads it, built once per board read. */
    private fun board(held: MockSaved): RoomBoardView {
        boardView?.takeIf { it.first === held.board }?.let { return it.second }
        return RoomBoardView.of(held.board, held.room.teams).also { boardView = held.board to it }
    }

    private fun fail(
        error: Exception,
        reading: Boolean,
    ) {
        if (error is Unauthorized) {
            mutableState.value = MockRoomState.Failed(AppWords.signedOut)
            sessionEnd.signedOut()
            return
        }
        if (!reading) {
            mutableRefusal.value = sentence(error)
            // The report stays on screen with the refusal under its verbs.
            if (mutableState.value !is MockRoomState.Report) show()
            return
        }
        if ((error as? ApiFailure)?.status in FINAL_STATUSES) {
            // Not this account's room, or no such room: a refusal is final, not a lost connection.
            mutableState.value = MockRoomState.Failed(sentence(error))
            return
        }
        if (saved != null) {
            stale = true
            show()
        } else {
            mutableState.value = MockRoomState.Failed(sentence(error))
        }
    }

    companion object {
        /** A read refused for good: the room is not the account's (403) or is not there (404). */
        private val FINAL_STATUSES = setOf(403, 404)

        /** actions.ts COPIED_MS: how long "Link copied" stays. */
        const val COPIED_MS = 3_000L

        /** The cache key of a mock. */
        fun route(id: String): String = "/mocks/$id"

        /** The share link of a draft by its code (actions.ts copyShareLink). */
        fun shareLink(code: String): String = "${SiteLinks.ORIGIN}/mock/share/$code"

        /** The API's own sentence where it sent one, else the app's for no connection or anything else. */
        fun sentence(error: Exception): String = (error as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: Words.Mock.unreachablePhone
    }
}
