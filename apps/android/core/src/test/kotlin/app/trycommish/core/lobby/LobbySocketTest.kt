package app.trycommish.core.lobby

import app.trycommish.core.FixedClock
import app.trycommish.core.SessionEnd
import app.trycommish.core.room.RoomClosed
import app.trycommish.core.room.RoomCommand
import app.trycommish.core.room.RoomFrame
import app.trycommish.core.room.RoomRow
import app.trycommish.core.room.Scripted
import app.trycommish.core.room.ScriptedConnector
import app.trycommish.design.Words
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The lobby through its view model and the room's socket over the recorded lobby (shared/fixtures/lobby-room),
 * as the iOS LobbySocketTests: a join and the handle it may ask for; the whole recorded exchange replayed to the
 * web's end; a pick on your turn sent as the room's command and landing as its row; a drop and the reconnect that
 * says hello from the last seq; a frame that skips a seq, which reads the room again and replays the whole log
 * from the welcome (B219); a gap whose read is refused; a 1008 close; a room read refused with 403, which is final
 * and never polled (B208); an upgrade refused with 403; Leave through the API.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LobbySocketTest {
    @Test
    fun `a join answers the seat, then the card reads Your seat`() =
        runTest {
            val api = StubLobby(needsHandle = true)
            val landing = LobbyLandingViewModel(api)
            landing.load()
            val format = landing.cards.first().format
            assertNull(landing.join(format))
            assertEquals(format, landing.handleFor.value)
            assertEquals(LobbyFixtures.ID, landing.saveHandle(" you "))
            assertEquals(listOf("you"), api.handles)
            assertEquals(listOf("12_ppr", "12_ppr"), api.joins)
            assertEquals(Words.Lobby.yourSeat, landing.cards.first().verb)
            // The seat opens the room again, never a second join.
            assertEquals(LobbyFixtures.ID, landing.join(format))
            assertEquals(2, api.joins.size)
            // A seat the API no longer holds is forgotten on the next read.
            api.refusal = 403
            landing.load()
            assertEquals(Words.Lobby.join, landing.cards.first().verb)
        }

    @Test
    fun `the whole recorded exchange replays to the web's end`() =
        runTest {
            val script = mutableListOf<Scripted>()
            var first = true
            for (step in LobbyFixtures.steps()) {
                when (step) {
                    is LobbyFixtures.Step.Server ->
                        rowsOf(step.text)?.let { rows ->
                            script += if (first) welcome(rows) else update(rows)
                            first = false
                        }
                    is LobbyFixtures.Step.Client -> if (step.frame.type() != "hello") script += Scripted.Client(step.frame)
                }
            }
            val connector = ScriptedConnector(listOf(script + Scripted.End))
            val api = StubLobby()
            val waits = mutableListOf<Long>()
            val vm = viewModel(api, connector, waits)
            connector.drive = { command ->
                when (command) {
                    is RoomCommand.Pick -> vm.draft(command.playerId)
                    is RoomCommand.Queue -> command.playerIds.forEach { vm.toggleQueue(it) }
                    RoomCommand.Leave -> vm.close()
                }
            }
            vm.run()
            val end = LobbyFixtures.replayed()
            assertEquals(end, vm.lobby.value)
            assertTrue(vm.lobby.value?.complete == true)
            assertEquals(
                TOTAL_PICKS,
                vm.lobby.value
                    ?.picks
                    ?.size,
            )
            assertNull(vm.drawn.value?.pool)
            // Every pick of the drafter's went over the socket as the room's command, at the pick on the clock.
            val sent = connector.sent.first()
            val picks = sent.filter { it.jsonObject.type() == "pick" }.map { it.jsonObject }
            val mine = end.picks.filter { it.seat == LobbyFixtures.YOU }
            assertEquals(mine.map { it.pick }, picks.map { it.getValue("pick").jsonPrimitive.int })
            assertEquals(mine.map { it.playerId }, picks.map { it.getValue("player_id").jsonPrimitive.content })
            assertEquals(Json.parseToJsonElement(RoomCommand.hello(0)), sent.first())
            assertEquals(1, api.reads)
        }

    @Test
    fun `a pick on your turn lands as its row and not before`() =
        runTest {
            val (opening, next) = PickRace.opening()
            val card = requireNotNull(LobbyFixtures.card(LobbyFixtures.YOU))
            val connector =
                ScriptedConnector(
                    listOf(listOf(welcome(opening), pickStep(LobbyFixtures.YOU), update(next.first()), Scripted.End)),
                )
            val vm = viewModel(StubLobby(), connector)
            var before: Int? = null
            connector.drive = { command ->
                if (command is RoomCommand.Pick) {
                    assertTrue(vm.drawn.value?.yourTurn == true)
                    vm.draft(card.call)
                    // Sent, not applied: the pick lands only when its row comes back.
                    before =
                        vm.lobby.value
                            ?.picks
                            ?.size
                } else {
                    vm.close()
                }
            }
            vm.run()
            assertEquals(LobbyFixtures.YOU - 1, before)
            val mine =
                vm.lobby.value
                    ?.picks
                    ?.firstOrNull { it.pick == LobbyFixtures.YOU }
            assertEquals(LobbyFixtures.YOU, mine?.seat)
            assertEquals(LobbyPickBy.Drafter, mine?.madeBy)
            assertTrue(Json.parseToJsonElement(RoomCommand.Pick(card.call, LobbyFixtures.YOU).text) in connector.sent.first())
        }

    @Test
    fun `a drop reconnects with the last seq and loses no row`() =
        runTest {
            val rows = frames()
            val first = listOf(welcome(rows[0])) + rows.subList(1, CUT).map(::update) + Scripted.Close(RoomClosed(ABNORMAL))
            val second = listOf(welcome(rows.subList(CUT, CUT + 3).flatten())) + rows.drop(CUT + 3).map(::update) + Scripted.End
            val connector = ScriptedConnector(listOf(first, second))
            val waits = mutableListOf<Long>()
            val vm = viewModel(StubLobby(), connector, waits)
            connector.drive = { vm.close() }
            vm.run()
            val lastSeq = rows[CUT - 1].last().seq
            assertEquals(listOf(hello(0), hello(lastSeq)), connector.sent.map { it.first() })
            assertEquals(listOf(250L), waits)
            assertEquals(LobbyFixtures.replayed(), vm.lobby.value)
        }

    @Test
    fun `a seq gap reads the room again and replays from the welcome`() =
        runTest {
            val rows = frames()
            // The frame at CUT is lost: the next update skips its seqs.
            val first = listOf(welcome(rows[0])) + rows.subList(1, CUT).map(::update) + update(rows[CUT + 1])
            val second = listOf(welcome(rows.flatten()), Scripted.End)
            val connector = ScriptedConnector(listOf(first, second))
            val waits = mutableListOf<Long>()
            val api = StubLobby()
            val vm = viewModel(api, connector, waits)
            val seen = mutableListOf<Long>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.lobby.collect { state -> state?.let { seen += it.seq } } }
            connector.drive = { vm.close() }
            vm.run()
            assertEquals(RoomClosed(1000, "resync"), connector.closes.first())
            // The room was read again, at once, with no wait on the ladder, and the second socket said hello from
            // nothing, so its welcome carried the whole log.
            assertEquals(2, api.reads)
            assertTrue(waits.isEmpty())
            assertEquals(hello(0), connector.sent.last().first())
            // The skipped rows were never applied on their own: no state between the gap and the whole log.
            val beforeGap = rows[CUT - 1].last().seq
            val end = LobbyFixtures.replayed()
            assertTrue(beforeGap in seen)
            assertTrue(seen.none { it > beforeGap && it < end.seq }, "$seen")
            assertEquals(end, vm.lobby.value)
        }

    @Test
    fun `a gap whose room read is refused stops for good`() =
        runTest {
            val rows = frames()
            val connector = ScriptedConnector(listOf(listOf(welcome(rows[0]), update(rows[2]))))
            val api =
                StubLobby().apply {
                    refusal = 404
                    refusalFrom = 2
                }
            val waits = mutableListOf<Long>()
            val vm = viewModel(api, connector, waits)
            vm.run()
            assertEquals(2, api.reads)
            assertEquals(LobbyScreenState.Failed(Words.Lobby.gone, final = true), vm.state.value)
            assertEquals(1, connector.tokens.size)
            assertTrue(waits.isEmpty())
        }

    @Test
    fun `a 1008 close signs out with the room's sentence`() =
        runTest {
            var signedOut = false
            val connector =
                ScriptedConnector(
                    listOf(
                        listOf(
                            welcome(frames()[0]),
                            Scripted.Server("""{"type":"error","code":"unauthorized","message":"Sign in to do that"}"""),
                            Scripted.Close(RoomClosed(1008, "signed out")),
                        ),
                    ),
                )
            val vm = viewModel(StubLobby(), connector, signedOut = { signedOut = true })
            vm.run()
            assertTrue(signedOut)
            assertEquals("Sign in to do that", vm.stopped.value)
            assertFalse(vm.open)
        }

    @Test
    fun `a room read refused with 403 is final and never polled`() =
        runTest {
            val api = StubLobby().apply { refusal = 403 }
            val connector = ScriptedConnector(emptyList())
            val waits = mutableListOf<Long>()
            val vm = viewModel(api, connector, waits)
            vm.run()
            assertEquals(LobbyScreenState.Failed(Words.Lobby.noSeat, final = true), vm.state.value)
            assertEquals(1, api.reads)
            assertTrue(connector.tokens.isEmpty())
            assertTrue(waits.isEmpty())
        }

    @Test
    fun `an upgrade refused with 403 stops with the lobby's words`() =
        runTest {
            val connector = ScriptedConnector(listOf(listOf(Scripted.Close(RoomClosed(ABNORMAL, status = 403)))))
            val vm = viewModel(StubLobby(), connector)
            vm.run()
            assertEquals(Words.Lobby.noSeat, vm.stopped.value)
            assertEquals(1, connector.tokens.size)
        }

    @Test
    fun `leave goes through the API and asks the web's question`() =
        runTest {
            val api = StubLobby()
            val connector = ScriptedConnector(listOf(listOf(welcome(frames()[0]), Scripted.End)))
            val vm = viewModel(api, connector)
            connector.drive = {
                assertEquals(Words.Lobby.leaveFilling, vm.leaveQuestion)
                assertTrue(vm.leave())
            }
            vm.run()
            assertEquals(1, api.leaves)
            assertEquals(listOf(RoomClosed(1000, "left the page")), connector.closes)
        }

    companion object {
        const val CUT = 20
        const val ABNORMAL = 1006
        const val TOTAL_PICKS = 180
        const val TOKEN = "fixture-token"
        const val NOW = "2026-10-26T08:15:02.712Z"

        fun frames(): List<List<RoomRow>> = LobbyFixtures.frames().map { it.second }

        fun viewModel(
            api: StubLobby,
            connector: ScriptedConnector,
            waits: MutableList<Long> = mutableListOf(),
            signedOut: () -> Unit = {},
            onWait: suspend () -> Unit = {},
        ): LobbyViewModel =
            LobbyViewModel(
                LobbyFixtures.ID,
                api,
                connector,
                { TOKEN },
                FixedClock(LobbyFixtures.phone),
                SessionEnd(signedOut),
                wait = {
                    waits += it
                    onWait()
                },
            )

        fun rowsOf(text: String): List<RoomRow>? =
            when (val frame = RoomFrame.decode(text)) {
                is RoomFrame.Welcome -> frame.rows
                is RoomFrame.Update -> frame.rows
                is RoomFrame.Error, null -> null
            }

        fun welcome(rows: List<RoomRow>): Scripted = Scripted.Server(frame("welcome", rows, now = NOW))

        fun update(rows: List<RoomRow>): Scripted = Scripted.Server(frame("update", rows, now = null))

        fun pickStep(pick: Int): Scripted = Scripted.Client(Json.parseToJsonElement(RoomCommand.Pick("x", pick).text).jsonObject)

        fun hello(seq: Long): JsonElement = Json.parseToJsonElement(RoomCommand.hello(seq))

        private fun frame(
            type: String,
            rows: List<RoomRow>,
            now: String?,
        ): String {
            val fields =
                mutableMapOf<String, JsonElement>(
                    "type" to JsonPrimitive(type),
                    "room_id" to JsonPrimitive("r"),
                    "seq" to JsonPrimitive(rows.lastOrNull()?.seq ?: 0),
                    "actions" to JsonArray(rows.map(::row)),
                )
            now?.let { fields["now"] = JsonPrimitive(it) }
            return JsonObject(fields).toString()
        }

        private fun row(row: RoomRow): JsonElement =
            JsonObject(
                mapOf(
                    "seq" to JsonPrimitive(row.seq),
                    "kind" to JsonPrimitive(row.kind),
                    "seat" to (row.seat?.let(::JsonPrimitive) ?: JsonNull),
                    "payload" to row.payload,
                    "at" to JsonPrimitive(row.written),
                ),
            )

        private fun JsonObject.type(): String? = (get("type") as? JsonPrimitive)?.content
    }
}
