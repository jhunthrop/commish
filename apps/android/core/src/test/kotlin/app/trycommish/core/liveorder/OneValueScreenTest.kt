package app.trycommish.core.liveorder

import app.trycommish.core.Format
import app.trycommish.core.board.BoardFigures
import app.trycommish.core.board.BoardModel
import app.trycommish.core.liveorder.OneValueReads.int
import app.trycommish.core.liveorder.OneValueReads.number
import app.trycommish.core.liveorder.OneValueReads.obj
import app.trycommish.core.liveorder.OneValueReads.objects
import app.trycommish.core.liveorder.OneValueReads.strings
import app.trycommish.core.liveorder.OneValueReads.text
import app.trycommish.core.liveorder.OneValueReads.textOrNull
import app.trycommish.core.player.PlayerPageModel
import app.trycommish.core.rankings.rankingsModel
import app.trycommish.core.reference.ClubPageModel
import app.trycommish.core.reference.CompareRows
import app.trycommish.core.reference.CompareTable
import app.trycommish.core.reference.chooseFormat
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * One value and one order on a club, the clubs index, Compare and the player page's every-format table
 * (Lane 226, the iOS Lane 224's), as the web prints them (one-value.json) once the order or the week
 * answers and while either is unread; and every screen's rank and points for the three players against
 * the Rankings'.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OneValueScreenTest {
    private val reads = OneValueReads
    private val basis = reads.basis

    @BeforeEach
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    // A club and the clubs index.

    @Test
    fun `a club at the order's clock is the order's every row, under the order's head`() =
        runTest {
            val swift = reads.players.first()
            val model = reads.club(swift.text("team"), reads.orders())
            assertTrue(model.atClock)
            assertEquals(swift.obj("club").strings("ids"), model.rows.map { it.id })
            assertEquals(reads.parity.obj("clubHead").text("read"), model.boardHead)
            assertEquals("${model.name}, ${model.boardHead}", model.boardLabel)
            assertTrue(basis.text("lead") in model.basis)
            assertFalse(model.basis.contains(basis.text("stamp")))
            reads.players.filter { it.text("team") == swift.text("team") }.forEach { player ->
                val club = player.obj("club")
                val row = model.rows[club.int("row")]
                assertEquals(player.text("id"), row.id)
                assertEquals("${player.text("position")} ${club.int("positionRank")}", row.pill)
                assertEquals(BoardFigures.projected(club.number("projected")), row.projected)
            }
            assertEquals(model.rows.take(2).map { it.id }, model.compare?.ids, "the compare pair follows the order")
        }

    @Test
    fun `a club unread keeps the run's rows under the board's head with the run's stamp`() =
        runTest {
            val swift = reads.players.first()
            val model = reads.club(swift.text("team"), reads.offline())
            assertFalse(model.atClock)
            assertEquals(reads.parity.obj("clubHead").text("run"), model.boardHead)
            assertEquals(basis.text("stamp"), model.basis.last())
            val row = model.rows.first { it.id == swift.text("id") }
            assertEquals("${swift.text("position")} ${swift.obj("run").int("positionRank")}", row.pill)
        }

    @Test
    fun `the clubs' leads are the web's on either clock`() =
        runTest {
            listOf("read" to reads.orders(), "run" to reads.offline()).forEach { (clock, orders) ->
                val model = reads.clubs(orders)
                assertEquals(clock == "read", model.atClock, clock)
                assertEquals(listOf(if (clock == "read") basis.text("lead") else basis.text("stamp")), model.basis, clock)
                reads.parity.obj("clubs").getValue(clock).objects().forEach { want ->
                    val abbr = want.text("abbr")
                    val card = model.clubs.first { it.abbr == abbr }
                    val lead = want.getValue("lead").takeIf { it != JsonNull }?.jsonObject
                    if (lead == null) {
                        assertNull(card.lead, "$clock $abbr")
                    } else {
                        assertEquals(lead.text("id"), card.lead?.sheetPlayer?.id, "$clock $abbr")
                        assertEquals("${Words.ClubPage.ourRank} ${lead.int("rank")}", card.lead?.rank, "$clock $abbr")
                        assertTrue(card.lead?.pill?.endsWith(" ${lead.int("positionRank")}") == true, "$clock $abbr")
                    }
                }
            }
        }

    // Compare.

    private fun expect(
        table: CompareTable,
        pair: JsonObject,
    ) {
        val sides = pair.getValue("sides").objects().sortedBy { it.int("rank") }
        assertEquals(pair.text("evidence"), table.evidence)
        assertEquals(sides.map { it.text("id") }, table.heads.map { it.id })
        val cells = { label: String ->
            table.rows
                .firstOrNull { it.label == label }
                ?.cells
                ?.map { it.text }
        }
        assertEquals(sides.map { it.int("rank").toString() }, cells("Our rank"))
        assertEquals(sides.map { Format.fixed(it.number("projected")) }, cells(Words.Figure.projected))
        assertEquals(sides.map { BoardFigures.signed(it.number("vor")) }, cells("Over replacement"))
        assertNull(cells(CompareRows.GAP_LABEL))
    }

    @Test
    fun `Compare's pair at the order's clock is the order's`() =
        runTest {
            val model = reads.loaded(reads.compare(reads.orders()))
            val pair = reads.parity.obj("compare").obj("read")
            assertTrue(model.atClock)
            val table = reads.table(model)
            expect(table, pair)
            assertTrue(basis.text("lead") in table.basis)
        }

    @Test
    fun `Compare's pair unread or in another scoring is the run's`() =
        runTest {
            val unread = reads.loaded(reads.compare(reads.offline()))
            assertFalse(unread.atClock)
            val table = reads.table(unread)
            expect(table, reads.parity.obj("compare").obj("run"))
            assertEquals(basis.text("stamp"), table.basis.last())
            val vm = reads.compare(reads.orders())
            reads.loaded(vm)
            val other = reads.parity.obj("compare").obj("otherFormat")
            vm.chooseFormat(other.text("format"))?.join()
            val half = reads.loaded(vm)
            assertFalse(half.atClock)
            assertEquals(other.text("evidence"), reads.table(half).evidence)
        }

    // The player page.

    @Test
    fun `the formats table is on one clock, read, unread and with each format's rank`() {
        reads.players.forEach { player ->
            val id = player.text("id")
            val name = player.text("name")
            listOf(
                "run" to null,
                "read" to OneValueFixture.week(id),
                "ranked" to reads.rankedWeek(player),
            ).forEach { (case, week) ->
                val model = reads.page(id, week)
                val table = requireNotNull(model.formats) { name }
                val want = player.obj("formats").obj(case)
                val rows = want.getValue("rows").objects()
                val position = player.text("position")
                assertEquals(Words.FormatsRank.head, table.rankHead)
                assertEquals(
                    rows.map { row -> row["rank"]?.jsonPrimitive?.intOrNull?.let { "$position $it" } ?: Words.Box.none },
                    table.rows.map { it.rank },
                    "$name $case",
                )
                assertEquals(
                    rows.map { row -> row["points"]?.jsonPrimitive?.doubleOrNull?.let { Format.fixed(it) } ?: Words.Box.none },
                    table.rows.map { it.points },
                    "$name $case",
                )
                assertEquals(
                    rows.map { row -> row["vor"]?.jsonPrimitive?.doubleOrNull?.let { BoardFigures.signed(it) } ?: Words.Box.none },
                    table.rows.map { it.vor },
                    "$name $case",
                )
                assertEquals(want.textOrNull("footnote"), table.footnote, "$name $case")
                val head = if (week == null) player.obj("run").int("positionRank") else player.obj("order").int("positionRank")
                assertEquals("$position $head", model.hero.pill, "$name $case")
                // The run's stamp in the basis while the table shows the run's.
                assertEquals(week == null, basis.text("stamp") in model.basis, "$name $case")
            }
        }
    }

    // Every screen against the Rankings.

    /** What a screen shows of a player: his pill ("RB 15") and his rest-of-season points where it draws them. */
    private data class Shown(
        val screen: String,
        val pill: String?,
        val points: Double?,
    )

    @Test
    fun `every screen agrees with the Rankings`() =
        runTest {
            val order = reads.order()
            val rankings = rankingsModel(order.answer, null, "", inSeason = true, zone = reads.zone, now = reads.now)
            val board = reads.board(order)
            val compared = reads.table(reads.loaded(reads.compare(reads.orders())))
            val clubs = reads.clubs(reads.orders())
            val ids = reads.players.map { it.text("id") }
            val leaders = clubs.clubs.mapNotNull { it.lead }.filter { it.sheetPlayer.id in ids }
            assertTrue(leaders.isNotEmpty(), "a parity player leads his club's card")
            assertEquals(ids.take(2).toSet(), compared.heads.map { it.id }.toSet(), "Compare draws the parity's pair")
            reads.players.forEach { player ->
                val name = player.text("name")
                val ranked = requireNotNull(rankings.rows.firstOrNull { it.player.key == player.text("id") }) { name }
                val points = requireNotNull(ranked.total.toDoubleOrNull()) { name }
                assertEquals(player.obj("order").int("rank").toString(), ranked.place, name)
                val club = reads.club(player.text("team"), reads.orders())
                val page = reads.page(player.text("id"), OneValueFixture.week(player.text("id")))
                shown(player, board, club, page).forEach { screen ->
                    assertEquals(ranked.player.pill, screen.pill, "${screen.screen}: $name")
                    screen.points?.let { assertEquals(points, it, "${screen.screen}: $name") }
                }
                leaders.firstOrNull { it.sheetPlayer.id == player.text("id") }?.let { lead ->
                    assertEquals(ranked.player.pill, lead.pill, "clubs: $name")
                    assertEquals("${Words.ClubPage.ourRank} ${player.obj("order").int("rank")}", lead.rank, "clubs: $name")
                }
                val column = compared.heads.indexOfFirst { it.id == player.text("id") }
                if (column >= 0) {
                    assertEquals(ranked.player.pill, compared.heads[column].pill, "compare: $name")
                    val ourRank =
                        compared.rows
                            .first { it.label == "Our rank" }
                            .cells[column]
                            .text
                    assertEquals(player.obj("order").int("rank").toString(), ourRank, "compare: $name")
                }
            }
        }

    /** His pill and points on the Board, his club and his page, each cell drawn and read as a number; the
     * formats table's rank has no points of its own. */
    private fun shown(
        player: JsonObject,
        board: BoardModel,
        club: ClubPageModel,
        page: PlayerPageModel,
    ): List<Shown> {
        val id = player.text("id")
        val onBoard = requireNotNull(board.rows.firstOrNull { it.id == id }) { "board" }
        val inClub = requireNotNull(club.rows.firstOrNull { it.id == id }) { "club" }
        val line = requireNotNull(page.formats?.rows?.firstOrNull()) { "formats" }
        return listOf(
            Shown("board", onBoard.pill, requireNotNull(onBoard.projected.toDoubleOrNull())),
            Shown("club", inClub.pill, requireNotNull(inClub.projected.toDoubleOrNull())),
            Shown("player", page.hero.pill, requireNotNull(line.points.toDoubleOrNull())),
            Shown("formats", line.rank, null),
        )
    }
}
