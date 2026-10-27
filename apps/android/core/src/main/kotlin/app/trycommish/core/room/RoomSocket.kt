package app.trycommish.core.room

import app.trycommish.core.Clock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.time.Duration
import java.util.logging.Logger

/** Where a socket is (lobby-socket.ts status): the first attempt, a welcome read, after a drop, stopped. */
enum class RoomStatus { Connecting, Open, Reconnecting, Closed }

/** How one socket ended, and whether it reached its welcome. */
private data class SocketEnd(
    val closed: RoomClosed,
    val welcomed: Boolean,
)

/**
 * The room's WebSocket (docs/superpowers/specs/2026-10-24-room-protocol.md, web/src/lib/room/lobby-socket.ts),
 * the iOS RoomSocket's, for the lobby (D6): a hello with the last seq applied, the welcome with every row since
 * and the server's clock, each update after it in seq order, commands sent only while open (never queued), and
 * a reconnect on the retry ladder that picks up exactly where it left off. A 1008 close stops for good with the
 * room's sentence (a "signed out" one signs the app out); a refusal before the upgrade (401, 403, 404) stops
 * for good, a 401 signing out; anything else retries. Frames of a type this client does not know are skipped;
 * text that is no frame closes with 1002 and retries. The connector, the token, the clock and the wait are
 * injected, so a recorded exchange drives it in a test.
 *
 * B219: with an owner that resyncs ([onGap]), rows whose first seq skips past the next (`rows.first.seq >
 * lastSeq + 1`) are a gap and apply nothing: the socket closes with 1000 "resync", the owner reads the room
 * again over HTTP, and the next socket says hello from 0 at once (no wait on the ladder), so its welcome's
 * whole log rebuilds the state; an owner whose read is refused for good ends it. Without an owner the rows
 * apply as the web's client applies them.
 *
 * [run] is the one way in, from the owner's structured scope (a LaunchedEffect, a view model's job): when that
 * coroutine is cancelled the open socket is closed with 1000 at once and no retry follows, so the socket never
 * outlives the screen that opened it. [close] leaves the room the same way.
 */
