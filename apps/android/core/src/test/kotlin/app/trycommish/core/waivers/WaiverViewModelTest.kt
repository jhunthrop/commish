package app.trycommish.core.waivers

import app.trycommish.api.CommishJson
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverRow
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.MovePanel
import app.trycommish.core.start.MoveStep
import app.trycommish.core.start.StartFixtures
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException

/**
 * The Waivers view model, as the iOS one is held: the saved answer then the API's; the verb disabled with
 * the stamp's reason when the answer shown is a saved read (Review Focus 2, over the generated client and
 * a transport that throws); the claim's round trip against a stub over the fixture API's own answers
 * (plan, the bid planned again once it rests, confirm, done, refused and pending); the platform's page
 * with his name copied where the claim is not made here; a row's drop panel and the pair the verb then
 * makes; the position cards as reads of their own, the search and the sortable heads.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WaiverViewModelTest {
    private val main = StandardTestDispatcher()
    private val saturday = StartFixtures.instant(WaiverFixtures.WEEK)

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private fun viewModel(
        reads: WaiverReads,
        host: LeagueHost = LeagueHost.espn,
        cache: MemoryCache = MemoryCache(),
        clock: FixedClock = FixedClock(saturday),
        copies: MutableList<String> = mutableListOf(),
        opened: MutableList<String> = mutableListOf(),
        ends: SessionEnd = Ends(),
    ) = WaiverViewModel(
        reads,
        cache,
        clock,
        Fixtures.zone,
        host,
        copy = {
            copies += it
            true
        },
        openPage = { opened += it },
        sessionEnd = ends,
    )

    private fun stub(league: String) =
        WaiverStub(WaiverFixtures.waivers(league), plan = WaiverFixtures.plan(league), result = WaiverFixtures.made(league))

    private fun loaded(vm: WaiverViewModel): WaiverState.Loaded = assertInstanceOf(WaiverState.Loaded::class.java, vm.ui.value.state)

    private fun foot(vm: WaiverViewModel): List<String> = vm.pin().foot.map { line -> line.joinToString("") { it.text } }

    /** Opens the screen and waits for its read: a generated client's call over a MockEngine finishes on
     * the engine's own thread, so the job is joined as well. */
    private suspend fun TestScope.open(
        vm: WaiverViewModel,
        league: String,
    ) {
        val read = vm.load(league)
        advanceUntilIdle()
        read.join()
    }

    private fun offline() = Transport("http://api.test", MockEngine { throw IOException("Unable to resolve host") }, token = { "t" })

    // Reads.

    @Test
    fun `a fresh read loads, is cached and pins the first card's verb`() =
        runTest(main) {
            val cache = MemoryCache()
            val vm = viewModel(stub(WaiverFixtures.PENDING), cache = cache)
            open(vm, WaiverFixtures.PENDING)
            assertFalse(loaded(vm).stale)
            assertEquals("Two pickups", loaded(vm).model.title)
            assertEquals("Add on ESPN", vm.pin().verb)
            assertTrue(vm.pin().enabled)
            assertEquals(saturday, cache.read(WaiverKeys.waivers(WaiverFixtures.PENDING))?.stamp)
        }

    @Test
    fun `a refused token signs out`() =
        runTest(main) {
            val ends = Ends()
            val refused =
                Transport(
                    "http://api.test",
                    MockEngine {
                        respond(
                            """{"ok":false,"error":{"code":"unauthorized","message":"no"}}""",
                            HttpStatusCode.Unauthorized,
                            json,
                        )
                    },
                    token = { "t" },
                )
            val vm = viewModel(ApiWaiverReads(refused), ends = ends)
            open(vm, WaiverFixtures.PENDING)
            assertEquals(WaiverState.SignedOut, vm.ui.value.state)
            assertEquals(1, ends.count)
        }

    // Review Focus 2: offline never pretends to claim.

    @Test
    fun `a saved answer shown with no signal disables the claim with its stamp`() =
        runTest(main) {
            val cache =
                MemoryCache().apply {
                    write(WaiverKeys.waivers(WaiverFixtures.PENDING), Cached(WaiverFixtures.body(WaiverFixtures.PENDING), saturday))
                }
            val vm = viewModel(ApiWaiverReads(offline()), cache = cache, clock = FixedClock(saturday.plusSeconds(1800)))
            open(vm, WaiverFixtures.PENDING)
            assertTrue(loaded(vm).stale)
            assertEquals("Add on ESPN", vm.pin().verb)
            assertFalse(vm.pin().enabled)
            assertEquals(listOf("Last read Sat 12:00 pm. Pull down to read waivers again before you claim."), foot(vm))
            assertNull(vm.press(WaiverFixtures.PENDING))
            advanceUntilIdle()
            assertEquals(MoveStep.Closed, vm.ui.value.step)
            // A row's own pair is held the same way.
            vm.tapRow(requireNotNull(vm.ui.value.card).key)
            assertFalse(vm.pin().enabled)
        }

    @Test
    fun `a saved answer disables the platform's page too`() =
        runTest(main) {
            val cache =
                MemoryCache().apply {
                    write(WaiverKeys.waivers(WaiverFixtures.FFPC), Cached(WaiverFixtures.body(WaiverFixtures.FFPC), saturday))
                }
            val copies = mutableListOf<String>()
            val vm = viewModel(ApiWaiverReads(offline()), host = LeagueHost.ffpc, cache = cache, copies = copies)
            open(vm, WaiverFixtures.FFPC)
            assertEquals("Open FFPC waivers", vm.pin().verb)
            assertFalse(vm.pin().enabled)
            vm.press(WaiverFixtures.FFPC)
            assertTrue(copies.isEmpty())
        }

    // The claim's round trip.

    @Test
    fun `a claim where the league bids is planned at the least bid, confirmed and pending`() =
        runTest(main) {
            val stub = stub(WaiverFixtures.PENDING)
            val vm = viewModel(stub)
            open(vm, WaiverFixtures.PENDING)
            vm.press(WaiverFixtures.PENDING)
            advanceUntilIdle()
            // The first plan has no bid; it is planned again at the league's least, the bid the member sees.
            assertEquals(listOf(null, 0), stub.planned.map { it.claim?.bid })
            assertEquals(
                "4808766",
                stub.planned
                    .first()
                    .claim
                    ?.add,
            )
            assertEquals(6, stub.planned.first().week)
            val pin = vm.pin()
            assertNull(pin.verb)
            assertEquals(
                "Add Mason Taylor, drop Jaxson Dart, bid \$0. He is on waivers, so ESPN runs the claim on Wednesday.",
                pin.panel?.line,
            )
            assertEquals("Claim on ESPN", pin.panel?.verb)
            assertEquals(true, pin.panel?.verbEnabled)
            assertEquals(BidField("Your bid in waiver dollars, \$0 to \$87, what your team has left", "0", null, editable = true), pin.bid)
            vm.confirm(WaiverFixtures.PENDING)
            advanceUntilIdle()
            assertEquals(listOf("fixture-token"), stub.made.map { it.second })
            assertEquals(
                0,
                stub.made
                    .first()
                    .first.claim
                    ?.bid,
            )
            assertEquals(
                "Claim submitted. ESPN processes it Wed 2:00 am, and your lineup screen will show him once it goes through.",
                vm.pin().panel?.line,
            )
            assertEquals(
                "Open ESPN",
                vm
                    .pin()
                    .panel
                    ?.page
                    ?.text,
            )
            assertEquals("Done", vm.pin().panel?.close)
            assertEquals(2, stub.reads)
            vm.close()
            assertEquals(MoveStep.Closed, vm.ui.value.step)
            assertEquals("Add on ESPN", vm.pin().verb)
        }

    @Test
    fun `a typed bid holds the verb until it rests and is planned, and one the league refuses is said`() =
        runTest(main) {
            val stub = stub(WaiverFixtures.PENDING)
            val vm = viewModel(stub)
            open(vm, WaiverFixtures.PENDING)
            vm.press(WaiverFixtures.PENDING)
            advanceUntilIdle()
            vm.typeBid(WaiverFixtures.PENDING, "12")
            assertEquals(false, vm.pin().panel?.verbEnabled, "the bid typed is not the one planned")
            assertNull(vm.confirm(WaiverFixtures.PENDING))
            assertTrue(stub.made.isEmpty())
            advanceTimeBy(BID_PAUSE_MS - 1)
            runCurrent()
            assertEquals(2, stub.planned.size, "not before the bid rests")
            advanceUntilIdle()
            assertEquals(
                12,
                stub.planned
                    .last()
                    .claim
                    ?.bid,
            )
            assertEquals(true, vm.pin().panel?.verbEnabled)
            vm.typeBid(WaiverFixtures.PENDING, "88")
            assertEquals("ESPN takes bids from \$0 to \$87 in this league.", vm.pin().bid?.problem)
            advanceUntilIdle()
            assertEquals(3, stub.planned.size, "a bid the league refuses is never planned")
            assertEquals(false, vm.pin().panel?.verbEnabled)
        }

    @Test
    fun `a refused claim says the platform's own words`() =
        runTest(main) {
            val vm = viewModel(stub(WaiverFixtures.REFUSED))
            open(vm, WaiverFixtures.REFUSED)
            vm.press(WaiverFixtures.REFUSED)
            advanceUntilIdle()
            assertNull(vm.pin().bid, "the league does not bid")
            vm.confirm(WaiverFixtures.REFUSED)
            advanceUntilIdle()
            val panel = requireNotNull(vm.pin().panel)
            assertEquals("ESPN did not take the claim, so nothing changed there.", panel.line)
            assertEquals("ESPN said: Player 4808766 is not a free agent.", panel.said)
            assertEquals("Open ESPN", panel.page?.text)
            assertNull(panel.verb)
        }

    @Test
    fun `a done claim says so with no page`() =
        runTest(main) {
            val vm = viewModel(stub(WaiverFixtures.DONE))
            open(vm, WaiverFixtures.DONE)
            vm.press(WaiverFixtures.DONE)
            advanceUntilIdle()
            assertEquals(
                "Add Mason Taylor, drop Jaxson Dart, on ESPN now. He is a free agent, so the add is made at once.",
                vm.pin().panel?.line,
            )
            vm.confirm(WaiverFixtures.DONE)
            advanceUntilIdle()
            assertEquals("Done on ESPN. He is on your roster there now.", vm.pin().panel?.line)
            assertNull(vm.pin().panel?.page)
            assertNull(vm.pin().panel?.said)
        }

    @Test
    fun `a claim whose answer never came says check the claims`() =
        runTest(main) {
            val stub = stub(WaiverFixtures.DONE).apply { failsMake = true }
            val vm = viewModel(stub)
            open(vm, WaiverFixtures.DONE)
            vm.press(WaiverFixtures.DONE)
            advanceUntilIdle()
            vm.confirm(WaiverFixtures.DONE)
            advanceUntilIdle()
            assertEquals(
                "We did not hear back, so the claim may have been made. Check your claims on ESPN before you claim again.",
                vm.pin().panel?.line,
            )
            assertEquals(MovePanel.Tone.Problem, vm.pin().panel?.tone)
        }

    @Test
    fun `a 401 on the claim signs out and sends nothing more`() =
        runTest(main) {
            val ends = Ends()
            val stub = stub(WaiverFixtures.DONE).apply { makeError = Unauthorized() }
            val vm = viewModel(stub, ends = ends)
            open(vm, WaiverFixtures.DONE)
            vm.press(WaiverFixtures.DONE)
            advanceUntilIdle()
            vm.confirm(WaiverFixtures.DONE)
            advanceUntilIdle()
            assertEquals(WaiverState.SignedOut, vm.ui.value.state)
            assertEquals(MoveStep.Closed, vm.ui.value.step)
            assertEquals(1, ends.count)
        }

    // The platform's page, the drop panel.

    @Test
    fun `where the claim is not made here his name is copied and the page opened`() =
        runTest(main) {
            val copies = mutableListOf<String>()
            val opened = mutableListOf<String>()
            val stub = WaiverStub(WaiverFixtures.waivers(WaiverFixtures.FFPC))
            val vm = viewModel(stub, host = LeagueHost.ffpc, copies = copies, opened = opened)
            open(vm, WaiverFixtures.FFPC)
            assertEquals(listOf("Sleeper does not take claims from here, so add him on its waiver page."), foot(vm))
            vm.press(WaiverFixtures.FFPC)
            assertEquals(listOf("Mason Taylor"), copies)
            assertEquals(listOf("https://sleeper.com/leagues/1382163311038038016/players"), opened)
            assertEquals(listOf("Copied Taylor. Add him on FFPC's waiver page."), foot(vm))
            assertTrue(stub.planned.isEmpty())
        }

    @Test
    fun `a row's drop panel names the pair the verb claims`() =
        runTest(main) {
            val stub = stub(WaiverFixtures.PENDING)
            val vm = viewModel(stub)
            open(vm, WaiverFixtures.PENDING)
            val screen = loaded(vm).model
            val row = screen.table().gaining.first { !it.named }
            vm.tapRow(row.key)
            assertEquals(
                row.key,
                vm.ui.value.opened
                    ?.key,
            )
            val drops = vm.ui.value.drops
            val second = drops[1]
            assertEquals(screen.pairWords(row.source, drops.first()), vm.pin().pair)
            vm.chooseDrop(second.key)
            assertEquals(screen.pairWords(row.source, second), vm.pin().pair)
            vm.press(WaiverFixtures.PENDING)
            advanceUntilIdle()
            val claim = stub.planned.first().claim
            assertEquals(row.source.add.player.hostId, claim?.add)
            assertEquals(second.key, claim?.drop)
            vm.close()
            vm.tapRow(row.key)
            assertNull(vm.ui.value.opened, "a second tap closes the panel")
        }

    // The chips, the search, the heads.

    /** The FFPC stand-in's page cut to one wide receiver, as the API's first 60 rows leave the rest of a
     * deep pool out, and the WR chip's own read holding every wide receiver (the route's position query). */
    private fun paged(): Pair<WaiverAdvice, WaiverAdvice> {
        val full = WaiverFixtures.waivers(WaiverFixtures.FFPC)
        val receiver = { row: WaiverRow -> row.add.player.position == "WR" }
        val first = full.rows.first(receiver)
        val page = full.copy(rows = full.rows.filter { !receiver(it) || it == first })
        val receivers = full.copy(rows = full.rows.filter(receiver), pickups = full.pickups.filter(receiver))
        return page to receivers
    }

    @Test
    fun `a player past the page's rows is reached by his position's chip and the search`() =
        runTest(main) {
            val (page, receivers) = paged()
            val stub = WaiverStub(page, positions = mapOf(WaiverPosition.WR to receivers))
            val vm = viewModel(stub, host = LeagueHost.ffpc)
            open(vm, WaiverFixtures.FFPC)
            assertFalse(
                vm.ui.value.table.rows
                    .any { it.cells.row.name == "Jahan Dotson" },
            )
            assertEquals(
                listOf("QB", "WR", "TE", "D/ST"),
                vm.ui.value.model
                    ?.positions
                    ?.map { it.word },
            )
            vm.choosePosition(WaiverPosition.WR, WaiverFixtures.FFPC)
            assertTrue(vm.ui.value.reading, "the last rows stand, quieter, while the position is read")
            advanceUntilIdle()
            // The screen opened on the TE Need, read quietly, before the WR card.
            assertEquals(listOf(null, WaiverPosition.TE, WaiverPosition.WR), stub.asked)
            assertFalse(vm.ui.value.reading)
            vm.find("dotson")
            val found = vm.ui.value.table.rows
            assertEquals(listOf("Jahan Dotson"), found.map { it.cells.row.name })
            vm.tapRow(found.first().key)
            assertEquals("Open FFPC waivers", vm.pin().verb)
            // The strip stays the page's: its cards and sum are the API's for every position.
            assertEquals(
                "Two pickups",
                vm.ui.value.model
                    ?.title,
            )
            vm.choosePosition(null, WaiverFixtures.FFPC)
            vm.find("")
            assertEquals(page.rows.size, vm.ui.value.table.rows.size)
        }

    @Test
    fun `only the latest position's answer is kept`() =
        runTest(main) {
            val full = WaiverFixtures.waivers(WaiverFixtures.FFPC)
            val qbs = full.copy(rows = full.rows.filter { it.add.player.position == "QB" })
            val stub = WaiverStub(full, positions = mapOf(WaiverPosition.QB to qbs))
            val vm = viewModel(stub, host = LeagueHost.ffpc)
            open(vm, WaiverFixtures.FFPC)
            vm.choosePosition(WaiverPosition.QB, WaiverFixtures.FFPC)
            vm.choosePosition(null, WaiverFixtures.FFPC)
            advanceUntilIdle()
            assertNull(vm.ui.value.position)
            assertEquals(full.rows.size, vm.ui.value.table.rows.size)
        }

    @Test
    fun `a position that cannot be read says so and the last read stands`() =
        runTest(main) {
            val page = WaiverFixtures.waivers(WaiverFixtures.FFPC)
            val stub = WaiverStub(page).apply { failsPosition = true }
            val vm = viewModel(stub, host = LeagueHost.ffpc)
            open(vm, WaiverFixtures.FFPC)
            vm.choosePosition(WaiverPosition.QB, WaiverFixtures.FFPC)
            advanceUntilIdle()
            assertEquals("These could not be read just now. The last read stands.", vm.ui.value.problem)
            assertFalse(vm.ui.value.reading)
            // The page's own quarterbacks stand.
            assertEquals(page.rows.count { it.add.player.position == "QB" }, vm.ui.value.table.rows.size)
        }

    @Test
    fun `the D-ST chip sends the position as the route's query`() =
        runTest(main) {
            val paths = mutableListOf<String>()
            val engine =
                MockEngine { request ->
                    paths += request.url.encodedPathAndQuery
                    val body =
                        if (request.url.parameters["position"] ==
                            "DEF"
                        ) {
                            WaiverFixtures.defBody()
                        } else {
                            WaiverFixtures.body(WaiverFixtures.FFPC)
                        }
                    respond(body, HttpStatusCode.OK, json)
                }
            val vm = viewModel(ApiWaiverReads(Transport("http://api.test", engine, token = { "t" })), host = LeagueHost.ffpc)
            open(vm, WaiverFixtures.FFPC)
            val narrowing = vm.choosePosition(WaiverPosition.DEF, WaiverFixtures.FFPC)
            advanceUntilIdle()
            narrowing?.join()
            assertEquals(
                listOf(
                    "/leagues/attached/${WaiverFixtures.FFPC}/waivers",
                    // The screen opened on the TE Need, read quietly, before the D/ST card.
                    "/leagues/attached/${WaiverFixtures.FFPC}/waivers?position=TE",
                    "/leagues/attached/${WaiverFixtures.FFPC}/waivers?position=DEF",
                ),
                paths,
            )
            assertTrue(
                vm.ui.value.table.rows
                    .all { it.cells.row.position == "D/ST" },
            )
        }

    @Test
    fun `a head chosen sorts the table and turns around when chosen again`() =
        runTest(main) {
            val vm = viewModel(WaiverStub(WaiverFixtures.waivers(WaiverFixtures.FFPC)), host = LeagueHost.ffpc)
            open(vm, WaiverFixtures.FFPC)
            vm.sortBy(WaiverSortKey.Name)
            assertEquals(WaiverSort(WaiverSortKey.Name, down = false), vm.ui.value.sort)
            val names =
                vm.ui.value.table.gaining
                    .map { it.cells.row.name }
            assertEquals(names.sorted(), names)
            vm.sortBy(WaiverSortKey.Name)
            assertEquals(
                names.sorted().reversed(),
                vm.ui.value.table.gaining
                    .map { it.cells.row.name },
            )
            vm.sortBy(WaiverSortKey.Proj)
            assertEquals(WaiverSort(WaiverSortKey.Proj, down = true), vm.ui.value.sort)
        }

    @Test
    fun `a stash that opens the platform's page is held on a saved read`() =
        runTest(main) {
            val advice = parityAdvice("benchOpen")
            val cache = MemoryCache().apply { write(WaiverKeys.waivers(WaiverFixtures.FFPC), Cached(envelopeOf(advice), saturday)) }
            val copies = mutableListOf<String>()
            val vm = viewModel(ApiWaiverReads(offline()), host = LeagueHost.ffpc, cache = cache, copies = copies)
            open(vm, WaiverFixtures.FFPC)
            val stash =
                vm.ui.value.table.stash
                    .first { it.opensPage }
            vm.tapRow(stash.key)
            assertTrue(copies.isEmpty())
            assertNull(vm.ui.value.openRow)
            // Read fresh, the same tap copies his name and opens the page.
            val live = viewModel(WaiverStub(advice), host = LeagueHost.ffpc, copies = copies)
            open(live, WaiverFixtures.FFPC)
            live.tapRow(stash.key)
            assertEquals(listOf("De'Von Achane"), copies)
        }

    @Test
    fun `the sheet keeps the row's player by the row's key`() =
        runTest(main) {
            val vm = viewModel(WaiverStub(WaiverFixtures.waivers(WaiverFixtures.FFPC)), host = LeagueHost.ffpc)
            open(vm, WaiverFixtures.FFPC)
            val model = loaded(vm).model
            val row = model.table().gaining.first { it.sheetPlayer != null }
            assertEquals(row.key, row.sheetPlayer?.id)
            assertTrue(model.sheetPlayers.any { it.id == row.key })
        }

    private val json = headersOf("Content-Type", "application/json")
}

