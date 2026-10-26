package app.trycommish.core.mock

import app.trycommish.api.models.BoardFormat
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.companion.Drafter
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.RoomDraft
import app.trycommish.core.companion.flag
import app.trycommish.core.companion.list
import app.trycommish.core.companion.number
import app.trycommish.core.companion.obj
import app.trycommish.core.companion.real
import app.trycommish.core.companion.strings
import app.trycommish.core.companion.text
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource
import java.time.Instant

/**
 * The mock room's port held to the web's room at 390 (shared/fixtures/parity/mock.json), as the iOS
 * MockParityTests hold theirs: through the view model over the recorded draft played in order as the room
 * plays it, at every answer the bar, our call, the strip since your pick, the pool under every chip, the wall
 * and the team; the undo's line; the reading frame; the turn with no call; a shared draft's head and pool; the
 * setup; and the three reports.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MockParityTest {
    private val main = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    /** The states in the order a room reaches them, each with the step that reaches it. */
    enum class Step(
        val id: String,
    ) {
        Create("create"),
        Pick1("pick-1"),
        Pick2("pick-2"),
        Pick3("pick-3"),
        Pick4("pick-4"),
        Round5("round5"),
        Queue("queue"),
        Undo("undo"),
        PickAgain("pick-again"),
        Autopick("autopick"),
    }

    private fun idle() = main.scheduler.advanceUntilIdle()

    /** The view model after playing the draft through `step`: the first mock from its first turn by hand to
     * 5.05; then opened again at 5.05, a player queued, 4.08 taken back and drafted again, and Pick for me
     * through round 8. */
    private fun played(step: Step): Pair<MockRoomViewModel, StubMock> {
        val fromRound5 = step.ordinal >= Step.Round5.ordinal
        val stub = StubMock(if (fromRound5) MockFixtures.Answer.Round5 else MockFixtures.Answer.Create)
        val vm = MockRoomViewModel(MockFixtures.ID, stub, MemoryCache(), FixedClock(CLOCK), MockFixtures.zone, SessionEnd {})
        vm.load()
        idle()
        val start = if (fromRound5) Step.Round5.ordinal else 0
        Step.entries.filter { it.ordinal in (start + 1)..step.ordinal }.forEach { next ->
            when (next) {
                Step.Pick1, Step.Pick2, Step.Pick3, Step.Pick4, Step.PickAgain -> vm.draft()
                Step.Queue -> vm.toggleQueue(MockFixtures.room(MockFixtures.Answer.Queue).queue.first())
                Step.Undo -> vm.undo()
                Step.Autopick -> vm.autopick()
                Step.Create, Step.Round5 -> null
            }
            idle()
        }
        return vm to stub
    }

    private fun model(vm: MockRoomViewModel): MockRoomModel = assertInstanceOf(MockRoomState.Room::class.java, vm.state.value).model

    private fun web(step: Step): JsonObject = requireNotNull(parity.obj("states")?.obj(step.id))

    @ParameterizedTest
    @EnumSource(Step::class)
    fun `the bar and the call are the web's`(step: Step) {
        val model = model(played(step).first)
        val web = web(step)
        assertEquals(web.number("pick"), model.room.pickNumber)
        val bar = requireNotNull(model.bar)
        assertEquals(web.text("head"), bar.head)
        val cells = web.list("cells")
        assertEquals(cells.map { it.text("label") }, bar.cells.map { it.label })
        assertEquals(cells.map { it.text("value") }, bar.cells.map { it.value })
        assertEquals(cells.map { it.flag("word") }, bar.cells.map { it.word })
        assertEquals(web.text("autopick"), bar.autopick)
        assertEquals(web.number("lastMine"), bar.undoPick)
        val call = requireNotNull(web.obj("call"))
        val made = assertInstanceOf(MockCallState.Call::class.java, model.call)
        val rows = call.list("rows")
        assertEquals(call.text("tag"), made.call.tag)
        assertEquals(call.text("chanceHead"), made.call.chanceHead)
        assertEquals(call.text("verb"), made.call.verb)
        assertEquals(rows.map { it.text("id") }, made.call.rows.map { it.player.id })
        assertEquals(rows.map { it.text("value") }, made.call.rows.map { it.value })
        assertEquals(rows.map { it.text("chance") }, made.call.rows.map { it.chance })
        assertEquals(rows.first().text("id"), made.playerId)
    }

    @ParameterizedTest
    @EnumSource(Step::class)
    fun `the strip since your pick is the web's`(step: Step) {
        val model = model(played(step).first)
        val since = web(step).obj("since")
        if (since == null) {
            assertNull(model.since)
            assertNull(model.straight)
            return
        }
        since.text("straight")?.let {
            assertEquals(it, model.straight)
            assertNull(model.since)
            return
        }
        val strip = requireNotNull(model.since)
        val faces = since.list("faces")
        assertEquals(since.text("lead"), strip.lead)
        assertEquals(since.strings("lines"), strip.lines)
        assertEquals(faces.map { it.number("pick") }, strip.picks.map { it.pick })
        assertEquals(faces.map { it.text("name") }, strip.picks.map { it.name })
        assertEquals(faces.map { it.strings("lines") }, strip.picks.map { it.lines })
    }

    @ParameterizedTest
    @EnumSource(Step::class)
    fun `the pool under every chip is the web's`(step: Step) {
        val vm = played(step).first
        val web = requireNotNull(web(step).obj("pool"))
        val filters = web.list("filters")
        assertEquals(filters.map { it.text("filter") }, model(vm).pool?.filters)
        filters.forEach { chip ->
            val filter = requireNotNull(chip.text("filter"))
            vm.choose(filter)
            val pool = requireNotNull(model(vm).pool)
            assertEquals(web.text("line"), pool.model.line)
            assertEquals(web.text("basis"), pool.model.basis)
            assertEquals(web.text("chanceLabel"), pool.model.chanceLabel)
            assertEquals(web.text("missing"), pool.model.missing)
            assertEquals(chip.number("count"), pool.rows.size, filter)
            assertEquals(chip.text("empty"), pool.empty)
            val rows = chip.list("rows")
            val first = pool.rows.take(PoolModel.FIRST_ROWS)
            assertEquals(rows.map { it.text("id") }, first.map { it.id }, filter)
            assertEquals(rows.map { it.obj("value")?.text("text") }, first.map { it.line.value })
            assertEquals(rows.map { it.obj("value")?.text("heat") }, first.map { it.line.heat?.id })
            assertEquals(rows.map { it.text("chance") }, first.map { it.line.chance })
            assertEquals(rows.map { it.flag("call") }, first.map { it.line.isCall })
            assertEquals(rows.map { it.flag("queued") }, first.map { it.queued })
        }
    }

    @ParameterizedTest
    @EnumSource(Step::class)
    fun `the wall and the team are the web's`(step: Step) {
        val model = model(played(step).first)
        val web = web(step)
        val wall = requireNotNull(web.obj("wall"))
        assertEquals(wall.strings("names"), model.wall.names)
        val rows = (wall["rows"] as JsonArray).map { row -> (row as JsonArray).map { (it as? JsonPrimitive)?.contentOrNull } }
        assertEquals(rows, model.wall.rows.map { row -> row.map { it.player?.id } })
        val team = requireNotNull(web.obj("team"))
        val slots = team.list("slots")
        assertEquals(team.text("count"), model.team.count)
        assertEquals(slots.map { it.text("slot") }, model.team.slots.map { it.slot })
        assertEquals(slots.map { it.text("id") }, model.team.slots.map { it.player?.id })
        assertEquals(slots.map { it.text("pick") }, model.team.slots.map { it.pick })
    }

    @Test
    fun `the undo says where the room went back`() {
        val (vm, stub) = played(Step.Undo)
        val undo = requireNotNull(parity.obj("undo"))
        assertEquals(listOf(undo.number("pick")), stub.undone)
        assertEquals(undo.text("words"), model(vm).notice)
    }

    @Test
    fun `a pick in flight reads the room for the next turn`() {
        val room = MockFixtures.room(MockFixtures.Answer.Create)
        val board = RoomBoardView.of(requireNotNull(room.board), room.teams)
        val model = MockRoomModel.of(room, board, null, MockRoomUi(busy = true, draftedAt = room.pickNumber))
        val reading = assertInstanceOf(MockCallState.Reading::class.java, model.call)
        val web = web(Step.Create)
        assertEquals(web.text("reading"), reading.words)
        assertEquals(web.strings("frame"), reading.call.rows.map { it.player.id })
    }

    @Test
    fun `a turn with no call drafts from the pool's top row`() {
        val room = MockFixtures.room(MockFixtures.Answer.Create)
        val board = RoomBoardView.of(requireNotNull(room.board), room.teams)
        val web = requireNotNull(parity.obj("noCall"))
        val model = MockRoomModel.of(room, board, null, MockRoomUi(callMissing = true))
        val noCall = assertInstanceOf(MockCallState.NoCall::class.java, model.call)
        val drafted = room.picks.map { it.playerId }.toSet()
        assertEquals(RoomDraft.pool(board, drafted, RoomDraft.ALL).first().id, noCall.playerId)
        assertEquals(web.text("basis"), model.pool?.model?.basis)
        assertEquals(web.text("missing"), model.pool?.model?.missing)
        assertEquals(web.text("verb"), noCall.verb)
    }

    @Test
    fun `a shared draft's head and pool are the web's`() {
        val vm = SharedMockViewModel("code", StubMock(MockFixtures.Answer.SharedRound5))
        vm.load()
        idle()
        val model = assertInstanceOf(SharedMockState.Room::class.java, vm.state.value).model
        val web = requireNotNull(parity.obj("shared"))
        val head = requireNotNull(model.shared)
        assertEquals(web.text("title"), head.title)
        assertEquals(web.text("line"), head.line)
        assertEquals(web.text("verb"), head.verb)
        assertEquals(web.text("note"), head.note)
        assertNull(model.bar)
        assertNull(model.call)
        val room = requireNotNull(web.obj("room"))
        assertEquals(room.obj("wall")?.strings("names"), model.wall.names)
        val pool = requireNotNull(room.obj("pool"))
        val filters = pool.list("filters")
        assertEquals(filters.map { it.text("filter") }, model.pool?.filters)
        assertEquals(pool.text("basis"), model.pool?.model?.basis)
        assertEquals(
            filters.first().list("rows").map { it.text("id") },
            model.pool
                ?.rows
                ?.take(PoolModel.FIRST_ROWS)
                ?.map { it.id },
        )
        assertTrue(model.pool?.rows?.all { it.line.chance == null } == true)
    }

    @Test
    fun `the setup is the web's`() {
        val web = requireNotNull(parity.obj("setup"))
        val form = MockSetupViewModel(StubMock()).form.value
        assertEquals(web.text("title"), Words.Mock.setupTitle)
        assertEquals(web.list("cells").map { it.text("label") }, form.cells.map { it.label })
        assertEquals(web.list("cells").map { it.text("value") }, form.cells.map { it.value })
        assertEquals(web.strings("scoring"), MockSetup.scoring.map { it.second })
        assertEquals(web.strings("lineups"), MockSetup.lineups.map { it.second })
        assertEquals(web.strings("teams").map(String::toInt), MockSetup.teams)
        assertEquals(web.text("line"), MockWords.formatLine(form.settings))
        assertEquals(web.text("start"), Words.Mock.start)
    }

    @Test
    fun `the setup starts in the context's format as the web's`() {
        val web = requireNotNull(parity.obj("setup"))
        val formats = web.list("formats")
        assertEquals(FORMATS, formats.size)
        formats.forEach { entry ->
            val format = BoardFormat.entries.first { it.value == entry.text("format") }
            val form = MockSetupViewModel(StubMock(), seed = MockSetupSeed(format = format)).form.value
            assertEquals(entry.text("line"), MockWords.formatLine(form.settings), format.value)
        }
        web.list("nearest").forEach { entry ->
            val preset = MockSetup.nearestPreset(requireNotNull(entry.real("reception")), requireNotNull(entry.real("bonus")))
            assertEquals(entry.text("preset"), preset.value)
        }
    }

    @Test
    fun `the report at first is the web's`() {
        val (vm, _) = played(Step.Autopick)
        vm.finish()
        idle()
        val report = assertInstanceOf(MockRoomState.Report::class.java, vm.state.value)
        val web = requireNotNull(parity.obj("reports")?.obj("first"))
        expectReport(report.report, web)
        assertEquals(web.strings("verbs"), listOf(MockWords.runAgain(report.slot), Words.Mock.tryAnother, Words.Mock.copyLink))
        assertNotNull(report.shareCode)
    }

    @Test
    fun `the report well down is the web's`() {
        val report = MockFixtures.report("report-down")
        val model = DraftReportModel.of(report, MockWords.seatNames(report.teams, report.slot), Words.Mock.botsByAdp, Words.Mock.reshuffled)
        expectReport(model, requireNotNull(parity.obj("reports")?.obj("down")))
    }

    @Test
    fun `a shared report speaks of its drafter`() {
        val vm = SharedMockViewModel("code", StubMock(MockFixtures.Answer.SharedComplete))
        vm.load()
        idle()
        val report = assertInstanceOf(SharedMockState.Report::class.java, vm.state.value)
        val web = requireNotNull(parity.obj("reports")?.obj("shared"))
        expectReport(report.report, web)
        assertEquals(web.strings("verbs").first(), report.verb)
        assertEquals(listOf("lane213"), listOf(MockFixtures.room(MockFixtures.Answer.SharedComplete).sharedBy))
        assertEquals(
            "lane213's draft from slot 5",
            DraftReportModel.of(MockFixtures.report(), emptyList(), "", "", Drafter("lane213")).title,
        )
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
        val picks = requireNotNull(web.obj("picks"))
        assertEquals(picks.text("note"), model.picksNote)
        val rows = picks.list("rows")
        assertEquals(rows.map { it.text("pick") }, model.picks.map { it.pick })
        assertEquals(rows.map { it.text("slot") }, model.picks.map { it.slot })
        assertEquals(rows.map { it.text("by") }, model.picks.map { it.madeBy })
        assertEquals(rows.map { it.obj("still")?.text("text") }, model.picks.map { it.still.text })
        val runs = requireNotNull(web.obj("runs"))
        assertEquals(runs.text("title"), model.runs.title)
        assertEquals(runs.text("note"), model.runs.note)
        assertEquals(runs.text("middle"), model.runs.middle)
        assertEquals(runs.text("topWords"), model.runs.topWords)
        assertEquals(web.obj("exposure")?.text("title"), model.exposureTitle)
    }

    private companion object {
        val parity: JsonObject = Json.parseToJsonElement(MockFixtures.parity()).jsonObject
        val CLOCK: Instant = Instant.parse("2026-10-25T21:00:00Z")
        const val FORMATS = 5
    }
}