class RoomSocket(
    private val url: String,
    private val connector: RoomConnector,
    private val token: () -> String?,
    private val clock: Clock,
    private val wait: suspend (Long) -> Unit = { delay(it) },
    lastSeq: Long = 0,
    private val onRows: (List<RoomRow>) -> Unit,
    private val onSignedOut: () -> Unit = {},
    private val onGap: (suspend () -> Boolean)? = null,
) {
    private val mutableStatus = MutableStateFlow(RoomStatus.Connecting)
    private val mutableRefusal = MutableStateFlow<String?>(null)

    val status: StateFlow<RoomStatus> = mutableStatus.asStateFlow()

    /** The last command the room refused, in its words; cleared by the next command and by each welcome. */
    val refusal: StateFlow<String?> = mutableRefusal.asStateFlow()

    /** The server's clock less the phone's, from the latest welcome: a deadline is drawn at clock.now() plus it. */
    @Volatile var offset: Duration = Duration.ZERO
        private set

    /** Why the retries stopped for good: the room's sentence before a 1008 close. */
    @Volatile var stopped: String? = null
        private set

    /** The upgrade's status when the room refused the socket for good before it opened (401, 403, 404). */
    @Volatile var refusedStatus: Int? = null
        private set

    /** The highest seq applied. */
    @Volatile var lastSeq: Long = lastSeq
        private set

    @Volatile private var connection: RoomConnection? = null

    @Volatile private var leaving = false

    /** A frame skipped past the last seq applied: the socket was closed to resync from the welcome. */
    private var gapped = false
    private var attempt = 0
    private var tries = 0

    /** Runs the socket to its end: connect, read until it drops, wait a step, again; until [close], a final
     * refusal, or the calling coroutine's cancellation, which closes the open socket with 1000. */
    suspend fun run() {
        try {
            loop()
        } finally {
            withContext(NonCancellable) { connection?.close(NORMAL, LEFT_REASON) }
            connection = null
            mutableStatus.value = RoomStatus.Closed
        }
    }

    private suspend fun loop() {
        while (!ended()) {
            mutableStatus.value = if (tries == 0) RoomStatus.Connecting else RoomStatus.Reconnecting
            tries++
            val end = session()
            connection = null
            if (ended() || stop(end)) return
            mutableStatus.value = RoomStatus.Reconnecting
            if (gapped) {
                gapped = false
                if (!resync()) return
                continue
            }
            wait(RETRY_LADDER_MS[minOf(attempt, RETRY_LADDER_MS.lastIndex)])
            attempt++
        }
    }

    private suspend fun ended(): Boolean = leaving || !currentCoroutineContext().isActive

    /** Sends a command while the socket is open; false, and nothing queued, when it is not. */
    suspend fun send(command: RoomCommand): Boolean {
        val open = connection?.takeIf { mutableStatus.value == RoomStatus.Open } ?: return false
        mutableRefusal.value = null
        return try {
            open.send(command.text)
            true
        } catch (e: RoomClosed) {
            false
        }
    }

    /** Leaves the room: closes with 1000 and stops retrying. */
    suspend fun close() {
        leaving = true
        val open = connection
        connection = null
        open?.close(NORMAL, LEFT_REASON)
        mutableStatus.value = RoomStatus.Closed
    }

    /** One socket from open to its end. A socket that opens after the owner left is closed at once, before
     * its hello. */
    private suspend fun session(): SocketEnd {
        var welcomed = false
        try {
            val opened = connector.open(url, token())
            if (ended()) {
                withContext(NonCancellable) { opened.close(NORMAL, LEFT_REASON) }
                return SocketEnd(RoomClosed(NORMAL, LEFT_REASON), welcomed = false)
            }
            connection = opened
            opened.send(RoomCommand.hello(lastSeq))
            while (true) {
                val text = opened.receive()
                val frame =
                    try {
                        RoomFrame.decode(text) ?: continue
                    } catch (e: RoomFrameError) {
                        log("unreadable frame, closing: ${e.message}")
                        opened.close(PROTOCOL_ERROR, UNREADABLE_REASON)
                        return SocketEnd(RoomClosed(PROTOCOL_ERROR, UNREADABLE_REASON), welcomed)
                    }
                if (frame is RoomFrame.Welcome) welcomed = true
                if (!receive(frame)) {
                    gapped = true
                    opened.close(NORMAL, RESYNC_REASON)
                    return SocketEnd(RoomClosed(NORMAL, RESYNC_REASON), welcomed)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: RoomClosed) {
            return SocketEnd(e, welcomed)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            return SocketEnd(RoomClosed(ABNORMAL, e.message.orEmpty()), welcomed)
        }
    }

    /** Whether this end is final: a 1008 close, or a final refusal before the welcome. */
    private fun stop(end: SocketEnd): Boolean {
        val closed = end.closed
        if (closed.code == POLICY_VIOLATION) {
            stopped = mutableRefusal.value ?: closed.reason
            if (closed.reason == SIGNED_OUT_REASON) onSignedOut()
            return true
        }
        val status = closed.status
        if (end.welcomed || status == null || status !in FINAL_STATUSES) return false
        refusedStatus = status
        if (status == HTTP_UNAUTHORIZED) onSignedOut()
        return true
    }

    /** Applies a frame; false when its rows skip past the last seq applied (a gap), which applies none. */
    private fun receive(frame: RoomFrame): Boolean =
        when (frame) {
            is RoomFrame.Error -> {
                mutableRefusal.value = frame.message
                true
            }
            is RoomFrame.Welcome -> {
                attempt = 0
                mutableStatus.value = RoomStatus.Open
                mutableRefusal.value = null
                offset = Duration.between(clock.now(), frame.now)
                apply(frame.rows)
            }
            is RoomFrame.Update -> apply(frame.rows)
        }

    /** The rows past the last applied, in seq order; one already applied is never applied twice. With an owner
     * that resyncs, rows that skip past the next seq are a gap and apply nothing (B219). */
    private fun apply(rows: List<RoomRow>): Boolean {
        val fresh = rows.filter { it.seq > lastSeq }.sortedBy { it.seq }
        val first = fresh.firstOrNull() ?: return true
        if (onGap != null && first.seq > lastSeq + 1) {
            log("seq gap after $lastSeq, resyncing")
            return false
        }
        lastSeq = fresh.last().seq
        onRows(fresh)
        return true
    }

    /** The owner reads the room again (false when the read is refused for good) and the next socket says hello
     * from nothing, so its welcome carries the whole log. */
    private suspend fun resync(): Boolean {
        val gap = onGap
        if (gap == null || !gap()) {
            stopped = stopped ?: mutableRefusal.value
            return false
        }
        lastSeq = 0
        return !ended()
    }

    companion object {
        /** RETRY_MS: the waits before each retry, staying at the last. */
        val RETRY_LADDER_MS = listOf(250L, 500L, 1_000L, 2_000L, 5_000L)

        /** The close the room ends a socket with when it refuses it on purpose. */
        const val POLICY_VIOLATION = 1008

        /** The client's own close on leaving the room. */
        const val NORMAL = 1000

        /** A socket gone without a close frame (reserved: seen, never sent). */
        const val ABNORMAL = 1006

        /** The client's close for a frame it cannot read at all. */
        const val PROTOCOL_ERROR = 1002

        /** The 1008 reason for a revoked device token. */
        const val SIGNED_OUT_REASON = "signed out"
        const val LEFT_REASON = "left the page"
        const val UNREADABLE_REASON = "unreadable frame"

        /** The client's close when rows went missing and it resyncs from the welcome. */
        const val RESYNC_REASON = "resync"

        /** The upgrade statuses no retry gets past (lobby api.ts isFinalRefusal). */
        val FINAL_STATUSES = setOf(401, 403, 404)
        private const val HTTP_UNAUTHORIZED = 401

        private val logger: Logger = Logger.getLogger("room-socket")

        internal fun log(line: String) = logger.info(line)
    }
}
