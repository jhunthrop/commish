package app.trycommish.core.lobby

import androidx.lifecycle.ViewModel
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.LobbyRoom
import app.trycommish.api.models.RoomCard
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.RoomDraft
import app.trycommish.core.room.RoomCommand
import app.trycommish.core.room.RoomConnector
import app.trycommish.core.room.RoomRow
import app.trycommish.core.room.RoomSocket
import app.trycommish.core.room.RoomStatus
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant

/** A room read that will never work, in the lobby's words (notice.ts, subject lobby): signed out, no seat in the
 * room, or no such room; and any other failure in the API's sentence. */
object LobbyRefusal {
    private const val UNAUTHORIZED = 401
    private const val FORBIDDEN = 403
    private const val NOT_FOUND = 404

    /** 401, 403 and 404 are final (api.ts isFinalRefusal): no read or socket is tried again. */
    fun isFinal(error: Throwable): Boolean = status(error) != null

    fun status(error: Throwable): Int? =
        when {
            error is Unauthorized -> UNAUTHORIZED
            error !is ApiFailure -> null
            error.status == FORBIDDEN || error.code == "forbidden" -> FORBIDDEN
            error.status == NOT_FOUND || error.code == "not_found" -> NOT_FOUND
            error.status == UNAUTHORIZED || error.code == "unauthorized" -> UNAUTHORIZED
            else -> null
        }

    /** notice.ts noticeFor with subject lobby. */
    fun sentence(error: Throwable): String =
        sentence(status(error)) ?: (error as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: Words.Mock.unreachable

    fun sentence(status: Int?): String? =
        when (status) {
            UNAUTHORIZED -> Words.Lobby.signedOut
            FORBIDDEN -> Words.Lobby.noSeat
            NOT_FOUND -> Words.Lobby.gone
            else -> null
        }

    fun signsOut(error: Throwable): Boolean = status(error) == UNAUTHORIZED
}

sealed interface LobbyScreenState {
    data object Loading : LobbyScreenState

    data object Room : LobbyScreenState

