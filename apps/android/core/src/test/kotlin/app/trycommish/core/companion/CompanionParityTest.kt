package app.trycommish.core.companion

import app.trycommish.api.models.CompanionPick
import app.trycommish.api.models.DraftCompanion
import app.trycommish.core.Format
import app.trycommish.core.board.GapTone
import app.trycommish.core.companion.CompanionFixtures.Moment
import app.trycommish.core.companion.CompanionParity.parity
import app.trycommish.core.companion.CompanionParity.room
import app.trycommish.core.companion.CompanionParity.web
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource
import kotlin.math.abs

/**
 * The companion's port held to the web's page at 390 (shared/fixtures/parity/companion.json), as the iOS
 * CompanionParityTests hold theirs: through the view model over the recorded replay read in order as the
 * page reads it, per moment the bar, the notes, the strip of picks as they land, at the turn the picks
 * since and the call with the shortlist, between turns the call that waits on the board, the pool under
 * every chip with its basis and chances, and the team; the report; the followed drafts' lines; and the
 * sentences the replay never reaches over edited copies of a recorded answer.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CompanionParityTest {
    private val main = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    @ParameterizedTest
    @EnumSource(Moment::class, names = ["Waiting", "Between", "Turn", "Taken"])
    fun `the bar is the web's`(moment: Moment) {
        val (_, model) = room(moment, main)
        val web = web(moment)
        val bar = requireNotNull(web.obj("bar"))
        assertEquals(bar.text("figure"), model.bar.figure)
        assertEquals(bar.text("caption"), model.bar.caption)
        assertEquals(bar.text("section"), model.bar.section)
        assertEquals(bar.text("title"), model.bar.title)
        assertEquals(bar.text("league"), model.bar.league)
        assertEquals(bar.text("turn"), model.bar.turn)
        assertEquals(bar.flag("onTurn"), model.bar.onTurn)
        assertEquals(bar.text("stale"), model.bar.stale)
        assertEquals(bar.text("open"), model.bar.open)
        assertEquals(bar.text("openURL"), model.bar.openUrl)
        assertEquals(web.strings("notes"), model.notes)
        assertEquals(web.text("lost"), model.lost)
        assertEquals(web.strings("names"), model.names)
    }

    @ParameterizedTest
    @EnumSource(Moment::class, names = ["Waiting", "Between", "Turn", "Taken"])
    fun `the strips are the web's`(moment: Moment) {
        val (_, model) = room(moment, main)
        val web = web(moment)
        expectStrip(model.strip, web.obj("strip"))
        expectStrip(model.since, web.obj("since"))
    }

    private fun expectStrip(
        strip: PickStripModel?,
        web: JsonObject?,
    ) {
        if (web == null) return assertNull(strip)
        val ours = requireNotNull(strip) { "a strip the web draws is not drawn" }
        assertEquals(web.text("lead"), ours.lead)
        assertEquals(web.strings("lines"), ours.lines)
        val picks = web.list("picks")
        assertEquals(picks.map { it.text("id") }, ours.picks.map { it.player.id })
        assertEquals(picks.map { it.text("name") }, ours.picks.map { it.name })
        assertEquals(picks.map { it.strings("lines") }, ours.picks.map { it.lines })
        if (picks.firstOrNull()?.containsKey("newest") == true) {
            assertEquals(picks.map { it.flag("newest") }, ours.picks.map { it.newest })
            assertEquals(picks.map { it.flag("strong") }, ours.picks.map { it.strong })
        }
    }

    @ParameterizedTest
    @EnumSource(Moment::class, names = ["Waiting", "Between", "Turn", "Taken"])
    fun `the call and the shortlist are the web's`(moment: Moment) {
        val (_, model) = room(moment, main)
        val web = web(moment)
        val call = web.obj("call")
        if (call == null) {
            assertNull(model.call)
        } else {
            val ours = requireNotNull(model.call)
            assertEquals(call.text("tag"), ours.tag)
            assertEquals(call.text("chanceHead"), ours.chanceHead)
            assertEquals(call.text("verb"), ours.verb)
            assertEquals(call.flag("waiting"), ours.waiting)
            val rows = call.list("rows")
            assertEquals(rows.map { it.text("id") }, ours.rows.map { it.player.id })
            assertEquals(rows.map { it.text("pill") }, ours.rows.map { it.player.pill })
            assertEquals(rows.map { it.text("value") }, ours.rows.map { it.value })
            assertEquals(rows.map { it.text("chance") }, ours.rows.map { it.chance })
        }
        if (web["shortlist"] is kotlinx.serialization.json.JsonArray) {
            expectShortlist(requireNotNull(model.shortlist), web.list("shortlist"))
        } else {
            assertNull(model.shortlist)
        }
    }

    @ParameterizedTest
    @EnumSource(Moment::class, names = ["Waiting", "Between", "Turn", "Taken"])
    fun `the pool under every chip is the web's`(moment: Moment) {
        val (vm, model) = room(moment, main)
        val pool = requireNotNull(web(moment).obj("pool"))
        val ours = requireNotNull(model.pool)
        assertEquals(pool.text("line"), ours.line)
        assertEquals(pool.text("basis"), ours.basis)
        assertEquals(pool.text("chanceHead"), ours.chanceHead)
        assertEquals(pool.text("chanceLabel"), ours.chanceLabel)
        assertEquals(pool.text("missing"), ours.missing)
        pool.list("views").forEach { view ->
            val filter = requireNotNull(view.text("filter"))
            vm.choose(filter)
            val chosen = requireNotNull(assertInstanceOf(CompanionState.Room::class.java, vm.state.value).model.pool)
            val rows = chosen.rows
            val first = rows.take(PoolModel.FIRST_ROWS)
            val webRows = view.list("rows")
            assertEquals(view.number("count"), rows.size, "$moment $filter")
            assertEquals(view.text("empty"), chosen.empty)
            assertEquals(view.text("more"), chosen.more(PoolModel.FIRST_ROWS))
            assertEquals(webRows.map { it.text("id") }, first.map { it.player.id }, "$moment $filter")
            assertEquals(webRows.map { it.text("pill") }, first.map { it.player.pill })
            assertEquals(webRows.map { it.obj("value")?.text("text") }, first.map { it.value })
            assertEquals(webRows.map { it.obj("value")?.text("heat") }, first.map { it.heat?.id })
            assertEquals(webRows.map { it.text("chance") }, first.map { it.chance })
            assertEquals(webRows.map { it.flag("call") }, first.map { it.isCall })
        }
    }

    @ParameterizedTest
    @EnumSource(Moment::class)
    fun `the team is the web's`(moment: Moment) {
        var picks = emptyList<CompanionPick>()
        var board: RoomBoardView? = null
        var latest: DraftCompanion? = null
        CompanionFixtures.through(moment).forEach { step ->
            val answer = CompanionFixtures.answer(step)
            answer.board?.let { board = RoomBoardView.of(it, answer.teams) }
            picks = picks.filter { it.pick <= answer.since } + answer.picks
            latest = answer
        }
        val model = CompanionModel.of(requireNotNull(latest), picks, requireNotNull(board), seen = 0, filter = RoomDraft.ALL)
        val web = web(moment)
        val team = requireNotNull(web.obj("team"))
        assertEquals(team.text("count"), model.team.count)
        val slots = team.list("slots")
        assertEquals(slots.map { it.text("slot") }, model.team.slots.map { it.slot })
        assertEquals(slots.map { it.text("id") }, model.team.slots.map { it.player?.id })
        assertEquals(slots.map { it.text("pick") }, model.team.slots.map { it.pick })
        assertEquals(web.number("picks"), picks.size)
    }

    @ParameterizedTest
    @EnumSource(Moment::class, names = ["Waiting", "Between", "Turn", "Taken"])
    fun `the wall is the web's`(moment: Moment) {
        val (_, model) = room(moment, main)
        val wall = requireNotNull(web(moment).obj("wall"))
        assertEquals(wall.text("title"), model.wall.title)
        assertEquals(wall.text("label"), model.wall.label)
        assertEquals(wall.strings("names"), model.wall.names)
        assertEquals(wall.number("you"), model.wall.you)
        val rows = (wall["rows"] as kotlinx.serialization.json.JsonArray).map { row -> row.jsonArrayObjects() }
        assertEquals(rows.size, model.wall.rows.size)
        model.wall.rows.zip(rows).forEach { (ours, theirs) ->
            assertEquals(theirs.map { it.number("pick") }, ours.map { it.pick })
            assertEquals(theirs.map { it.text("id") }, ours.map { it.player?.id })
            assertEquals(theirs.map { it.text("name") }, ours.map { it.name })
            assertEquals(theirs.map { it.text("line") }, ours.map { it.line })
            assertEquals(theirs.map { it.flag("mine") }, ours.map { it.mine })
            assertEquals(theirs.map { it.obj("now")?.text("words") }, ours.map { it.now?.words })
            assertEquals(theirs.map { it.obj("now")?.text("pick") }, ours.map { it.now?.pick })
        }
    }

    @Test
    fun `the report is the web's`() {
        val vm = CompanionParity.viewModel(Moment.Complete, main)
        val shown = assertInstanceOf(CompanionState.Report::class.java, vm.state.value)
        val report = shown.report
        val web = requireNotNull(parity.obj("report"))
        assertEquals("The draft is over", shown.bar.turn)
        assertEquals(web.text("title"), report.title)
        assertEquals(web.text("points"), report.points)
        assertEquals(web.text("caption"), report.caption)
        val cells = web.list("cells")
        assertEquals(cells.map { it.text("label") }, report.cells.map { it.label })
        assertEquals(cells.map { it.text("value") }, report.cells.map { it.value })
        assertEquals(cells.map { it.flag("mine") }, report.cells.map { it.mine })
        assertEquals(web.text("verb"), Words.Companion.followAnother)
        assertEquals(web.text("basis"), report.basis)
        val field = requireNotNull(web.obj("field"))
        assertEquals(field.text("note"), report.fieldNote)
        val teams = field.list("rows")
        assertEquals(teams.map { it.number("rank") }, report.field.map { it.rank })
        assertEquals(teams.map { it.text("name") }, report.field.map { it.name })
        assertEquals(teams.map { it.text("points") }, report.field.map { it.points })
        assertEquals(teams.map { it.flag("you") }, report.field.map { it.you })
        report.field.zip(teams).forEach { (ours, theirs) -> assert(abs(ours.share - (theirs.real("share") ?: 0.0)) < SHARE_TOLERANCE) }
    }

    @Test
    fun `the pick by pick table is the web's`() {
        val report =
            assertInstanceOf(
                CompanionState.Report::class.java,
                CompanionParity.viewModel(Moment.Complete, main).state.value,
            ).report
        val picks = requireNotNull(parity.obj("report")?.obj("picks"))
        assertEquals(picks.text("note"), report.picksNote)
        val rows = picks.list("rows")
        assertEquals(rows.map { it.text("pick") }, report.picks.map { it.pick })
        assertEquals(rows.map { it.text("name") }, report.picks.map { it.name })
        assertEquals(rows.map { it.text("slot") }, report.picks.map { it.slot })
        assertEquals(rows.map { it.obj("figure")?.text("text") }, report.picks.map { it.figure.text })
        assertEquals(rows.map { it.obj("figure")?.flag("muted") }, report.picks.map { it.figure.muted })
        assertEquals(rows.map { it.obj("adp")?.text("text") }, report.picks.map { it.adp?.text })
        assertEquals(rows.map { it.obj("ours")?.text("text") }, report.picks.map { it.ours?.text })
        assertEquals(rows.map { it.obj("adp")?.text("tone") }, report.picks.map { tone(it.adp?.tone) })
        assertEquals(rows.map { it.obj("still")?.text("text") }, report.picks.map { it.still.text })
        assertEquals(rows.map { it.obj("still")?.flag("wait") }, report.picks.map { it.still.wait })
        assertEquals(rows.map { it.obj("still")?.flag("muted") }, report.picks.map { it.still.muted })
        assertEquals(rows.map { it.text("by") }, report.picks.map { it.madeBy })
    }

    private fun tone(tone: GapTone?): String? =
        when (tone) {
            GapTone.Gain -> "gain"
            GapTone.Loss -> "loss"
            GapTone.Even -> "even"
            null -> null
        }

    @Test
    fun `the runs and who they land are the web's`() {
        val report =
            assertInstanceOf(
                CompanionState.Report::class.java,
                CompanionParity.viewModel(Moment.Complete, main).state.value,
            ).report
        val web = requireNotNull(parity.obj("report"))
        val runs = requireNotNull(web.obj("runs"))
        assertEquals(runs.text("title"), report.runs.title)
        assertEquals(runs.text("note"), report.runs.note)
        assertEquals(runs.ints("bins"), report.runs.bins)
        assertEquals(runs.number("medianBin"), report.runs.medianBin)
        assertEquals(runs.text("low"), report.runs.low)
        assertEquals(runs.text("high"), report.runs.high)
        assertEquals(runs.text("median"), report.runs.median)
        assertEquals(runs.text("middle"), report.runs.middle)
        assertEquals(runs.text("topShare"), report.runs.topShare)
        assertEquals(runs.text("topWords"), report.runs.topWords)
        assertEquals(runs.ints("ranks"), report.runs.ranks)
        assertEquals(runs.number("rank"), report.runs.rank)
        val exposure = requireNotNull(web.obj("exposure"))
        assertEquals(exposure.text("title"), report.exposureTitle)
        assertEquals(exposure.text("aside"), report.exposureAside)
        val rows = exposure.list("rows")
        assertEquals(rows.map { it.text("id") }, report.exposure.map { it.player.id })
        assertEquals(rows.map { it.text("pill") }, report.exposure.map { it.player.pill })
        assertEquals(rows.map { it.text("percent") }, report.exposure.map { it.percent })
    }

    @Test
    fun `the followed drafts read as the web's lines`() {
        val web = (parity["recent"] as kotlinx.serialization.json.JsonArray).jsonArrayObjects()
        val ours = CompanionFixtures.recent().map(CompanionWords::recentLine)
        assertEquals(web.map { it.text("lead") }, ours.map { it.lead })
        assertEquals(web.map { it.text("text") }, ours.map { it.text })
    }

    companion object {
        private const val SHARE_TOLERANCE = 1e-9

        /** The shortlist row by row: who, his chance and what it is of, our why, his range's words and where
         * its span and median fall (the web's percents to a tenth). */
        fun expectShortlist(
            ours: List<ShortlistLine>,
            web: List<JsonObject>,
        ) {
            assertEquals(web.map { it.text("id") }, ours.map { it.player.id })
            assertEquals(web.map { it.text("chance") }, ours.map { it.chance })
            assertEquals(web.map { it.text("label") }, ours.map { it.label })
            assertEquals(web.map { it.text("why") }, ours.map { it.why })
            val ranges = web.map { it.obj("range") }
            assertEquals(ranges.map { it?.text("text") }, ours.map { it.range?.text })
            assertEquals(ranges.map { it?.text("left") }, ours.map { it.range?.let { range -> Format.fixed(range.left) } })
            assertEquals(ranges.map { it?.text("width") }, ours.map { it.range?.let { range -> Format.fixed(range.width) } })
            assertEquals(ranges.map { it?.text("mid") }, ours.map { it.range?.let { range -> Format.fixed(range.mid) } })
        }
    }
}

internal fun kotlinx.serialization.json.JsonElement.jsonArrayObjects(): List<JsonObject> =
    (this as kotlinx.serialization.json.JsonArray).map { (it as JsonObject) }
