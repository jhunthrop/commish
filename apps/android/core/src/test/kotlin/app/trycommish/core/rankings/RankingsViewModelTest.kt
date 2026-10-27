package app.trycommish.core.rankings

import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** The Rankings' view model over the shared answers at the week's clock, as the iOS one's tests: the
 * shell's search opens the order with it; a chip reads its own view, the K and D/ST chips the week; a
 * search on the week filters its rows with no read, on the order reads once the letters rest; Show more
 * asks for a hundred more; with no signal the saved answer shows, stale with its stamp; a chip or search
 * never read that fails keeps what is shown with its chips; the read's query is captured before any wait;
 * a refused token signs out. */
@OptIn(ExperimentalCoroutinesApi::class)
class RankingsViewModelTest {
    private val main = StandardTestDispatcher()
    private val week = StartFixtures.instant(RankingsFixtures.WEEK)

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun rankings(
        reads: RankingsReads,
        query: String = "",
        cache: Cache = MemoryCache(),
        now: java.time.Instant = week,
        sessionEnd: SessionEnd = SessionEnd {},
    ) = RankingsViewModel(reads, cache, FixedClock(now), Fixtures.zone, inSeason = true, query = query, sessionEnd = sessionEnd)

    private fun RankingsViewModel.order(): Pair<RankingsModel, Boolean> {
        val loaded = ui.value.state as RankingsState.Loaded
        return (loaded.content as RankingsContent.Order).model to loaded.stale
    }

    private fun RankingsViewModel.week(): WeekRankingsModel =
        ((ui.value.state as RankingsState.Loaded).content as RankingsContent.Week).model

    @Test
    fun `the Rankings open on our order named for the season`() =
        runTest(main) {
            val reads = StubRankings()
            val vm = rankings(reads)
            vm.load()
            advanceUntilIdle()
            val (model, stale) = vm.order()
            assertEquals("Rankings", vm.name)
            assertEquals("Our rest-of-season order, with week 6's game beside each player", vm.lead())
            assertFalse(stale)
            assertEquals(
                "D'Andre Swift",
                model.rows
                    .first()
                    .player.name,
            )
            assertEquals("121 on NFL rosters today", model.hits)
            assertTrue(vm.ui.value.more)
            assertEquals(listOf(OrderQuery(null, null, RankingsUi.PAGE_ROWS)), reads.queries)
        }

    @Test
    fun `the shell's search opens the order with it and each match keeps its place`() =
        runTest(main) {
            val reads = StubRankings()
            val vm = rankings(reads, query = "wa")
            vm.load()
            advanceUntilIdle()
            val (model, _) = vm.order()
            assertEquals("wa", reads.queries.first().search)
            assertEquals("12 matches", model.hits)
            assertEquals(listOf("8", "10", "20"), model.rows.take(3).map { it.place })
        }

    @Test
    fun `a position chip reads its view and the week's chips read the week`() =
        runTest(main) {
            val reads = StubRankings()
            val vm = rankings(reads)
            vm.load()
            advanceUntilIdle()
            vm.choose(RankingsChip.WR)
            advanceUntilIdle()
            val (receivers, _) = vm.order()
            assertEquals("53 matches", receivers.hits)
            assertEquals(
                "WR",
                receivers.rows
                    .first()
                    .player.pill,
                "a position's pill names his position alone",
            )
            vm.choose(RankingsChip.DEF)
            advanceUntilIdle()
            val defenses = vm.week()
            assertEquals("Week 6 defenses", defenses.heading)
            assertEquals(
                "Titans D/ST",
                defenses.rows
                    .first()
                    .player.name,
            )
            assertNull(vm.lead(), "the week's basis line says the rest")
            assertEquals(listOf(WeekPosition.DEF), reads.weeks)
        }

    @Test
    fun `a search on the week filters its rows with no read`() =
        runTest(main) {
            val reads = StubRankings()
            val vm = rankings(reads)
            vm.choose(RankingsChip.DEF)
            advanceUntilIdle()
            vm.find("ti")
            advanceUntilIdle()
            assertTrue(vm.week().rows.any { it.player.name == "Titans D/ST" })
            assertTrue(vm.week().rows.size < 32)
            assertFalse(vm.ui.value.searchReads)
            assertEquals(1, reads.weeks.size)
            assertTrue(reads.queries.isEmpty())
        }

    @Test
    fun `a search on our order reads once its letters rest`() =
        runTest(main) {
            val reads = StubRankings()
            val vm = rankings(reads)
            vm.load()
            advanceUntilIdle()
            vm.find("w")
            vm.find("wa")
            advanceTimeBy(SEARCH_PAUSE_MS - 1)
            assertEquals(1, reads.queries.size, "no read while the letters are still coming")
            advanceUntilIdle()
            assertEquals(listOf(null, "wa"), reads.queries.map { it.search })
            assertEquals("12 matches", vm.order().first.hits)
        }

    @Test
    fun `Show more asks for a hundred more`() =
        runTest(main) {
            val reads = StubRankings()
            val vm = rankings(reads)
            vm.load()
            advanceUntilIdle()
            vm.showMore()
            advanceUntilIdle()
            assertEquals(200, vm.ui.value.limit)
            assertEquals(200, reads.queries.last().limit)
        }

