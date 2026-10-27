package app.trycommish.core.lobby

import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.flag
import app.trycommish.core.companion.list
import app.trycommish.core.companion.number
import app.trycommish.core.companion.obj
import app.trycommish.core.companion.strings
import app.trycommish.core.companion.text
import app.trycommish.design.Words
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * The lobby's port held to the web's lobby at 390 (shared/fixtures/parity/lobby.json), as the iOS
 * LobbyParityTests hold theirs: the recorded socket's frames replayed in order as the page applies them, and at
 * each drawn state the replayed state itself, the score bug on the room's clock, the seats strip, the filling
 * line, the strip of picks as they land, our call and its verb, the pool under every chip, the wall, the team and
 * the dock's line; the room at its end; the landing's cards; the leave questions; the two reports.
 */
class LobbyParityTest {
    private fun web(name: String): JsonObject = requireNotNull(parity.obj("states")?.obj(name))

    /** A state drawn as the web draws it: the room's model under a chip, the replayed state, the web's room. */
    private data class Drawn(
        val model: LobbyRoomModel,
        val lobby: LobbyState,
        val room: JsonObject,
    )

    private fun drawn(
        name: String,
        filter: String = "All",
    ): Drawn {
        val web = web(name)
        val lobby = LobbyFixtures.replayed(requireNotNull(web.number("frame")))
        val room = LobbyFixtures.room()
        val model =
            LobbyRoomModel.of(
                room,
                RoomBoardView.of(room.board, room.teams),
                lobby,
                web.number("card")?.let(LobbyFixtures::card),
                Instant.parse(requireNotNull(web.text("now"))),
                filter,
            )
        return Drawn(model, lobby, requireNotNull(web.obj("room")))
    }

    @ParameterizedTest
    @ValueSource(strings = ["filling", "started", "yourTurn", "between", "round2", "round3"])
    fun `the replayed state is the web's`(name: String) {
        val (_, lobby, web) = drawn(name)
        val state = requireNotNull(web.obj("state"))
        assertEquals(state.number("seq")?.toLong(), lobby.seq)
        assertEquals(state.number("pickNumber"), lobby.pickNumber)
        assertEquals(state.flag("drafting"), lobby.drafting)
        assertEquals(state.flag("complete"), lobby.complete)
        assertEquals(state.flag("soloPace"), lobby.soloPace)
        assertEquals(state.strings("queue"), lobby.queue)
        assertEquals(state.text("deadline"), lobby.deadline?.let(ISO::format))
        assertEquals(
            state.getValue("picks").jsonArray.map { pick -> pick.jsonArray.joinToString(" ") { it.jsonPrimitive.content } },
            lobby.picks.map { "${it.pick} ${it.seat} ${it.playerId} ${it.madeBy.wire}" },
        )
        assertEquals(
            state.getValue("seats").jsonArray.map { seat ->
                val cells = seat.jsonArray
                "${cells[1].textOr("-")} ${cells[2].textOr("-")}"
            },
            (1..TEAMS).map { "${lobby.seats[it]?.handle ?: "-"} ${lobby.seats[it]?.kind?.wire ?: "-"}" },
        )
    }

    @ParameterizedTest
    @ValueSource(strings = ["filling", "started", "yourTurn", "between", "round2", "round3"])
    fun `the score bug, the seats and the wait are the web's`(name: String) {
        val (model, lobby, web) = drawn(name)
        val bug = web.obj("bug")
        if (bug == null) {
            assertNull(model.bug)
        } else {
            val mine = requireNotNull(model.bug)
            assertEquals(bug.text("round"), mine.round)
            assertEquals(bug.text("pick"), mine.pick)
            assertEquals(bug.text("onClock"), mine.onClock)
            assertEquals(bug.text("clock"), mine.clock)
            assertEquals(bug.text("yourPick"), mine.yourPick)
            assertEquals(bug.text("spoken"), mine.spoken)
        }
        val seats = web.list("seats")
        assertEquals(seats.map { it.text("name") }, model.seats.map { it.name })
        assertEquals(seats.map { it.text("line") }, model.seats.map { it.line })
        assertEquals(seats.map { it.flag("compact") }, model.seats.map { it.compact })
        assertEquals(seats.map { it.text("label") }, model.seats.map { it.label })
        val wait = web.obj("wait")
        if (wait == null) {
            assertNull(model.wait)
        } else {
            assertEquals(wait.text("count"), model.wait?.count)
            assertEquals(wait.text("words"), model.wait?.words)
        }
        val about = requireNotNull(web.obj("about"))
        assertEquals(about.text("head"), model.aboutHead)
        assertEquals(about.text("app"), model.about)
        assertEquals(
            about.text("words"),
            LobbyWords.about(
                LobbySeats.people(lobby.seats.values.map { it.kind }),
                TEAMS,
                lobby.drafting || lobby.complete,
                CLOCK_SECONDS,
                Words.Lobby.standInWeb,
            ),
        )
    }

