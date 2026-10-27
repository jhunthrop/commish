package app.trycommish.core.liveorder

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.DesignationStatus
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
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
    fun `a player put on IR after the nightly is drawn placed with the list's word, as the API answers him`() =
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
            val listing = OneValueFixture.listing(swift)
            val place = requireNotNull(listing.places[swift]) { "the order places him" }
            assertNull(place.positionRank, "the API keeps his figures and drops his place at his position")
            val all = reads.board(listing)
            assertTrue(all.atClock)
            assertEquals(ids().sorted(), all.rows.map { it.id }.sorted(), "every player is drawn, once")
            val row = all.rows.single { it.id == swift }
            assertEquals("RB ${Words.DesignationRank.injured_reserve}", row.pill, "the list's word, as the Rankings' # cell says it")
            assertEquals(Words.DesignationRank.injured_reserve, row.status?.rank)
            assertEquals(BoardFigures.projected(place.projected), row.projected, "placed, so the order's figures")
            val at = all.rows.indexOf(row)
            assertTrue(
                all.rows
                    .withIndex()
                    .filter { it.value.status == null }
                    .all { it.index < at },
                "after every available player",
            )
            assertFalse(all.basis.any { it.startsWith("The first") }, "a whole answer says no count")
        }

    @Test
    fun `a player the order returns with no figure is drawn after the ranked rows with the order's word`() =
        runTest {
            val swift = reads.players.first().text("id")
            val unvalued = OneValueFixture.unvalued(swift, DesignationStatus.injured_reserve)
            assertNull(unvalued.places[swift], "the order holds his row with no figure")
            assertNotNull(unvalued.rows[swift])
            val all = reads.board(unvalued)
            assertEquals(ids().sorted(), all.rows.map { it.id }.sorted(), "every player is drawn, once")
            val last = all.rows.last()
            assertEquals(swift, last.id, "he follows the order's ranked rows")
            assertEquals("RB ${Words.DesignationRank.injured_reserve}", last.pill)
            assertEquals(Words.Box.none, last.projected)
            assertEquals(Words.Box.none, last.overReplacement)
            assertFalse(all.basis.any { it.startsWith("The first") }, "a whole answer says no count")
            val backs = reads.board(unvalued, BoardPosition.RunningBack)
            assertEquals(Words.Board.heldHead, backs.sections.last().head)
            assertEquals(
                listOf(swift),
                backs.sections
                    .last()
                    .rows
                    .map { it.id },
            )
        }

    @Test
    fun `a row the order returns with no status falls back to the run's word, else to the dash, never under the list's head`() =
        runTest {
            val swift = reads.players.first().text("id")
            val unvalued = OneValueFixture.unvalued(swift, null)
            val out = listing(swift, "out", seasonLong = false)
            assertEquals(
                "RB ${Words.DesignationRank.out}",
                reads
                    .board(unvalued, read = out)
                    .rows
                    .single { it.id == swift }
                    .pill,
            )
            assertEquals(
                "RB ${Words.Box.none}",
                reads
                    .board(unvalued)
                    .rows
                    .single { it.id == swift }
                    .pill,
            )
            val backs = reads.board(unvalued, BoardPosition.RunningBack, out)
            assertTrue(backs.sections.none { section -> section.head == Words.Board.heldHead && section.rows.any { it.id == swift } })
            val tail = backs.sections.last()
            assertNull(tail.head, "a row on no list sits after the order's rows with no head")
            assertEquals(listOf(swift), tail.rows.map { it.id })
        }

    @Test
    fun `the fixture's players with no figure and no status never sit under the list's head`() =
        runTest {
            // James Cook: the shared Sunday order returns him with no figure and no status.
            val order = reads.order()
            val cook = order.answer.rows.single { it.line.player.name == COOK }
            assertNull(cook.restOfSeasonPoints)
            assertNull(cook.line.facts.designation)
            val id = requireNotNull(cook.line.player.boardId)
            val read = withRunRow(id, COOK, cook.line.player.team)
            val backs = reads.board(order, BoardPosition.RunningBack, read)
            assertTrue(backs.sections.none { section -> section.head == Words.Board.heldHead && section.rows.any { it.id == id } })
            val tail = backs.sections.last()
            assertNull(tail.head)
            assertEquals(listOf(id), tail.rows.map { it.id })
            assertEquals("RB ${Words.Box.none}", tail.rows.single().pill)
            val all = reads.board(order, read = read)
            assertEquals(id, all.rows.last().id)
            assertEquals(
                all.rows.size,
                all.rows
                    .map { it.id }
                    .distinct()
                    .size,
                "no player drawn twice",
            )
        }

    @Test
    fun `a board id the order repeats keeps its first row`() =
        runTest {
            val order = reads.order()
            val first = order.answer.rows.first()
            val twin = first.copy(rank = order.answer.rows.size + 1, restOfSeasonPoints = null)
            val rows = LiveOrder.rows(order.answer.copy(rows = order.answer.rows + twin))
            assertEquals(first, rows[first.line.player.boardId])
        }

    @Test
    fun `a position chip reads the order again from the share's window on`() =
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
            clock.at = reads.now.plus(OrderShare.WINDOW)
            val atWindow = requireNotNull(vm.choose(BoardPosition.Receiver)) { "at exactly the window the chip reads again" }
            atWindow.join()
            assertEquals(2, search.routes.size, "a held order 60 s old is read again")
            clock.at = clock.at.plusSeconds(PAST_WINDOW)
            val reread = requireNotNull(vm.choose(BoardPosition.RunningBack)) { "past the window the chip reads again" }
            reread.join()
            assertEquals(3, search.routes.size, "a held order 61 s old is read again")
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

    /** The stand-in's read with one player under `status` in the run's capture, injured reserve (the
     * season-long list) unless named. */
    private fun listing(
        id: String,
        status: String = "injured_reserve",
        seasonLong: Boolean = true,
    ): RunBoardRead {
        val fixture = RunFixture.OneValue
        val designations =
            """{"ok":true,"data":{"run_id":"${fixture.runId}","designations":{"readAt":"2026-10-14T02:03:35.613Z","checkedAt":null,""" +
                """"source":"stand-in","players":{"$id":{"status":"$status","seasonLong":$seasonLong,""" +
                """"since":"2026-10-12T19:00:00.000Z"}}}},"error":null,"request_id":"fixture"}"""
        decodeEnvelope<RunDesignationsAnswer>(designations)
        val bodies = fixture.bodies(reads.PPR)
        return RunBoardRead.of(bodies.copy(designations = KeptBody(designations, null)))
    }

    /** The stand-in's read with one more RB on its board: D'Andre Swift's run row under another id. */
    private fun withRunRow(
        id: String,
        name: String,
        team: String,
    ): RunBoardRead {
        val bodies = RunFixture.OneValue.bodies(reads.PPR)
        val envelope = Json.parseToJsonElement(bodies.board.body).jsonObject
        val data = envelope.getValue("data").jsonObject
        val rows = data.getValue("rows").jsonArray
        val swift =
            rows
                .first {
                    it.jsonObject
                        .getValue("id")
                        .jsonPrimitive.content == reads.players.first().text("id")
                }.jsonObject
        val added = JsonObject(swift + mapOf("id" to JsonPrimitive(id), "name" to JsonPrimitive(name), "team" to JsonPrimitive(team)))
        val board = JsonObject(envelope + ("data" to JsonObject(data + ("rows" to JsonArray(rows + added)))))
        return RunBoardRead.of(bodies.copy(board = KeptBody(board.toString(), null)))
    }

    /** The parity's Board ids: every run row the order places. */
    private fun ids(): List<String> = reads.parity.obj("board").strings("ids")

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
        const val COOK = "James Cook"
    }
}