    @Test
    fun `with no signal the saved order shows stale with its stamp`() =
        runTest(main) {
            val cache = MemoryCache()
            rankings(StubRankings(), cache = cache).load()
            advanceUntilIdle()
            val vm = rankings(StubRankings(offline = true), cache = cache, now = week.plusSeconds(3600))
            vm.load()
            advanceUntilIdle()
            val (model, stale) = vm.order()
            assertTrue(stale)
            assertEquals("Last read Sat 12:00 pm", vm.stampWords())
            assertEquals(100, model.rows.size)
        }

    @Test
    fun `with no signal and nothing saved the screen says so`() =
        runTest(main) {
            val vm = rankings(StubRankings(offline = true))
            vm.load()
            advanceUntilIdle()
            assertEquals(RankingsState.Failed(AppWords.cannotLoad), vm.ui.value.state)
        }

    @Test
    fun `a refused token signs out`() =
        runTest(main) {
            var signedOut = false
            val vm = rankings(StubRankings(refused = true), sessionEnd = { signedOut = true })
            vm.load()
            advanceUntilIdle()
            assertTrue(signedOut)
            assertEquals(RankingsState.SignedOut, vm.ui.value.state)
        }

    /** Review H1: All is shown, then WR has never been read and fails: All's rows stay, stale, with the
     * reason said once over them; the chip goes back to the one its rows were read for, so the chips and
     * the search stay to move on with. */
    @Test
    fun `a chip never read that fails keeps what is shown and its chips`() =
        runTest(main) {
            val vm = rankings(StubRankings(fails = ::failing))
            vm.load()
            advanceUntilIdle()
            vm.choose(RankingsChip.WR)
            advanceUntilIdle()
            val (model, stale) = vm.order()
            assertTrue(stale)
            assertNull(vm.ui.value.chip, "the chip of the rows still shown")
            assertEquals(
                "D'Andre Swift",
                model.rows
                    .first()
                    .player.name,
            )
            assertEquals(AppWords.cannotLoad, vm.ui.value.problem)
            vm.choose(RankingsChip.RB)
            advanceUntilIdle()
            assertEquals(RankingsChip.RB, vm.ui.value.chip, "another chip still reads")
            assertNull(vm.ui.value.problem)
        }

    /** Review H1 on the search: letters whose read fails leave the field as typed and the rows shown. */
    @Test
    fun `a search that fails keeps its letters and the rows shown`() =
        runTest(main) {
            val vm = rankings(StubRankings(fails = ::failing))
            vm.load()
            advanceUntilIdle()
            vm.find("wa")
            advanceUntilIdle()
            val (model, stale) = vm.order()
            assertTrue(stale)
            assertEquals("wa", vm.ui.value.query)
            assertEquals("121 on NFL rosters today", model.hits, "the rows still drawn are the order's")
            assertEquals(AppWords.cannotLoad, vm.ui.value.problem)
        }

    /** Review M1: letters typed while the read is out change neither its request nor the key its answer is
     * saved under. */
    @Test
    fun `a query typed while the read is out is not the one saved`() =
        runTest(main) {
            val reads = StubRankings()
            val cache = TypingCache(MemoryCache())
            val vm = rankings(reads, cache = cache)
            cache.onRead = { vm.find("wa") }
            vm.load()
            advanceTimeBy(1)
            assertEquals(listOf(OrderQuery(null, null, RankingsUi.PAGE_ROWS)), reads.queries)
            assertNotNull(cache.read("/order?limit=100&byes=last"), "saved under the route it was asked for")
            assertNull(cache.read("/order?limit=100&q=wa&byes=last"))
        }

    /** Review M1 (fix round 1): letters typed on the kickers' week while it is read, its saved rows shown,
     * still filter the rows once the fresh answer lands; the read and its key stay the week's. */
    @Test
    fun `a kicker search typed while the week is read holds when the answer lands`() =
        runTest(main) {
            val cache = MemoryCache()
            val first = rankings(StubRankings(), cache = cache)
            first.choose(RankingsChip.K)
            advanceUntilIdle()
            val every = first.week().rows.size
            lateinit var vm: RankingsViewModel
            val typing = TypingWeek(StubRankings()) { vm.find("lo") }
            vm = rankings(typing, cache = cache)
            vm.choose(RankingsChip.K)
            advanceUntilIdle()
            assertEquals("lo", vm.ui.value.query)
            val rows = vm.week().rows
            assertFalse((vm.ui.value.state as RankingsState.Loaded).stale, "the fresh answer landed")
            assertTrue(rows.isNotEmpty() && rows.size < every, "the letters still filter: ${rows.size} of $every")
            assertTrue(rows.all { "lo" in it.player.name.lowercase() || "lo" in it.player.club.lowercase() })
            assertEquals(listOf(WeekPosition.K), typing.weeks)
        }

    /** The week read through a stub, running the test's typing while the read is out. */
    private class TypingWeek(
        private val inner: StubRankings,
        private val typing: () -> Unit,
    ) : RankingsReads by inner {
        val weeks = mutableListOf<WeekPosition>()

        override suspend fun weekOrder(position: WeekPosition): String {
            weeks += position
            typing()
            return inner.weekOrder(position)
        }
    }

    /** The fixture's order failing every read that names WR or a search, as no signal does. */
    private fun failing(query: OrderQuery): Boolean = (query.position != null && query.position != OrderPosition.RB) || query.search != null

    /** A cache that runs a step of the test's own on its first read, as letters typed meanwhile. */
    private class TypingCache(
        private val inner: Cache,
    ) : Cache by inner {
        var onRead: (() -> Unit)? = null

        override fun read(key: String): Cached? {
            onRead?.invoke()
            onRead = null
            return inner.read(key)
        }
    }
}