/** A synthetic answer the parity file carries (the Stash cases), read as the API sends it. */
private fun parityAdvice(name: String): WaiverAdvice {
    val advice =
        CommishJson
            .parseToJsonElement(WaiverFixtures.parity())
            .jsonObject
            .getValue("stashed")
            .jsonObject
            .getValue(name)
            .jsonObject
            .getValue("advice")
    return decodeEnvelope("""{"ok":true,"data":$advice,"error":null}""")
}

/** The Waivers routes as a stub over the fixture API's answers: each read answers the advice (a
 * position's own read where one is given), the plan the fixture's plan with the bid asked for, the make
 * the fixture's outcome (or no answer at all); each call kept. */
internal class WaiverStub(
    var advice: WaiverAdvice,
    var positions: Map<WaiverPosition, WaiverAdvice> = emptyMap(),
    private val plan: HostMovePlan? = null,
    private val result: HostMoveResult? = null,
) : WaiverReads {
    var failsPosition = false
    var failsMake = false
    var makeError: Exception? = null
    var reads = 0
    val asked = mutableListOf<WaiverPosition?>()
    val planned = mutableListOf<HostMoveInput>()
    val made = mutableListOf<Pair<HostMoveInput, String>>()

    override suspend fun waivers(
        leagueId: String,
        position: WaiverPosition?,
    ): String {
        asked += position
        if (position == null) {
            reads++
            return envelopeOf(advice)
        }
        if (failsPosition) throw IOException("no signal")
        return envelopeOf(positions[position] ?: advice)
    }

    override suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan {
        planned += move
        val answer = plan ?: throw IOException("no plan")
        val asked = move.claim?.bid ?: return answer
        return answer.copy(bid = answer.bid?.copy(amount = asked))
    }

    override suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult {
        made += move to confirm
        makeError?.let { throw it }
        if (failsMake) throw IOException("connection lost")
        return result ?: throw IOException("no answer")
    }
}