    @ParameterizedTest
    @ValueSource(strings = ["filling", "started", "yourTurn", "between", "round2", "round3"])
    fun `the strip and the call are the web's`(name: String) {
        val (model, _, web) = drawn(name)
        val landing = web.obj("landing")
        if (landing == null) {
            assertNull(model.landing)
        } else {
            val strip = requireNotNull(model.landing)
            assertEquals(landing.text("lead"), strip.lead)
            assertEquals(landing.strings("lines"), strip.lines)
            val faces = landing.list("faces")
            assertEquals(faces.map { it.number("pick") }, strip.picks.map { it.pick })
            assertEquals(faces.map { it.text("name") }, strip.picks.map { it.name })
            assertEquals(faces.map { it.strings("lines") }, strip.picks.map { it.lines })
            assertEquals(faces.map { it.flag("strong") }, strip.picks.map { it.strong })
        }
        val call = web.obj("call")
        if (call == null) {
            assertNull(model.call)
        } else {
            val mine = requireNotNull(model.call).model
            assertEquals(call.text("tag"), mine.tag)
            assertEquals(call.text("chanceHead"), mine.chanceHead)
            assertEquals(call.text("verb"), mine.verb)
            val rows = call.list("rows")
            assertEquals(rows.map { it.text("id") }, mine.rows.map { it.player.id })
            assertEquals(rows.map { it.text("chance") }, mine.rows.map { it.chance })
        }
    }

    @ParameterizedTest
    @ValueSource(strings = ["filling", "started", "yourTurn", "between", "round2", "round3"])
    fun `the pool under every chip is the web's`(name: String) {
        val pool = requireNotNull(drawn(name).room.obj("pool"))
        for (chip in pool.list("filters")) {
            val filter = requireNotNull(chip.text("filter"))
            val mine = requireNotNull(drawn(name, filter).model.pool)
            assertEquals(pool.text("line"), mine.model.line)
            assertEquals(pool.text("basis"), mine.model.basis)
            assertEquals(pool.text("chanceLabel"), mine.model.chanceLabel)
            assertEquals(pool.text("missing"), mine.model.missing)
            assertEquals(pool.flag("draftShown"), mine.draftShown)
            assertEquals(chip.number("count"), mine.rows.size, "$name $filter")
            assertEquals(chip.text("empty"), mine.empty)
            val rows = chip.list("rows")
            val first = mine.rows.take(rows.size)
            assertEquals(rows.map { it.text("id") }, first.map { it.id }, "$name $filter")
            assertEquals(rows.map { it.text("value") }, first.map { it.line.value })
            assertEquals(rows.map { it.text("chance") }, first.map { it.line.chance })
            assertEquals(rows.map { it.flag("call") }, first.map { it.line.isCall })
            assertEquals(rows.map { it.flag("queued") }, first.map { it.queued })
        }
    }

    @ParameterizedTest
    @ValueSource(strings = ["filling", "started", "yourTurn", "between", "round2", "round3"])
    fun `the wall and the team are the web's`(name: String) {
        val (model, _, web) = drawn(name)
        expectWallAndTeam(model, web)
    }

    @Test
    fun `the room at its end is the web's`() {
        val end = requireNotNull(parity.obj("end"))
        assertEquals(end.number("frames"), LobbyFixtures.steps().size)
        val lobby = LobbyFixtures.replayed()
        val web = requireNotNull(end.obj("room"))
        val state = requireNotNull(web.obj("state"))
        assertTrue(lobby.complete)
        assertEquals(state.number("seq")?.toLong(), lobby.seq)
        assertEquals(state.getValue("picks").jsonArray.size, lobby.picks.size)
        val room = LobbyFixtures.room()
        val model = LobbyRoomModel.of(room, RoomBoardView.of(room.board, room.teams), lobby, null, Instant.EPOCH)
        assertNull(model.pool)
        assertNull(model.bug)
        expectWallAndTeam(model, web)
    }

