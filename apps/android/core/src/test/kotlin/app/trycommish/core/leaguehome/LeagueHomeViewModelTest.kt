package app.trycommish.core.leaguehome

import app.trycommish.api.Unauthorized
import app.trycommish.core.AppWords
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import java.time.Instant

/** The League tab's view model: the kept page at once, dated and unmarked, then the API's; marked
 * stale only when the refresh fails; with nothing kept, a sentence; a 401 signs the device out. */
@OptIn(ExperimentalCoroutinesApi::class)
class LeagueHomeViewModelTest {
    private val main = StandardTestDispatcher()
    private val clock = FixedClock(Fixtures.sunday)
    private val earlier = Instant.parse("2026-10-18T17:00:00Z")

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    /** What the fake API does: answer from the fixture, fail as a phone with no signal, or 401. */
    private enum class Answer { Fixture, Offline, Unauthorized }

    private class FakeReads(
        private val answer: Answer = Answer.Fixture,
        private val scoreboardFails: Boolean = false,
        private val gate: CompletableDeferred<Unit>? = null,
    ) : LeagueReads {
        private fun <T> respond(body: () -> T): T =
            when (answer) {
                Answer.Fixture -> body()
                Answer.Offline -> throw IOException("Unable to resolve host")
                Answer.Unauthorized -> throw Unauthorized()
            }

        override suspend fun attached(): String {
            gate?.await()
            return respond { Fixtures.attachedBody() }
        }

        override suspend fun sync(leagueId: String): String {
            gate?.await()
            return respond { Fixtures.syncBody() }
        }

        override suspend fun scoreboard(leagueId: String): String =
            respond { if (scoreboardFails) throw IOException("no scoreboard") else Fixtures.scoreboardBody(Fixtures.sunday) }
    }

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private fun warmCache(): MemoryCache =
        MemoryCache().apply {
            write(LeagueHomeKeys.ATTACHED, Cached(Fixtures.attachedBody(), earlier))
            write(LeagueHomeKeys.sync(Fixtures.LEAGUE_ID), Cached(Fixtures.syncBody(), earlier))
            write(LeagueHomeKeys.scoreboard(Fixtures.LEAGUE_ID), Cached(Fixtures.scoreboardBody(Fixtures.sunday), earlier))
        }

    private fun viewModel(
        reads: LeagueReads,
        cache: MemoryCache,
        ends: Ends = Ends(),
    ) = LeagueHomeViewModel(reads, cache, clock, Fixtures.zone, ends)

    @Test
    fun `a fresh answer is shown with the clock's stamp and kept`() =
        runTest(main) {
            val cache = MemoryCache()
            val vm = viewModel(FakeReads(), cache)
            vm.load(Fixtures.LEAGUE_ID)
            advanceUntilIdle()
            val state = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertFalse(state.stale)
            assertEquals(Fixtures.sunday, state.stamp)
            assertEquals(12, state.model.standings.rows.size)
            assertEquals(6, state.model.games.size)
            assertEquals(Fixtures.sunday, cache.read(LeagueHomeKeys.sync(Fixtures.LEAGUE_ID))?.stamp)
        }

    @Test
    fun `the kept page shows at once with its own stamp, unmarked, while the refresh runs`() =
        runTest(main) {
            val gate = CompletableDeferred<Unit>()
            val vm = viewModel(FakeReads(gate = gate), warmCache())
            vm.load(Fixtures.LEAGUE_ID)
            runCurrent()
            val shown = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertFalse(shown.stale)
            assertEquals(earlier, shown.stamp)
            gate.complete(Unit)
            advanceUntilIdle()
            val fresh = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertFalse(fresh.stale)
            assertEquals(Fixtures.sunday, fresh.stamp)
        }

    @Test
    fun `with no network and a warm cache the kept page stays, marked stale once the refresh fails`() =
        runTest(main) {
            val vm = viewModel(FakeReads(Answer.Offline), warmCache())
            vm.load(Fixtures.LEAGUE_ID)
            advanceUntilIdle()
            val state = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertTrue(state.stale)
            assertEquals(earlier, state.stamp)
            assertEquals("McConkey Kong Country", state.model.lineup.team)
        }

    @Test
    fun `with no network and nothing kept the member reads a sentence, never an error code`() =
        runTest(main) {
            val vm = viewModel(FakeReads(Answer.Offline), MemoryCache())
            vm.load(Fixtures.LEAGUE_ID)
            advanceUntilIdle()
            val state = assertInstanceOf(LeagueHomeState.Failed::class.java, vm.state.value)
            assertEquals(AppWords.cannotLoad, state.message)
        }

    @Test
    fun `a cold start with nothing kept shows Loading first`() =
        runTest(main) {
            val gate = CompletableDeferred<Unit>()
            val vm = viewModel(FakeReads(gate = gate), MemoryCache())
            vm.load(Fixtures.LEAGUE_ID)
            runCurrent()
            assertEquals(LeagueHomeState.Loading, vm.state.value)
            gate.complete(Unit)
            advanceUntilIdle()
        }

    @Test
    fun `a scoreboard the API cannot give leaves the rest of the page`() =
        runTest(main) {
            val vm = viewModel(FakeReads(scoreboardFails = true), MemoryCache())
            vm.load(Fixtures.LEAGUE_ID)
            advanceUntilIdle()
            val state = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertTrue(state.model.games.isEmpty())
            assertFalse(state.stale)
        }

    @Test
    fun `a 401 signs the device out, never a stale page`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(FakeReads(Answer.Unauthorized), warmCache(), ends)
            vm.load(Fixtures.LEAGUE_ID)
            advanceUntilIdle()
            assertEquals(LeagueHomeState.SignedOut, vm.state.value)
            assertEquals(1, ends.count)
        }

    @Test
    fun `a 401 on the league list signs the device out too`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(FakeReads(Answer.Unauthorized), MemoryCache(), ends)
            vm.open()
            advanceUntilIdle()
            assertEquals(LeagueHomeState.SignedOut, vm.state.value)
            assertEquals(1, ends.count)
        }

    @Test
    fun `open draws the kept league before the API answers the list`() =
        runTest(main) {
            val gate = CompletableDeferred<Unit>()
            val vm = viewModel(FakeReads(gate = gate), warmCache())
            vm.open()
            runCurrent()
            val shown = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertEquals(earlier, shown.stamp)
            assertInstanceOf(LeagueChoice.Chosen::class.java, vm.choice.value)
            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(Fixtures.sunday, assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value).stamp)
        }

    @Test
    fun `open with no network keeps the kept league, stale`() =
        runTest(main) {
            val vm = viewModel(FakeReads(Answer.Offline), warmCache())
            vm.open()
            advanceUntilIdle()
            assertTrue(assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value).stale)
            assertInstanceOf(LeagueChoice.Chosen::class.java, vm.choice.value)
        }

    @Test
    fun `open with no league attached says where to attach one`() =
        runTest(main) {
            val reads =
                object : LeagueReads {
                    override suspend fun attached() = """{"ok":true,"data":[],"error":null}"""

                    override suspend fun sync(leagueId: String) = error("not read")

                    override suspend fun scoreboard(leagueId: String) = error("not read")
                }
            val vm = viewModel(reads, MemoryCache())
            vm.open()
            advanceUntilIdle()
            assertEquals(LeagueHomeState.Failed(AppWords.noLeague), vm.state.value)
        }
}
