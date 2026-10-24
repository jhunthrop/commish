package app.trycommish.core.leaguehome

import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import java.time.Instant

/** The League home's view model: the cache shown at once and dated, then the API's answer; with no
 * network the last answer stays on screen, never a blank page; with nothing cached a sentence. */
@OptIn(ExperimentalCoroutinesApi::class)
class LeagueHomeViewModelTest {
    private val clock = FixedClock(Fixtures.sunday)
    private val earlier = Instant.parse("2026-10-18T17:00:00Z")

    /** The API as the fixture answers it, or failing as a phone with no signal does. */
    private class FakeReads(
        private val fail: Boolean = false,
        private val scoreboardFails: Boolean = false,
        private val gate: CompletableDeferred<Unit>? = null,
    ) : LeagueReads {
        var calls = 0

        override suspend fun attached(): String = Fixtures.attachedBody()

        override suspend fun sync(leagueId: String): String {
            calls++
            gate?.await()
            if (fail) throw IOException("Unable to resolve host")
            return Fixtures.syncBody()
        }

        override suspend fun scoreboard(leagueId: String): String {
            if (fail || scoreboardFails) throw IOException("Unable to resolve host")
            return Fixtures.scoreboardBody(Fixtures.sunday)
        }
    }

    private fun warmCache(): MemoryCache =
        MemoryCache().apply {
            write(LeagueHomeKeys.sync(Fixtures.LEAGUE_ID), Cached(Fixtures.syncBody(), earlier))
            write(LeagueHomeKeys.scoreboard(Fixtures.LEAGUE_ID), Cached(Fixtures.scoreboardBody(Fixtures.sunday), earlier))
        }

    private fun viewModel(
        reads: LeagueReads,
        cache: MemoryCache,
    ) = LeagueHomeViewModel(reads, cache, clock, Fixtures.zone)

    @Test
    fun `a fresh answer is shown with the clock's stamp and cached`() =
        runTest {
            val cache = MemoryCache()
            val vm = viewModel(FakeReads(), cache)
            vm.load(Fixtures.LEAGUE_ID)
            val state = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertFalse(state.stale)
            assertEquals(Fixtures.sunday, state.stamp)
            assertEquals(12, state.model.standings.rows.size)
            assertEquals(6, state.model.games.size)
            assertEquals(Fixtures.sunday, cache.read(LeagueHomeKeys.sync(Fixtures.LEAGUE_ID))?.stamp)
        }

    @Test
    fun `with no network and a warm cache the last League home stays, dated and stale`() =
        runTest {
            val vm = viewModel(FakeReads(fail = true), warmCache())
            vm.load(Fixtures.LEAGUE_ID)
            val state = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertTrue(state.stale)
            assertEquals(earlier, state.stamp)
            assertEquals("McConkey Kong Country", state.model.lineup.team)
        }

    @Test
    fun `with no network and nothing cached the member reads a sentence, never an error code`() =
        runTest {
            val vm = viewModel(FakeReads(fail = true), MemoryCache())
            vm.load(Fixtures.LEAGUE_ID)
            val state = assertInstanceOf(LeagueHomeState.Failed::class.java, vm.state.value)
            assertEquals(LeagueHomeWords.cannotLoad, state.message)
            assertFalse(state.message.contains("host", ignoreCase = true))
        }

    @Test
    fun `the cached answer shows at once while the API is still answering`() =
        runTest {
            val gate = CompletableDeferred<Unit>()
            val vm = viewModel(FakeReads(gate = gate), warmCache())
            val job = launch { vm.load(Fixtures.LEAGUE_ID) }
            runCurrent()
            val shown = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertTrue(shown.stale)
            gate.complete(Unit)
            job.join()
            val fresh = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertFalse(fresh.stale)
            assertEquals(Fixtures.sunday, fresh.stamp)
        }

    @Test
    fun `a cold start with nothing cached shows Loading first`() =
        runTest {
            val gate = CompletableDeferred<Unit>()
            val vm = viewModel(FakeReads(gate = gate), MemoryCache())
            val job = launch { vm.load(Fixtures.LEAGUE_ID) }
            runCurrent()
            assertEquals(LeagueHomeState.Loading, vm.state.value)
            gate.complete(Unit)
            job.join()
        }

    @Test
    fun `a scoreboard the API cannot give leaves the rest of the page`() =
        runTest {
            val vm = viewModel(FakeReads(scoreboardFails = true), MemoryCache())
            vm.load(Fixtures.LEAGUE_ID)
            val state = assertInstanceOf(LeagueHomeState.Loaded::class.java, vm.state.value)
            assertTrue(state.model.games.isEmpty())
            assertFalse(state.stale)
        }
}
