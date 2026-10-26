package app.trycommish.core.room

import app.trycommish.core.FixedClock
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.time.Duration
import java.time.Instant

/**
 * The room's socket through the protocol's whole exchange (shared/fixtures/room-socket/exchange.json, the
 * protocol's section 10), as the iOS RoomSocketTests hold theirs: the hello, the welcome and the clock offset,
 * a command and its update, a refusal, a drop mid-draft and the reconnect that replays the log from the last
 * seq; then each way the room stops a client for good, the retry ladder, a row sent twice, a command while
 * closed, and the frames' JSON.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoomSocketTest {
    private val exchange: JsonObject =
        Json.parseToJsonElement(File(System.getProperty("fixtures"), "room-socket/exchange.json").readText()).jsonObject
    private val phoneNow: Instant = Instant.parse(exchange.getValue("phone_now").jsonPrimitive.content)

    private fun scripts(): List<List<Scripted>> =
        exchange.getValue("connections").jsonArray.map { socket -> socket.jsonArray.map { Scripted.of(it.jsonObject) } }

    @Test
    fun `the whole exchange loses no row and applies none twice`() =
        runTest {
            val applied = mutableListOf<Long>()
            val waits = mutableListOf<Long>()
            val connector = ScriptedConnector(scripts())
            val socket =
                RoomSocket(
                    exchange.getValue("socket_url").jsonPrimitive.content,
                    connector,
                    token = { TOKEN },
                    clock = FixedClock(phoneNow),
                    wait = { waits += it },
                    onRows = { rows -> applied += rows.map { it.seq } },
                )
            connector.drive = { command -> if (command == RoomCommand.Leave) socket.close() else assertTrue(socket.send(command)) }
            socket.run()

            assertEquals(listOf(1L, 2L, 3L, 4L, 5L, 6L), applied)
            assertEquals(6L, socket.lastSeq)
            assertEquals(listOf(250L), waits)
            // The refusal was the first socket's; the second welcome cleared it.
            assertNull(socket.refusal.value)
            // The second welcome's clock: 01:02:09 less the phone's 01:02:02.
            assertEquals(Duration.ofSeconds(7), socket.offset)
            assertEquals(RoomStatus.Closed, socket.status.value)
            assertNull(socket.stopped)
            val expected = exchange.getValue("connections").jsonArray.map { it.jsonArray.mapNotNull { step -> step.jsonObject["client"] } }
            assertEquals(expected, connector.sent)
            assertEquals(
                listOf(0, 4),
                connector.sent.map {
                    it
                        .first()
                        .jsonObject
                        .getValue("last_seq")
                        .jsonPrimitive.int
                },
            )
            assertEquals(listOf(TOKEN, TOKEN), connector.tokens)
            assertEquals(listOf(RoomClosed(1000, "left the page")), connector.closes)
        }

    @Test
    fun `a revoked token closes with 1008 and signs out`() =
        runTest {
            var signedOut = false
            val connector =
                ScriptedConnector(
                    listOf(listOf(Scripted.Server(WELCOME), Scripted.Server(SIGN_IN), Scripted.Close(RoomClosed(1008, "signed out")))),
                )
            val socket = socket(connector, signedOut = { signedOut = true })
            socket.run()
            assertTrue(signedOut)
            assertEquals(RoomStatus.Closed, socket.status.value)
            assertEquals("Sign in to do that", socket.stopped)
        }

    @Test
    fun `a seat over its budget stops with the room's sentence`() =
        runTest {
            var signedOut = false
            val waits = mutableListOf<Long>()
            val connector =
                ScriptedConnector(
                    listOf(
                        listOf(
                            Scripted.Server("""{"type":"error","code":"rate_limited","message":"$TOO_MANY_TABS"}"""),
                            Scripted.Close(RoomClosed(1008, "seat over its socket budget")),
                        ),
                    ),
                )
            val socket = socket(connector, waits, signedOut = { signedOut = true })
            socket.run()
            assertFalse(signedOut)
            assertEquals(TOO_MANY_TABS, socket.stopped)
            assertTrue(waits.isEmpty())
        }

    @Test
    fun `a refusal before the upgrade is final only for 401, 403 and 404`() =
        runTest {
            val refused = { status: Int -> listOf(Scripted.Close(RoomClosed(1006, status = status))) }
            val connector = ScriptedConnector(listOf(503, 429, 500, 502, 500, 500, 403).map(refused))
            val waits = mutableListOf<Long>()
            val socket = socket(connector, waits)
            socket.run()
            assertEquals(403, socket.refusedStatus)
            assertEquals(RoomStatus.Closed, socket.status.value)
            assertEquals(RoomSocket.RETRY_LADDER_MS + 5_000L, waits)
            assertTrue(connector.sent.all { it == listOf(hello(0)) })
        }

    @Test
    fun `a 401 before the upgrade signs out`() =
        runTest {
            var signedOut = false
            val socket =
                socket(ScriptedConnector(listOf(listOf(Scripted.Close(RoomClosed(1006, status = 401))))), signedOut = {
                    signedOut =
                        true
                })
            socket.run()
            assertTrue(signedOut)
            assertEquals(401, socket.refusedStatus)
        }

    @Test
    fun `a welcome resets the ladder`() =
        runTest {
            val drop = Scripted.Close(RoomClosed(1006))
            val connector =
                ScriptedConnector(
                    listOf(
                        listOf(drop),
                        listOf(drop),
                        listOf(Scripted.Server(WELCOME), drop),
                        listOf(Scripted.Close(RoomClosed(1006, status = 404))),
                    ),
                )
            val waits = mutableListOf<Long>()
            socket(connector, waits).run()
            assertEquals(listOf(250L, 500L, 250L), waits)
        }

    @Test
    fun `a row already applied is not applied again`() =
        runTest {
            val applied = mutableListOf<Long>()
            val row = { seq: Int -> """{"seq":$seq,"kind":"SET_QUEUE","seat":3,"payload":{},"at":"2026-08-20T01:00:22Z"}""" }
            val connector =
                ScriptedConnector(
                    listOf(
                        listOf(
                            Scripted.Server(
                                """{"type":"welcome","room_id":"r","seq":2,"now":"2026-08-20T01:02:03Z","actions":[${row(1)},${row(2)}]}""",
                            ),
                            Scripted.Server("""{"type":"update","seq":3,"actions":[${row(2)},${row(3)}]}"""),
                            Scripted.Close(RoomClosed(1006, status = 404)),
                        ),
                    ),
                )
            RoomSocket(URL, connector, { TOKEN }, FixedClock(phoneNow), { }, onRows = { rows -> applied += rows.map { it.seq } }).run()
            assertEquals(listOf(1L, 2L, 3L), applied)
        }

    @Test
    fun `a command while the socket is not open is not queued`() =
        runTest {
            val socket = socket(ScriptedConnector(emptyList()))
            assertEquals(RoomStatus.Connecting, socket.status.value)
            assertFalse(socket.send(RoomCommand.Pick("9509", 1)))
        }

    @Test
    fun `commands are the protocol's frames`() {
        assertEquals("""{"pick":3,"player_id":"9509","type":"pick"}""", RoomCommand.Pick("9509", 3).text)
        assertEquals("""{"player_ids":["9509","8150"],"type":"queue"}""", RoomCommand.Queue(listOf("9509", "8150")).text)
        assertEquals("""{"type":"leave"}""", RoomCommand.Leave.text)
        assertEquals("""{"last_seq":4,"type":"hello"}""", RoomCommand.hello(4))
    }

    private fun socket(
        connector: RoomConnector,
        waits: MutableList<Long> = mutableListOf(),
        signedOut: () -> Unit = {},
    ) = RoomSocket(URL, connector, { TOKEN }, FixedClock(phoneNow), { waits += it }, onRows = {}, onSignedOut = signedOut)

    private fun hello(seq: Long): JsonElement = Json.parseToJsonElement(RoomCommand.hello(seq))

    companion object {
        const val URL = "wss://room.example/rooms/r/ws"
        const val TOKEN = "fixture-token"
        const val WELCOME = """{"type":"welcome","room_id":"r","seq":0,"now":"2026-08-20T01:02:03Z","actions":[]}"""
        const val SIGN_IN = """{"type":"error","code":"unauthorized","message":"Sign in to do that"}"""
        const val TOO_MANY_TABS = "This seat already has three tabs open on the room. Close one and reload."
    }
}

/** One step of a scripted socket: a frame the client must send, one the room sends, the socket's end, or the
 * client leaving. */
