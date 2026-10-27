package app.trycommish.core.lobby

import app.trycommish.core.room.RoomClosed
import app.trycommish.core.room.RoomCommand
import app.trycommish.core.room.RoomRow
import app.trycommish.core.room.Scripted
import app.trycommish.core.room.ScriptedConnector
import app.trycommish.design.Words
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The recorded rows through the frame that puts the drafter (seat 9) on the clock at 1.09, or through `pick`. */
object PickRace {
    fun opening(before: Int = LobbyFixtures.YOU): Pair<List<RoomRow>, List<List<RoomRow>>> {
        val rows = LobbySocketTest.frames()
        val room = LobbyFixtures.room()
        var state = LobbyState.of(room)
        var upTo = 0
        for ((index, batch) in rows.withIndex()) {
            if (state.drafting && state.pickNumber >= before) break
            state = state.applying(batch, room.you)
            upTo = index
        }
        return rows.subList(0, upTo + 1).flatten() to rows.drop(upTo + 1)
    }
}

/**
 * The pick race over the recorded lobby, as the iOS LobbyPickRaceTests: off the clock Draft sends nothing; a
 * pick sent on the clock that the room overtakes (its clock drafts the seat first) is refused in the room's
 * words, applies no row of the member's own, and only a pick that goes out puts the refusal away (an off-clock
 * Draft leaves it, B252).
 */
class LobbyPickRaceTest {
    @Test
    fun `off the clock Draft sends nothing`() =
        runTest {
            // At 1.08 the clock is Bot 8's: the drafter is next, not on it.
            val (opening, _) = PickRace.opening(before = 8)
            val connector = ScriptedConnector(listOf(listOf(LobbySocketTest.welcome(opening), LobbySocketTest.pickStep(8), Scripted.End)))
            val vm = LobbySocketTest.viewModel(StubLobby(), connector)
            val card = requireNotNull(LobbyFixtures.card(LobbyFixtures.YOU))
            var drove = false
            connector.drive = { command ->
                if (command is RoomCommand.Pick) {
                    assertFalse(vm.drawn.value?.yourTurn == true)
                    vm.draft(card.call)
                    drove = true
                } else {
                    vm.close()
                }
            }
            vm.run()
            // The Draft was tapped off the clock, and only the hello went out.
            assertTrue(drove)
            assertEquals(listOf(LobbySocketTest.hello(0)), connector.sent.first())
        }

    /** B252 review M2: a Draft on the clock whose pick goes out puts the room's refusal away. */
    @Test
    fun `a pick that goes out puts the refusal away`() =
        runTest {
            val (opening, _) = PickRace.opening()
            val connector =
                ScriptedConnector(
                    listOf(listOf(LobbySocketTest.welcome(opening), refused(), LobbySocketTest.pickStep(LobbyFixtures.YOU), Scripted.End)),
                )
            val vm = LobbySocketTest.viewModel(StubLobby(), connector)
            val card = requireNotNull(LobbyFixtures.card(LobbyFixtures.YOU))
            val notices = mutableListOf<String?>()
            connector.drive = { command ->
                if (command is RoomCommand.Pick) {
                    notices += vm.notice()
                    vm.draft(card.call)
                    notices += vm.notice()
                }
            }
            vm.run()
            assertEquals(listOf(QUEUED, null), notices)
            assertEquals(1, connector.sent.first().count { (it.jsonObject["type"] as? JsonPrimitive)?.content == "pick" })
        }

    /**
     * B252 review M1: a Draft on the clock while the socket reconnects cannot go; the same refusal after the
     * reconnect still shows, never hidden behind a dismissal it did not answer.
     */
    @Test
    fun `a Draft while reconnecting hides no later refusal`() =
        runTest {
            val (opening, _) = PickRace.opening()
            val queueStep = Scripted.Client(Json.parseToJsonElement(RoomCommand.Queue(emptyList()).text).jsonObject)
            val connector =
                ScriptedConnector(
                    listOf(
                        listOf(LobbySocketTest.welcome(opening), refused(), Scripted.Close(RoomClosed(ABNORMAL))),
                        listOf(LobbySocketTest.welcome(opening), refused(), queueStep, Scripted.End),
                    ),
                )
            val card = requireNotNull(LobbyFixtures.card(LobbyFixtures.YOU))
            var whileReconnecting: String? = null
            lateinit var vm: LobbyViewModel
            vm =
                LobbySocketTest.viewModel(StubLobby(), connector, onWait = {
                    // On the clock with the socket down: the Draft is tapped and its pick cannot go.
                    vm.draft(card.call)
                    whileReconnecting = vm.notice()
                })
            var afterReconnect: String? = null
            connector.drive = { command -> if (command is RoomCommand.Queue) afterReconnect = vm.notice() }
            vm.run()
            assertEquals(Words.Lobby.reconnecting, whileReconnecting)
            assertEquals(QUEUED, afterReconnect)
            assertFalse(connector.sent.flatten().any { (it.jsonObject["type"] as? JsonPrimitive)?.content == "pick" })
        }

