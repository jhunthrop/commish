package app.trycommish.core.liveorder

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.RunDesignationsAnswer
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardFigures
import app.trycommish.core.board.BoardPosition
import app.trycommish.core.board.BoardState
import app.trycommish.core.board.BoardViewModel
import app.trycommish.core.board.Heat
import app.trycommish.core.board.KeptBody
import app.trycommish.core.board.RunBoardRead
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.liveorder.OneValueReads.int
import app.trycommish.core.liveorder.OneValueReads.number
import app.trycommish.core.liveorder.OneValueReads.obj
import app.trycommish.core.liveorder.OneValueReads.strings
import app.trycommish.core.liveorder.OneValueReads.text
import app.trycommish.core.rankings.OrderQuery
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * One value and one order for a player on every in-season screen (Lane 226, the iOS Lane 224's tests, the
 * web's Lane 220 rule): the words a screen says its clock in, the Board and the share, over the one-value
 * stand-in run with the order the Rankings read at the Sunday clock, print the figures and ranks the web
 * prints (one-value.json); while the order is unread the Board keeps the run's, every row, with the run's
 * stamp.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OneValueTest {
    private val reads = OneValueReads
    private val basis = reads.basis

    @BeforeEach
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    // The words.

    @Test
    fun `the lead, the run's stamp, the reach and the footnotes are the web's`() =
        runTest {
            val order = reads.order()
            val format = reads.run().format
            assertEquals(basis.text("lead"), order.lead(reads.parity.int("teams"), reads.zone))
            assertEquals(basis.text("stamp"), LiveOrderWords.runStamp(format, reads.zone))
            val sample = basis.strings("sample")
            val board = sample[1]
            assertEquals(basis.strings("unread"), LiveOrder.basis(sample, board, null, basis.text("stamp")))
            assertEquals(basis.strings("read"), LiveOrder.basis(sample, board, basis.text("lead"), basis.text("stamp")))
            assertEquals(basis.obj("bare").strings("unread"), LiveOrder.basis(emptyList(), null, null, basis.text("stamp")))
            assertEquals(basis.obj("bare").strings("read"), LiveOrder.basis(emptyList(), null, basis.text("lead"), basis.text("stamp")))
            val reach = basis.obj("reach")
            assertEquals(reach.text("text"), LiveOrderWords.reach(reach.int("shown"), reach.int("total")))
            assertEquals(
                "Standard shows no position rank at this read, only its points.",
                LiveOrderWords.unranked(listOf("Standard"), UnrankedReason.Unread),
            )
            val heads = reads.parity.obj("clubHead")
            assertEquals(heads.text("read"), Words.ClubOrder.onOrder)
            assertEquals(heads.text("nobodyRead"), Words.ClubOrder.nobody)
        }

    @Test
    fun `the order is read in its own scoring alone`() =
        runTest {
            val order = reads.order()
            val scoring = reads.parity.obj("refused").obj("inScoring")
            reads.run().manifest.formats.forEach { format ->
                val api = requireNotNull(format.id.removeSuffix("-12").replace("-", "_"))
                assertEquals(
                    scoring
                        .getValue(api)
                        .jsonPrimitive.content
                        .toBoolean(),
                    LiveOrder.inScoring(order.answer, format),
                    format.id,
                )
            }
        }

    @Test
    fun `a row the order does not place keeps the run's every row`() =
        runTest {
            val swift = reads.players.first()
            val places = reads.order().places.filterKeys { it != swift.text("id") }
            val club = reads.players.filter { it.text("team") == swift.text("team") }.map { it.text("id") }
            assertNull(LiveOrder.placed(club, { it }, places))
            val pair = reads.players.take(2).map { it.text("id") }
            assertNull(LiveOrder.pair(pair, places, reads.PPR, reads.PPR))
            assertNull(LiveOrder.pair(pair, reads.order().places, "half-ppr-12", reads.PPR))
            assertNotNull(LiveOrder.pair(pair, reads.order().places, reads.PPR, reads.PPR))
        }

    // The Board.

    @Test
    fun `the Board at the order's clock is the order's every row`() =
        runTest {
            val model = reads.board(reads.order())
            assertTrue(model.atClock)
            assertEquals(reads.parity.obj("board").strings("ids"), model.rows.map { it.id })
            assertTrue(model.sections.all { it.band == null })
            assertEquals(basis.text("lead"), model.basis.first())
            assertEquals(basis.text("lead"), model.restLine, "the head follows the basis's clock")
            reads.players.forEach { player ->
                val at = player.obj("board")
                val name = player.text("name")
                val row = requireNotNull(model.rows.firstOrNull { it.id == player.text("id") }) { name }
                assertEquals(at.int("row"), model.rows.indexOf(row), name)
                assertEquals("${player.text("position")} ${at.int("positionRank")}", row.pill, name)
                assertEquals(BoardFigures.projected(at.number("projected")), row.projected, name)
                assertEquals(BoardFigures.signed(at.number("vor")), row.overReplacement, name)
                assertEquals(Heat.of(at.number("vor"), at.int("round")), row.heat, name)
            }
        }

    @Test
    fun `the Board draws the rows the order reaches and says how far one read reaches`() =
        runTest {
            val swift = reads.players.first().text("id")
            val trimmed = StubOrderSearch(rows = { rows -> rows.filter { it.boardId() != swift } })
            val model = reads.board(reads.order(trimmed))
            assertTrue(model.atClock)
            assertEquals(
                reads.parity
                    .obj("board")
                    .strings("ids")
                    .filter { it != swift },
                model.rows.map { it.id },
            )
            assertFalse(model.basis.any { it.startsWith("The first") }, "an answer the order did not cut says no count")
            // A cut answer: the view holds more players than the rows it returned.
            val whole = reads.order()
            val cut = whole.answer.copy(rows = whole.answer.rows.take(SHORT_READ))
            assertTrue(cut.total > cut.rows.size)
            val short = reads.board(OrderAtClock(whole.body, cut, whole.landed))
            val total =
                reads
                    .run()
                    .board.rows.size
            assertEquals(LiveOrderWords.reach(short.rows.size, total), short.basis.last())
            assertFalse(reads.board(reads.order()).basis.any { it.startsWith("The first") }, "a read that reaches every row says no count")
            assertTrue(reads.board(null).restLine?.contains("refreshed") == true)
        }

    @Test
    fun `a position view at the order's clock draws no tiers`() =
        runTest {
            val order = reads.order()
            val model = reads.board(order, BoardPosition.RunningBack)
            assertTrue(model.atClock)
            assertEquals(1, model.sections.size)
            assertTrue(model.sections.all { it.band == null })
            assertTrue(model.rows.all { it.pill.startsWith("RB ") })
            // In the order's order, as the Rankings' RB chip lists them.
            val places = order.places
            val ranks = model.rows.map { requireNotNull(places[it.id]).rank }
            assertEquals(ranks.sorted(), ranks)
            val swift = reads.players.first()
            assertEquals("RB ${swift.obj("order").int("positionRank")}", model.rows.first { it.id == swift.text("id") }.pill)
        }

    @Test
    fun `the Board unread keeps the run's rows with the run's stamp`() {
        val model = reads.board(null)
        assertFalse(model.atClock)
        assertEquals(basis.text("stamp"), model.basis.last())
        reads.players.forEach { player ->
            val run = player.obj("run")
            val row = requireNotNull(model.rows.firstOrNull { it.id == player.text("id") })
            assertEquals("${player.text("position")} ${run.int("positionRank")}", row.pill)
            assertEquals(BoardFigures.projected(run.number("projected")), row.projected)
        }
        assertTrue(model.sections.isNotEmpty())
        assertTrue(reads.board(null, BoardPosition.RunningBack).sections.any { it.band != null }, "the run's tiers stand")
    }

    @Test
    fun `players on a season-long list follow the order's rows with the list's word`() =
        runTest {
            val washington = reads.player("Parker Washington").text("id")
            val order = reads.order(StubOrderSearch(rows = { rows -> rows.filter { it.boardId() != washington } }))
            val read = listing(washington)
            val all = reads.board(order, read = read)
            assertTrue(all.atClock)
            val last = all.rows.last()
            assertEquals(washington, last.id, "the listed player follows the order's rows")
            assertEquals("WR IR", last.pill)
            assertEquals(Words.Box.none, last.projected)
            assertEquals(Words.Box.none, last.overReplacement)
            val receivers = reads.board(order, BoardPosition.Receiver, read)
            assertEquals(Words.Board.heldHead, receivers.sections.last().head)
            assertEquals(
                listOf(washington),
                receivers.sections
                    .last()
                    .rows
                    .map { it.id },
            )
        }

    @Test
    fun `a player the order returns with no points and on IR the run does not list is drawn after the ranked rows`() =
        runTest {
            val swift = reads.players.first().text("id")
            assertFalse(
                reads
                    .run()
                    .designations
                    ?.players
                    .orEmpty()
                    .containsKey(swift),
                "the run's capture does not list him",
            )
            val missing = OneValueFixture.missing(swift)
            assertNull(missing.places[swift], "the order holds his row with no figure")
            assertNotNull(missing.rows[swift])
            val all = reads.board(missing)
            assertTrue(all.atClock)
            assertEquals(
                reads.parity
                    .obj("board")
                    .strings("ids")
                    .toSet(),
                all.rows.map { it.id }.toSet(),
                "every player is drawn",
            )
            val last = all.rows.last()
            assertEquals(swift, last.id, "he follows the order's ranked rows")
            assertEquals("RB ${Words.DesignationRank.injured_reserve}", last.pill)
            assertEquals(Words.Box.none, last.projected)
            assertEquals(Words.Box.none, last.overReplacement)
            assertEquals(Words.DesignationRank.injured_reserve, last.status?.rank)
            assertFalse(all.basis.any { it.startsWith("The first") }, "a whole answer says no count")
            val backs = reads.board(missing, BoardPosition.RunningBack)
            assertEquals(Words.Board.heldHead, backs.sections.last().head)
            assertEquals(
                listOf(swift),
                backs.sections
                    .last()
                    .rows
                    .map { it.id },
            )
            assertFalse(backs.basis.any { it.startsWith("The first") })
        }

    @Test
    fun `a position chip past the share's window reads the order again`() =
        runTest {
            val clock = MovingClock(reads.now)
            val search = StubOrderSearch()
            val vm =
                BoardViewModel(
                    StubRunReads(RunFixture.OneValue),
                    MemoryCache(),
                    clock,
                    reads.zone,
                    inSeason = true,
                    following = false,
                    sessionEnd = SessionEnd {},
                    orders = OrderReader(OrderShare(search, clock)),
                )
            vm.load().join()
            assertEquals(1, search.routes.size)
            clock.at = clock.at.plusSeconds(WITHIN_WINDOW)
            assertNull(vm.choose(BoardPosition.Receiver), "inside the window the held order redraws")
            assertEquals(1, search.routes.size)
            clock.at = reads.now.plusSeconds(PAST_WINDOW)
            val reread = requireNotNull(vm.choose(BoardPosition.RunningBack)) { "past the window the chip reads again" }
            reread.join()
            assertEquals(2, search.routes.size, "a held order 61 s old is read again")
            val model = (vm.state.value as BoardState.Loaded).model
            assertTrue(model.atClock)
            assertTrue(model.rows.all { it.pill.startsWith("RB ") })
        }

    @Test
    fun `the Board's view model draws the run, then the order, and a failed read leaves the run's`() =
        runTest {
            val clock = MovingClock(reads.now)
            val search = StubOrderSearch()
            val vm =
                BoardViewModel(
                    StubRunReads(RunFixture.OneValue),
                    MemoryCache(),
                    clock,
                    reads.zone,
                    inSeason = true,
                    following = false,
                    sessionEnd = SessionEnd {},
                    orders = OrderReader(OrderShare(search, clock)),
                )
            vm.load().join()
            val read = (vm.state.value as BoardState.Loaded).model
            assertTrue(read.atClock)
            assertEquals(basis.text("lead"), read.basis.first())
            search.offline = true
            clock.at = clock.at.plus(OrderShare.WINDOW).plusSeconds(1)
            vm.load().join()
            val unread = (vm.state.value as BoardState.Loaded).model
            assertFalse(unread.atClock, "no order from an earlier read under the run")
            assertEquals(basis.text("stamp"), unread.basis.last())
            assertFalse(unread.basis.contains(basis.text("lead")))
        }

    @Test
    fun `preseason the Board reads no order`() =
        runTest {
            val search = StubOrderSearch()
            val vm =
                BoardViewModel(
                    StubRunReads(RunFixture.OneValue),
                    MemoryCache(),
                    FixedClock(reads.now),
                    reads.zone,
                    inSeason = false,
                    following = false,
                    sessionEnd = SessionEnd {},
                    orders = OrderReader(OrderShare(search, FixedClock(reads.now))),
                )
            vm.load().join()
            assertTrue(search.routes.isEmpty())
            assertFalse((vm.state.value as BoardState.Loaded).model.atClock)
        }

    // The share.

    @Test
    fun `each read is asked once per clock and shared by its screens and the Rankings`() =
        runTest {
            val search = StubOrderSearch()
            val share = OrderShare(search, FixedClock(reads.now))
            val orders = OrderReader(share)
            listOf(async { orders.read() }, async { orders.read() }).awaitAll()
            orders.read(search = "chi")
            orders.read(search = "CHI")
            orders.read()
            val whole = OrderReader.query(null)
            assertEquals(listOf(whole.route, OrderReader.query("chi").route), search.routes)
            // The Rankings' read is its own route through the same share.
            val rankings = OrderQuery.of(null, "", 100)
            share.order(rankings)
            share.order(rankings)
            assertEquals(3, search.routes.size)
            val later = OrderReader(OrderShare(search, FixedClock(reads.now.plus(OrderShare.WINDOW))))
            later.read()
            assertEquals(4, search.routes.size, "an answer stands for its window alone")
        }

    @Test
    fun `the share drops what its window passed and keys a read in any case`() =
        runTest {
            val clock = MovingClock(reads.now)
            val share = OrderShare(StubOrderSearch(), clock)
            val orders = OrderReader(share)
            orders.read(search = "chi")
            orders.read(search = "CHI")
            assertEquals(1, share.kept())
            clock.at = clock.at.plus(OrderShare.WINDOW).plusSeconds(1)
            orders.read()
            assertEquals(1, share.kept(), "the club's read past its window is dropped")
        }

    @Test
    fun `a failed read is no answer and the next read asks again`() =
        runTest {
            val search = StubOrderSearch(offline = true)
            val orders = OrderReader(OrderShare(search, FixedClock(reads.now)))
            assertNull(orders.readOrNull())
            search.offline = false
            assertNotNull(orders.readOrNull())
        }

    /** The stand-in's read with one player on injured reserve, the season-long list. */
    private fun listing(id: String): RunBoardRead {
        val fixture = RunFixture.OneValue
        val designations =
            """{"ok":true,"data":{"run_id":"${fixture.runId}","designations":{"readAt":"2026-10-14T02:03:35.613Z","checkedAt":null,""" +
                """"source":"stand-in","players":{"$id":{"status":"injured_reserve","seasonLong":true,""" +
                """"since":"2026-10-12T19:00:00.000Z"}}}},"error":null,"request_id":"fixture"}"""
        decodeEnvelope<RunDesignationsAnswer>(designations)
        val bodies = fixture.bodies(reads.PPR)
        return RunBoardRead.of(bodies.copy(designations = KeptBody(designations, null)))
    }

    private fun kotlinx.serialization.json.JsonElement.boardId(): String? =
        jsonObject
            .getValue("line")
            .jsonObject
            .getValue("player")
            .jsonObject["board_id"]
            ?.jsonPrimitive
            ?.content

    private companion object {
        const val SHORT_READ = 40
        const val WITHIN_WINDOW = 30L
        const val PAST_WINDOW = 61L
    }
}