    @Test
    fun `the landing's cards are the web's`() =
        runTest {
            val landing = requireNotNull(parity.obj("landing"))
            val vm = LobbyLandingViewModel(StubLobby())
            vm.load()
            assertEquals(landing.text("head"), vm.head)
            val cards = landing.list("cards")
            assertEquals(cards.map { it.text("format") }, vm.cards.map { it.id })
            assertEquals(cards.map { it.text("title") }, vm.cards.map { it.title })
            assertEquals(cards.map { it.text("clock") }, vm.cards.map { it.clock })
            assertEquals(cards.map { it.text("fill") }, vm.cards.map { it.fill })
            assertEquals(cards.map { it.flag("empty") }, vm.cards.map { it.empty })
            assertEquals(cards.map { it.text("verb") }, vm.cards.map { it.verb })
            assertEquals(landing.strings("fills"), listOf(0, 1, 2, 11).map { LobbyWords.fill(it).first })
            assertEquals(landing.text("emptyHead"), LobbyWords.listHead(listOf(0)))
        }

    @Test
    fun `the leave questions are the web's`() {
        val leave = requireNotNull(parity.obj("leave"))
        assertEquals(leave.text("filling"), Words.Lobby.leaveFilling)
        assertEquals(leave.text("drafting"), Words.Lobby.leaveDrafting)
    }

    @ParameterizedTest
    @ValueSource(strings = ["first:jpk88", "down:mara"])
    fun `the report is the web's`(which: String) {
        val (key, handle) = which.split(":")
        val web = requireNotNull(parity.obj("reports")?.obj(key))
        val report = LobbyFixtures.report(handle)
        val model = LobbyReportViewModel.model(report, LobbyFixtures.room(complete = true))
        assertEquals(web.strings("names"), names(report.slot))
        expectReport(model, web)
        assertEquals(web.strings("verbs"), listOf(Words.Lobby.joinAnother, LobbyWords.soloAgain(report.slot)))
    }

    private fun names(you: Int): List<String> {
        val room = LobbyFixtures.room(complete = true)
        return (1..room.teams).map { seat -> room.seats.firstOrNull { it.seat == seat }?.let { LobbySeats.name(it, you) } ?: "Bot $seat" }
    }

    private fun expectWallAndTeam(
        model: LobbyRoomModel,
        web: JsonObject,
    ) {
        val wall = requireNotNull(web.obj("wall"))
        assertEquals(wall.strings("names"), model.wall.names)
        assertEquals(
            wall.getValue("rows").jsonArray.map { row -> row.jsonArray.map { it.textOr("-") } },
            model.wall.rows.map { row -> row.map { it.player?.id ?: "-" } },
        )
        val team = requireNotNull(web.obj("team"))
        assertEquals(team.text("count"), model.team.count)
        val slots = team.list("slots")
        assertEquals(slots.map { it.text("slot") }, model.team.slots.map { it.slot })
        assertEquals(slots.map { it.text("id") }, model.team.slots.map { it.player?.id })
        assertEquals(slots.map { it.text("pick") }, model.team.slots.map { it.pick })
    }

    private fun expectReport(
        model: DraftReportModel,
        web: JsonObject,
    ) {
        assertEquals(web.text("title"), model.title)
        assertEquals(web.text("points"), model.points)
        assertEquals(web.text("caption"), model.caption)
        val cells = web.list("cells")
        assertEquals(cells.map { it.text("label") }, model.cells.map { it.label })
        assertEquals(cells.map { it.text("value") }, model.cells.map { it.value })
        assertEquals(cells.map { it.flag("mine") }, model.cells.map { it.mine })
        assertEquals(web.text("basis"), model.basis)
        val field = requireNotNull(web.obj("field"))
        assertEquals(field.text("note"), model.fieldNote)
        assertEquals(field.list("rows").map { it.text("name") }, model.field.map { it.name })
        assertEquals(field.list("rows").map { it.text("points") }, model.field.map { it.points })
        assertNotNull(web.obj("picks"))
        assertEquals(web.obj("picks")?.list("rows")?.map { it.text("pick") }, model.picks.map { it.pick })
        assertEquals(web.obj("runs")?.text("title"), model.runs.title)
    }

    private fun JsonElement.textOr(none: String): String = if (this is JsonNull) none else (this as? JsonPrimitive)?.contentOrNull ?: none

    private companion object {
        val parity: JsonObject = Json.parseToJsonElement(LobbyFixtures.parity()).jsonObject
        const val TEAMS = 12
        const val CLOCK_SECONDS = 30
        val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    }
}