sealed interface Scripted {
    data class Client(
        val frame: JsonObject,
    ) : Scripted

    data class Server(
        val text: String,
    ) : Scripted

    data class Close(
        val closed: RoomClosed,
    ) : Scripted

    data object End : Scripted

    /** The command a client step names, for the test to send through the socket; null for the hello. */
    fun command(): RoomCommand? {
        val frame = (this as? Client)?.frame ?: return null
        return when (frame.getValue("type").jsonPrimitive.content) {
            "pick" -> RoomCommand.Pick(frame.getValue("player_id").jsonPrimitive.content, frame.getValue("pick").jsonPrimitive.int)
            "queue" -> RoomCommand.Queue((frame.getValue("player_ids") as JsonArray).map { it.jsonPrimitive.content })
            "leave" -> RoomCommand.Leave
            else -> null
        }
    }

    companion object {
        fun of(step: JsonObject): Scripted {
            step["client"]?.let { return Client(it.jsonObject) }
            step["server"]?.let { return Server(it.toString()) }
            step["close"]?.jsonObject?.let { close ->
                return Close(
                    RoomClosed(
                        close.getValue("code").jsonPrimitive.int,
                        close["reason"]?.jsonPrimitive?.content.orEmpty(),
                        close["status"]?.jsonPrimitive?.int,
                    ),
                )
            }
            return End
        }
    }
}