    /** The room could not be read; `final` when no retry can fix it. */
    data class Failed(
        val sentence: String,
        val final: Boolean,
    ) : LobbyScreenState
}

/**
 * The lobby room's view model (web/src/routes/lobby/[id]/+page.svelte), the iOS LobbyViewModel's: the reads, the
 * socket's connector and token, the clock and the wait injected. The room is read once over HTTP (its seats,
 * board and socket), then its state is the log's replay over the room's socket, never a local guess: the welcome
 * and every update. A pick and the queue go over the socket as commands and land as rows; Leave goes through
 * HTTP. The clock is the room's: the welcome's offset on the phone's clock. A room read refused for good (401,
 * 403, 404) stops here (B208): nothing polls a refused draft. Rows that skip a seq read the room again and replay
 * the whole log from the welcome (B219).
 *
 * [run] is the room for the screen's life, from the screen's own scope, and the socket closes with 1000 when that
 * scope goes. The first run reads the room and replays its log from the welcome; a run again with the room held (a
 * configuration change) reads nothing and says hello from the last seq applied; after a read that did not go, a run
 * again (Try again) reads it afresh.
 */
@Suppress("TooManyFunctions") // One verb per control of the room, as the web's page has them.
class LobbyViewModel(
    val id: String,
    private val reads: LobbyReads,
    private val connector: RoomConnector,
    private val token: () -> String?,
    private val clock: Clock,
    private val sessionEnd: SessionEnd,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) : ViewModel() {
    private val mutableState = MutableStateFlow<LobbyScreenState>(LobbyScreenState.Loading)
    private val mutableLobby = MutableStateFlow<LobbyState?>(null)
    private val mutableDrawn = MutableStateFlow<LobbyRoomModel?>(null)
    private val mutableSocket = MutableStateFlow<RoomSocket?>(null)
    private val mutableStopped = MutableStateFlow<String?>(null)
    private val mutableProblem = MutableStateFlow<String?>(null)
    private val mutableLeaving = MutableStateFlow(false)

    val state: StateFlow<LobbyScreenState> = mutableState.asStateFlow()

    /** The log's replay. */
    val lobby: StateFlow<LobbyState?> = mutableLobby.asStateFlow()

    /** The room as the screen draws it, built when its state changes (a row, the card, the chip, the mark),
     * never on the clock's tick: the score bug and the filling line redraw their countdowns from it
     * ([LobbyRoomModel.at]) on the room's clock. */
    val drawn: StateFlow<LobbyRoomModel?> = mutableDrawn.asStateFlow()

    /** The room's socket once the room is read: its status and its last refusal feed [notice]. */
    val socket: StateFlow<RoomSocket?> = mutableSocket.asStateFlow()

    /** The socket stopped for good: the room's sentence. */
    val stopped: StateFlow<String?> = mutableStopped.asStateFlow()

    /** A leave or a join the API refused, in its words, over the room. */
    val problem: StateFlow<String?> = mutableProblem.asStateFlow()

    val leaving: StateFlow<Boolean> = mutableLeaving.asStateFlow()

    var room: LobbyRoom? = null
        private set
    private var board: RoomBoardView? = null
    private var card: RoomCard? = null
    private var filter = RoomDraft.ALL
    private var marked: String? = null
    private var cardFor = -1

    /** A resync's fresh state, which the welcome's whole log replays onto. */
    private var rebuilding: LobbyState? = null

    /** The run's scope, where the turn's card is read, so it goes with the screen. */
    private var running: CoroutineScope? = null

    /** The room for the screen's whole life: read it, then hold its socket until the calling coroutine is
     * cancelled (the socket closes with 1000) or the room stops it for good. */
    suspend fun run() {
        // Stopped for good (a 1008 close, a refused upgrade) or refused for good (B208): nothing is tried again.
        if (mutableStopped.value != null || (mutableState.value as? LobbyScreenState.Failed)?.final == true) return
        val socket = resumed() ?: load() ?: return
        coroutineScope {
            running = this
            try {
                socket.run()
            } finally {
                running = null
            }
            mutableStopped.value = socket.stopped ?: socket.refusedStatus?.let(LobbyRefusal::sentence)
        }
    }

    /** The room already held (a run again after a configuration change, Lane 230 review M1): no read and no
     * reset, a socket that says hello from the last seq applied, the protocol's own reconnect. Null when this view
     * model holds no room yet, or the room it holds is over or was left: that room is read again. */
    private fun resumed(): RoomSocket? {
        val room = room ?: return null
        val lobby = mutableLobby.value ?: return null
        if (mutableState.value != LobbyScreenState.Room) return null
        // A room drafted to its end, closed unattended, or a seat given up is read again, never resumed
        // (Lane 230 re-review M1).
        if (lobby.complete || lobby.abandoned || lobby.seats[room.you]?.kind == LobbySeatKind.Left) return null
        return socket(room.socketUrl, lobby.seq)
    }

    private fun socket(
        url: String,
        lastSeq: Long,
    ): RoomSocket =
        RoomSocket(
            url,
            connector,
            token,
            clock,
            wait,
            lastSeq = lastSeq,
            onRows = ::apply,
            onSignedOut = sessionEnd::signedOut,
            onGap = ::resync,
        ).also { mutableSocket.value = it }

    /** The room's read and its socket; null when the read failed. */
    private suspend fun load(): RoomSocket? {
        mutableStopped.value = null
        mutableState.value = LobbyScreenState.Loading
        cardFor = -1
        rebuilding = null
        return try {
            val read = reads.lobby(id)
            board = RoomBoardView.of(read.board, read.teams)
            room = read
            card = null
            mutableLobby.value = LobbyState.of(read)
            mutableState.value = LobbyScreenState.Room
            redraw()
            socket(read.socketUrl, 0)
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            fail(e)
            null
        }
    }

    private fun fail(error: Exception) {
        if (LobbyRefusal.signsOut(error)) sessionEnd.signedOut()
        mutableState.value = LobbyScreenState.Failed(LobbyRefusal.sentence(error), LobbyRefusal.isFinal(error))
    }

    /** B219: the room read again, its state started over for the welcome's whole log to replay onto. */
    private suspend fun resync(): Boolean =
        try {
            val read = reads.lobby(id)
            room = read
            rebuilding = LobbyState.of(read)
            cardFor = -1
            true
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (LobbyRefusal.isFinal(e)) {
                fail(e)
                false
            } else {
                true
            }
        }

    private fun apply(rows: List<RoomRow>) {
        val room = room ?: return
        val base = rebuilding ?: mutableLobby.value ?: return
        rebuilding = null
        val next = base.applying(rows, room.you)
        mutableLobby.value = next
        if (card != null && card?.pickNumber != next.pickNumber) card = null
        redraw()
        running?.launch { loadCard(next) }
    }

    /** The turn's card, once per pick, kept only while the room is still at that pick. */
    private suspend fun loadCard(state: LobbyState) {
        if (!state.drafting || state.complete || cardFor == state.pickNumber) return
        cardFor = state.pickNumber
        val next =
            try {
                reads.card(id)
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                // The room drafts without a card; the next pick brings one.
                null
            }
        if (mutableLobby.value?.pickNumber == state.pickNumber) {
            card = next
            redraw()
        }
    }

    private fun redraw() {
        val room = room ?: return
        val board = board ?: return
        val lobby = mutableLobby.value ?: return
        mutableDrawn.value = LobbyRoomModel.of(room, board, lobby, card, roomNow(), filter, marked)
    }

    // What the screen reads.

    /** The room's notice line: reconnecting, a refused leave, or the last command the room refused in its words. */
    fun notice(): String? {
        val socket = mutableSocket.value
        return notice(socket?.status?.value, socket?.refusal?.value, mutableProblem.value)
    }

    /** The room's clock: the phone's plus the latest welcome's offset. */
    fun roomNow(): Instant = mutableSocket.value?.let { clock.now().plus(it.offset) } ?: clock.now()

    /** Whether the room still takes people: drafting or filling, read, not stopped. */
    val open: Boolean
        get() {
            val lobby = mutableLobby.value ?: return false
            if (mutableState.value != LobbyScreenState.Room || mutableStopped.value != null) return false
            return !lobby.complete && !lobby.abandoned
        }

    /** Leave's question: what happens to the seat. */
    val leaveQuestion: String get() = if (mutableLobby.value?.drafting == true) Words.Lobby.leaveDrafting else Words.Lobby.leaveFilling

    // The verbs.

    /** Draft a player: the pick on the clock, as a command; it lands when its row comes back. */
    suspend fun draft(player: String?) {
        val socket = mutableSocket.value
        val lobby = mutableLobby.value ?: return
        val room = room ?: return
        // Off the clock nothing is sent, so the refusal stays (B252; the page clears `refused` only in onpick).
        if (player == null || !open || !lobby.drafting || RoomDraft.seatAt(lobby.pickNumber, room.teams) != room.you) return
        marked = null
        redraw()
        // A pick that goes out puts the room's last refusal away (the socket's send clears it, the page's
        // `refused = null`); one that cannot go (reconnecting) leaves it for the welcome.
        socket?.send(RoomCommand.Pick(player, lobby.pickNumber))
    }

    /** Queue or unqueue a player: the whole queue as a command. */
    suspend fun toggleQueue(player: String) {
        val lobby = mutableLobby.value ?: return
        if (!open) return
        val queue = lobby.queue.filter { it !in lobby.drafted }
        mutableSocket.value?.send(RoomCommand.Queue(if (player in queue) queue - player else queue + player))
    }

    /** "Queue him first": to the front of the queue. */
    suspend fun queueFirst(player: String) {
        val lobby = mutableLobby.value ?: return
        if (!open) return
        mutableSocket.value?.send(RoomCommand.Queue(listOf(player) + lobby.queue.filter { it !in lobby.drafted && it != player }))
    }

    fun mark(player: String) {
        marked = if (marked == player) null else player
        redraw()
    }

    fun choose(filter: String) {
        this.filter = filter
        redraw()
    }

    /** Leave the lobby through the API; true when the seat is given up and the room can close. A refusal shows
     * in the room's notice. */
    suspend fun leave(): Boolean {
        mutableLeaving.value = true
        mutableProblem.value = null
        return try {
            reads.leave(id)
            mutableSocket.value?.close()
            // The seat is given up: nothing held is resumed, so a rejoin of the same room reads it afresh.
            room = null
            mutableLobby.value = null
            mutableDrawn.value = null
            true
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (LobbyRefusal.signsOut(e)) sessionEnd.signedOut()
            mutableProblem.value = LobbyRefusal.sentence(e)
            false
        } finally {
            mutableLeaving.value = false
        }
    }

    /** A closed lobby's verb: a seat in the next one filling in the same format, its room's id. */
    suspend fun joinAnother(): String? {
        val room = room ?: return null
        return try {
            val seat = reads.join(room.format)
            mutableSocket.value?.close()
            seat.roomId.toString()
        } catch (e: CancellationException) {
            throw e
        } catch (e: LobbyHandleNeeded) {
            mutableProblem.value = e.message
            null
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (LobbyRefusal.signsOut(e)) sessionEnd.signedOut()
            mutableProblem.value = LobbyRefusal.sentence(e)
            null
        }
    }

    companion object {
        /** The notice from what it reads: the socket's status and last refusal, and a refused leave or join. The
         * refusal is the socket's own: a pick that goes out puts it away, every new error frame shows it again, and
         * a welcome clears it, so no dismissal can outlive the action it answered (B252). */
        fun notice(
            status: RoomStatus?,
            refusal: String?,
            problem: String?,
        ): String? =
            when {
                status == RoomStatus.Reconnecting -> Words.Lobby.reconnecting
                else -> problem ?: refusal
            }
    }

    /** Close the room without leaving: the socket ends with 1000 and the seat's stand-in drafts until the member
     * comes back. */
    suspend fun close() {
        mutableSocket.value?.close()
    }
}
