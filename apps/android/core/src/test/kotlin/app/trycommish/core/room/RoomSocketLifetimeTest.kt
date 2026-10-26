package app.trycommish.core.room

import app.trycommish.core.FixedClock
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * The socket never outlives its owner, as the iOS RoomSocketLifetimeTests hold it: a cancelled run closes the
 * open socket, a close or a cancel while the socket is still opening leaves no socket and sends no hello, a
 * cancellation during the ladder's wait opens nothing more. Frames this client does not know are skipped, and
 * text that is no frame at all closes with 1002, never the reserved 1006.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoomSocketLifetimeTest {
    private val clock = FixedClock(Instant.parse("2026-08-20T01:02:02Z"))

    @Test
    fun `a cancelled run closes the open socket`() =
        runTest {
            val connection = HeldConnection(listOf(RoomSocketTest.WELCOME))
            val connector = HeldConnector(listOf(connection))
            val socket = socket(connector)
            val running = launch { socket.run() }
            runCurrent()
            assertEquals(RoomStatus.Open, socket.status.value)
            running.cancel()
            running.join()
            assertEquals(listOf(RoomClosed(1000, "left the page")), connection.closes)
            assertEquals(1, connector.opens)
            assertEquals(RoomStatus.Closed, socket.status.value)
        }

    @Test
    fun `a close while opening leaves no socket and sends no hello`() =
        runTest {
            val connection = HeldConnection(listOf(RoomSocketTest.WELCOME))
            val connector = HeldConnector(listOf(connection), holdOpen = true)
            val socket = socket(connector)
            val running = launch { socket.run() }
            runCurrent()
            socket.close()
            connector.release.complete(Unit)
            running.join()
            assertTrue(connection.sent.isEmpty())
            assertEquals(listOf(RoomClosed(1000, "left the page")), connection.closes)
            assertEquals(1, connector.opens)
            assertEquals(RoomStatus.Closed, socket.status.value)
        }

    @Test
    fun `a cancel while opening leaves no socket and sends no hello`() =
        runTest {
            val connection = HeldConnection(listOf(RoomSocketTest.WELCOME))
            val connector = HeldConnector(listOf(connection), holdOpen = true, openIgnoresCancel = true)
            val socket = socket(connector)
            val running = launch { socket.run() }
            runCurrent()
            running.cancel()
            connector.release.complete(Unit)
            running.join()
            assertTrue(connection.sent.isEmpty())
            assertEquals(listOf(RoomClosed(1000, "left the page")), connection.closes)
        }

    @Test
    fun `a cancellation during the ladder's wait opens nothing more`() =
        runTest {
            val connector = HeldConnector(emptyList(), refusals = 2)
            val waiting = CompletableDeferred<Unit>()
            val socket =
                RoomSocket(RoomSocketTest.URL, connector, { RoomSocketTest.TOKEN }, clock, wait = {
                    waiting.complete(Unit)
                    awaitCancellation()
                }, onRows = {})
            val running = launch { socket.run() }
            waiting.await()
            running.cancel()
            running.join()
            assertEquals(1, connector.opens)
            assertEquals(RoomStatus.Closed, socket.status.value)
        }

    @Test
    fun `a frame of an unknown type is skipped and the next update still applies`() =
        runTest {
            val applied = mutableListOf<Long>()
            val row = { seq: Int -> """{"seq":$seq,"kind":"SET_QUEUE","seat":3,"payload":{},"at":"2026-08-20T01:00:22Z"}""" }
            val connection =
                HeldConnection(
                    listOf(
                        RoomSocketTest.WELCOME,
                        """{"type":"update","seq":1,"actions":[${row(1)}]}""",
                        """{"type":"presence","seats":[1,4]}""",
                        """{"type":"update","seq":2,"actions":[${row(2)}]}""",
                    ),
                )
            val socket =
                RoomSocket(RoomSocketTest.URL, HeldConnector(listOf(connection)), { RoomSocketTest.TOKEN }, clock, { }, onRows = { rows ->
                    applied +=
                        rows.map { it.seq }
                })
            val running = launch { socket.run() }
            runCurrent()
            assertEquals(listOf(1L, 2L), applied)
            assertEquals(RoomStatus.Open, socket.status.value)
            running.cancel()
            running.join()
            assertEquals(listOf(RoomClosed(1000, "left the page")), connection.closes)
        }

    @Test
    fun `text that is no frame closes with 1002 and retries`() =
        runTest {
            val broken = HeldConnection(listOf(RoomSocketTest.WELCOME, "not json"))
            val connector = HeldConnector(listOf(broken), refusals = 1, refusalStatus = 404)
            val waits = mutableListOf<Long>()
            RoomSocket(RoomSocketTest.URL, connector, { RoomSocketTest.TOKEN }, clock, { waits += it }, onRows = {}).run()
            assertEquals(listOf(RoomClosed(1002, "unreadable frame")), broken.closes)
            assertEquals(listOf(250L), waits)
            assertEquals(2, connector.opens)
        }

    private fun socket(connector: RoomConnector) =
        RoomSocket(RoomSocketTest.URL, connector, { RoomSocketTest.TOKEN }, clock, { }, onRows = {})
}

/** A socket that hands out its frames, then holds the receive open until it is closed, as a live one does. */
private class HeldConnection(
    frames: List<String>,
) : RoomConnection {
    private val frames = Channel<String>(Channel.UNLIMITED).apply { frames.forEach { trySend(it) } }
    private var closed: RoomClosed? = null
    val sent = mutableListOf<String>()
    val closes = mutableListOf<RoomClosed>()

    override suspend fun send(text: String) {
        closed?.let { throw it }
        sent += text
    }

    override suspend fun receive(): String = frames.receiveCatching().getOrNull() ?: throw closed ?: RoomClosed(1006)

    override suspend fun close(
        code: Int,
        reason: String,
    ) {
        val close = RoomClosed(code, reason)
        closes += close
        closed = close
        frames.close()
    }
}

/** Opens its sockets in order, then `refusals` refused upgrades; with `holdOpen` the first open waits on
 * `release` (and with `openIgnoresCancel` finishes opening even once its caller is cancelled, as a socket mid
 * handshake does). */
private class HeldConnector(
    connections: List<HeldConnection>,
    private var holdOpen: Boolean = false,
    private val openIgnoresCancel: Boolean = false,
    private var refusals: Int = 0,
    private val refusalStatus: Int? = null,
) : RoomConnector {
    private val connections = connections.toMutableList()
    val release = CompletableDeferred<Unit>()
    var opens = 0
        private set

    override suspend fun open(
        url: String,
        token: String?,
    ): RoomConnection {
        opens++
        if (holdOpen) {
            holdOpen = false
            if (openIgnoresCancel) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { release.await() }
            } else {
                release.await()
            }
        }
        if (connections.isNotEmpty()) return connections.removeAt(0)
        if (refusals > 0) {
            refusals--
            throw RoomClosed(1006, status = refusalStatus)
        }
        throw RoomClosed(1006, status = 404)
    }
}