/** A connector over scripted sockets, one per open, in order; it records what the client sent on each (as
 * parsed JSON), the tokens and the closes, and asks the test to send each scripted command but the hello. */
class ScriptedConnector(
    scripts: List<List<Scripted>>,
) : RoomConnector {
    private val scripts = scripts.toMutableList()
    var drive: suspend (RoomCommand) -> Unit = {}
    val sent = mutableListOf<MutableList<JsonElement>>()
    val tokens = mutableListOf<String?>()
    val closes = mutableListOf<RoomClosed>()

    override suspend fun open(
        url: String,
        token: String?,
    ): RoomConnection {
        tokens += token
        if (scripts.isEmpty()) throw RoomClosed(1006, status = 404)
        val record = mutableListOf<JsonElement>().also { sent += it }
        return ScriptedConnection(scripts.removeAt(0).toMutableList(), record, this)
    }
}

private class ScriptedConnection(
    private val steps: MutableList<Scripted>,
    private val record: MutableList<JsonElement>,
    private val connector: ScriptedConnector,
) : RoomConnection {
    private var left: RoomClosed? = null

    override suspend fun send(text: String) {
        left?.let { throw it }
        record += Json.parseToJsonElement(text)
    }

    override suspend fun receive(): String {
        while (steps.isNotEmpty()) {
            left?.let { throw it }
            when (val step = steps.removeAt(0)) {
                is Scripted.Server -> return step.text
                is Scripted.Close -> throw step.closed
                is Scripted.Client -> step.command()?.let { connector.drive(it) }
                Scripted.End -> connector.drive(RoomCommand.Leave)
            }
        }
        throw left ?: RoomClosed(1006)
    }

    override suspend fun close(
        code: Int,
        reason: String,
    ) {
        RoomClosed(code, reason).also {
            left = it
            connector.closes += it
        }
    }
}
