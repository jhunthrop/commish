package app.trycommish.core.matchup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.core.Clock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import java.time.Instant

/**
 * The Matchup's view model, as the iOS one is held: the saved week at once, then the API's; the poll
 * reads at once when visible and then every minute on the test scheduler's clock, stops when hidden,
 * runs once when visible is said twice, and stops when the view model is cleared with its screen; a
 * failed poll keeps the week with its stamp, its live read cell aged to the clock; a 401 signs out and
 * stops; the box the API stands without draws the league read alone.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MatchupViewModelTest {
    private val main = StandardTestDispatcher()
    private val league = Fixtures.LEAGUE_ID
    private val sunday = StartFixtures.instant(MatchupFixtures.SUNDAY)

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    /** The API at one clock's answers, counting each read; a dropped signal fails every read after. */
    private class Stub(
        clock: String,
    ) : MatchupReads {
        var syncBody = MatchupFixtures.syncBody(clock)
        var boxBody: String? = MatchupFixtures.boxBody(clock)
        var reads = 0
        var signal = true
        var refused = false

        override suspend fun sync(leagueId: String): String {
            reads++
            if (refused) throw Unauthorized()
            if (!signal) throw IOException("no signal")
            return syncBody
        }

        override suspend fun matchup(
            leagueId: String,
            roster: Int?,
        ): String? {
            if (!signal) throw IOException("no signal")
            return boxBody
        }

        override suspend fun scoreboard(leagueId: String): String = error("the member's game reads no scoreboard")
    }

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private class MovingClock(
        var now: Instant,
    ) : Clock {
        override fun now(): Instant = now
    }

    private fun viewModel(
        reads: MatchupReads,
        clock: Clock = MovingClock(sunday),
        cache: MemoryCache = MemoryCache(),
        ends: SessionEnd = Ends(),
    ) = MatchupViewModel(reads, cache, clock, Fixtures.zone, ends)

    private fun loaded(vm: MatchupViewModel): MatchupState.Loaded = assertInstanceOf(MatchupState.Loaded::class.java, vm.state.value)

    private fun week(vm: MatchupViewModel): MatchupWeek = assertInstanceOf(MatchupModel.Week::class.java, loaded(vm).model).week

    private fun TestScope.minutes(count: Int) {
        advanceTimeBy(count * MatchupViewModel.POLL_MS)
        runCurrent()
    }

    @Test
    fun `the poll runs at the web's cadence, once a minute`() {
        assertEquals(60_000L, MatchupViewModel.POLL_MS)
    }

    @Test
    fun `visible reads at once and then every minute`() =
        runTest(main) {
            val stub = Stub(MatchupFixtures.SUNDAY)
            val vm = viewModel(stub)
            vm.setVisible(true, league)
            runCurrent()
            assertEquals(1, stub.reads)
            assertEquals("39.1", week(vm).bug.mine.big)
            advanceTimeBy(MatchupViewModel.POLL_MS - 1)
            runCurrent()
            assertEquals(1, stub.reads)
            minutes(1)
            assertEquals(2, stub.reads)
            minutes(2)
            assertEquals(4, stub.reads)
            vm.setVisible(false, league)
        }

    @Test
    fun `hidden stops the poll, nothing is read in the background`() =
        runTest(main) {
            val stub = Stub(MatchupFixtures.SUNDAY)
            val vm = viewModel(stub)
            vm.setVisible(true, league)
            runCurrent()
            vm.setVisible(false, league)
            assertFalse(vm.polling)
            minutes(5)
            assertEquals(1, stub.reads)
            vm.setVisible(true, league)
            runCurrent()
            assertEquals(2, stub.reads)
            vm.setVisible(false, league)
        }

    @Test
    fun `visible said twice runs one poll`() =
        runTest(main) {
            val stub = Stub(MatchupFixtures.SUNDAY)
            val vm = viewModel(stub)
            vm.setVisible(true, league)
            vm.setVisible(true, league)
            runCurrent()
            minutes(1)
            assertEquals(2, stub.reads)
            vm.setVisible(false, league)
        }

    @Test
    fun `a view model cleared with its screen reads no more`() =
        runTest(main) {
            val stub = Stub(MatchupFixtures.SUNDAY)
            val store = ViewModelStore()
            val factory =
                object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T = viewModel(stub) as T
                }
            val vm = ViewModelProvider(store, factory)[MatchupViewModel::class.java]
            vm.setVisible(true, league)
            runCurrent()
            assertEquals(1, stub.reads)
            // Nothing says hidden: the screen is torn down and its store cleared (a league switched, a
            // tab the bar no longer shows).
            store.clear()
            minutes(5)
            assertEquals(1, stub.reads)
            assertFalse(vm.polling)
        }

    @Test
    fun `the saved week shows at once, dated, until the API answers`() =
        runTest(main) {
            val cache = MemoryCache()
            val first = viewModel(Stub(MatchupFixtures.SUNDAY), cache = cache)
            first.load(league)
            runCurrent()
            val offline = Stub(MatchupFixtures.SUNDAY).apply { signal = false }
            val later = viewModel(offline, MovingClock(sunday.plusSeconds(600)), cache)
            later.load(league)
            runCurrent()
            assertTrue(loaded(later).stale)
            assertEquals("Last read Sun 1:56 pm", later.stampWords())
            assertEquals("39.1", week(later).bug.mine.big)
        }

    @Test
    fun `a failed poll keeps the week with its stamp and ages its read cell, the next good read clears it`() =
        runTest(main) {
            val stub = Stub(MatchupFixtures.SUNDAY)
            val clock = MovingClock(sunday)
            val vm = viewModel(stub, clock)
            vm.setVisible(true, league)
            runCurrent()
            assertEquals("FFPC 4 min ago", week(vm).bug.read)
            assertNull(vm.stampWords())
            stub.signal = false
            clock.now = sunday.plusSeconds(600)
            minutes(1)
            assertTrue(loaded(vm).stale)
            assertEquals("Last read Sun 1:56 pm", vm.stampWords())
            assertEquals("FFPC 14 min ago", week(vm).bug.read)
            assertEquals("39.1", week(vm).bug.mine.big)
            stub.signal = true
            minutes(1)
            assertFalse(loaded(vm).stale)
            assertNull(vm.stampWords())
            vm.setVisible(false, league)
        }

    @Test
    fun `a refused token signs out and stops the poll`() =
        runTest(main) {
            val stub = Stub(MatchupFixtures.SUNDAY).apply { refused = true }
            val ends = Ends()
            val vm = viewModel(stub, ends = ends)
            vm.setVisible(true, league)
            runCurrent()
            assertEquals(MatchupState.SignedOut, vm.state.value)
            assertEquals(1, ends.count)
            assertFalse(vm.polling)
            minutes(3)
            assertEquals(1, stub.reads)
        }

    @Test
    fun `with nothing kept and no signal the screen says so`() =
        runTest(main) {
            val vm = viewModel(Stub(MatchupFixtures.SUNDAY).apply { signal = false })
            vm.load(league)
            runCurrent()
            assertInstanceOf(MatchupState.Failed::class.java, vm.state.value)
        }

    @Test
    fun `a box the API stands without draws the league read's starters`() =
        runTest(main) {
            val engine =
                MockEngine { request ->
                    val path = request.url.encodedPath
                    if (path.endsWith("/matchup")) {
                        respond("""{"ok":false,"error":{"code":"no_week","message":"none"}}""", HttpStatusCode.Conflict, json)
                    } else {
                        respond(MatchupFixtures.syncBody(MatchupFixtures.SUNDAY), HttpStatusCode.OK, json)
                    }
                }
            val vm = viewModel(ApiMatchupReads(Transport("http://api.test", engine, token = { "t" })))
            // The client answers on its own thread: wait for the read itself.
            vm.load(league).join()
            val week = week(vm)
            assertFalse(loaded(vm).stale)
            assertEquals("--", week.bug.mine.big)
            assertTrue(
                week.boxes
                    .first()
                    .starters
                    .isNotEmpty(),
            )
            assertTrue(
                week.boxes
                    .first()
                    .bench
                    .isEmpty(),
            )
        }

    private val json = headersOf(HttpHeaders.ContentType, "application/json")
}