    /** B252: an off-clock Draft sends nothing, so it puts no refusal away; the same refusal again shows. */
    @Test
    fun `an off-clock Draft leaves the refusal and the same refusal again shows`() =
        runTest {
            val (opening, _) = PickRace.opening(before = 8)
            val refused = refused()
            val queueStep = Scripted.Client(Json.parseToJsonElement(RoomCommand.Queue(emptyList()).text).jsonObject)
            val connector =
                ScriptedConnector(
                    listOf(listOf(LobbySocketTest.welcome(opening), refused, queueStep, refused, queueStep, Scripted.End)),
                )
            val vm = LobbySocketTest.viewModel(StubLobby(), connector)
            val card = requireNotNull(LobbyFixtures.card(LobbyFixtures.YOU))
            val notices = mutableListOf<String?>()
            connector.drive = { command ->
                if (command is RoomCommand.Queue) {
                    if (notices.isEmpty()) {
                        // Refused, then the member taps Draft off the clock: nothing goes, the refusal stays.
                        assertEquals(QUEUED, vm.notice())
                        vm.draft(card.call)
                    }
                    notices += vm.notice()
                }
            }
            vm.run()
            assertEquals(listOf(QUEUED, QUEUED), notices)
            assertFalse(connector.sent.first().any { (it.jsonObject["type"] as? JsonPrimitive)?.content == "pick" })
        }

    @Test
    fun `a pick the room overtakes is refused and only a sent pick puts it away`() =
        runTest {
            val (opening, _) = PickRace.opening()
            val last = opening.last().seq
            val card = requireNotNull(LobbyFixtures.card(LobbyFixtures.YOU))
            // The room's clock drafts seat 9 before the member's pick lands: 1.09 by the clock, someone else.
            val clockPick =
                RoomRow(
                    seq = last + 1,
                    kind = "TIMER_EXPIRE",
                    seat = LobbyFixtures.YOU,
                    payload =
                        Json.parseToJsonElement(
                            """{"pick":{"pick":9,"round":1,"seat":9,"player_id":"4241389","auto":true,"by":"clock"},""" +
                                """"deadline":"2026-10-26T08:20:00Z"}""",
                        ),
                    written = "2026-10-26T08:19:30Z",
                )
            val queueStep = Scripted.Client(Json.parseToJsonElement(RoomCommand.Queue(emptyList()).text).jsonObject)
            val connector =
                ScriptedConnector(
                    listOf(
                        listOf(
                            LobbySocketTest.welcome(opening),
                            LobbySocketTest.pickStep(LobbyFixtures.YOU),
                            LobbySocketTest.update(listOf(clockPick)),
                            Scripted.Server("""{"type":"error","code":"conflict","message":"$REFUSAL"}"""),
                            queueStep,
                            Scripted.End,
                        ),
                    ),
                )
            val vm = LobbySocketTest.viewModel(StubLobby(), connector)
            var afterRefusal: String? = null
            var afterNextDraft: String? = "unset"
            connector.drive = { command ->
                when (command) {
                    is RoomCommand.Pick -> vm.draft(card.call)
                    is RoomCommand.Queue -> {
                        afterRefusal = vm.notice()
                        vm.draft(card.call)
                        afterNextDraft = vm.notice()
                    }
                    RoomCommand.Leave -> vm.close()
                }
            }
            vm.run()
            assertEquals(REFUSAL, afterRefusal)
            // The next Draft is off the clock now: nothing is sent, so the refusal stays (B252).
            assertEquals(REFUSAL, afterNextDraft)
            val picks =
                vm.lobby.value
                    ?.picks
                    .orEmpty()
            assertEquals(LobbyFixtures.YOU, picks.last().pick)
            assertEquals(LobbyPickBy.Clock, picks.last().madeBy)
            assertFalse(picks.any { it.playerId == card.call })
            // One pick went out, at the pick on the clock when it was sent; the second Draft, off the clock now,
            // sent nothing.
            val sent = connector.sent.first().filter { (it.jsonObject["type"] as? JsonPrimitive)?.content == "pick" }
            assertEquals(listOf(Json.parseToJsonElement(RoomCommand.Pick(card.call, LobbyFixtures.YOU).text)), sent)
        }

    private companion object {
        const val ABNORMAL = 1006

        /** The room refusing a queue of a drafted player, in its words. */
        fun refused(): Scripted = Scripted.Server("""{"type":"error","code":"conflict","message":"$QUEUED"}""")

        const val REFUSAL = "You are not on the clock."
        const val QUEUED = "That player is drafted."
    }
}
