package app.trycommish.core.player

import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.design.Words
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * The player page's view model, held as the iOS one is: the page from the run in the web's order before
 * the season and in season, a held page drawn from an earlier run's copy with that run's stamp or from the
 * board's figures with the held words (never the refused document), a second read costing 304s, the saved
 * page standing offline with its stamp, the league's verb and line with a league, and a slug the run does
 * not name saying so.
 */
class PlayerPageViewModelTest {
    private fun graph(
        run: RunFixture = RunFixture.StandIn,
        held: Map<String, RunFixture?> = emptyMap(),
        offline: Boolean = false,
        cache: Cache = MemoryCache(),
        at: Instant = WeekFixture.week,
        stubs: Pair<StubRunReads, StubPages> = StubRunReads(run, offline) to StubPages(run, held, offline),
    ): PlayerReadsGraph = playerGraph(stubs.first, stubs.second, StubWeeks(at, offline), cache, FixedClock(at))

    private suspend fun loaded(
        slug: String,
        graph: PlayerReadsGraph,
        withLeague: Boolean = false,
    ): Pair<PlayerPageViewModel, PageState.Loaded> {
        val vm = PlayerPageViewModel(slug, graph, if (withLeague) fixtureLeague else null)
        vm.read()
        return vm to assertInstanceOf(PageState.Loaded::class.java, vm.state.value, "${vm.state.value}")
    }

    private fun slugOf(
        id: String,
        run: RunFixture = RunFixture.StandIn,
    ): String = run.page(id).slug

    @Test
    fun `before the season the page draws the facts and the read`() =
        runTest {
            val (_, page) = loaded(slugOf("4431299"), graph())
            val model = page.model
            assertNotNull(model.facts)
            assertEquals("Chicago Bears", model.hero.club)
            assertEquals(6, model.card.tiles.size)
            assertNotNull(model.read)
            assertNotNull(model.tier)
            assertTrue(model.basis.isNotEmpty())
            assertEquals(null, model.leagueLine)
            assertNull(model.verb, "no league, no verb")
        }

    @Test
    fun `in season the facts are not drawn`() =
        runTest {
            val run = RunFixture.Contract
            val id = run.playerIds().first()
            val (_, page) = loaded(slugOf(id, run), graph(run))
            assertNull(page.model.facts)
        }

    @Test
    fun `with a league the page draws its line and pins the verb from his week`() =
        runTest {
            val (_, page) = loaded(slugOf("4431299"), graph(), withLeague = true)
            assertNotNull(page.model.leagueLine)
            assertNotNull(page.model.verb)
        }

    @Test
    fun `a held page draws an earlier run's copy with that run's stamp`() =
        runTest {
            val (_, page) = loaded(slugOf("4431299"), graph(held = mapOf("4431299" to RunFixture.StandIn)))
            assertNotNull(page.model.read)
            assertTrue(page.model.stamp.startsWith(Words.RunStamp.updated), page.model.stamp)
        }

    @Test
    fun `a held page with no copy draws the board's figures and the held words, never the refused page`() =
        runTest {
            val (_, page) = loaded(slugOf("4431299"), graph(held = mapOf("4431299" to null)))
            val model = page.model
            assertNull(model.read)
            assertEquals(Words.HeldPage.log, model.season.none)
            assertEquals(Words.HeldPage.basis, model.season.basis)
            assertTrue(Words.HeldPage.basis in model.basis)
        }

    @Test
    fun `a second read names the kept ETags and costs 304s`() =
        runTest {
            val stubs = StubRunReads(RunFixture.StandIn) to StubPages(RunFixture.StandIn)
            val graph = graph(stubs = stubs)
            val (vm, _) = loaded(slugOf("4431299"), graph)
            stubs.first.answered.clear()
            stubs.second.sent.clear()
            vm.read()
            assertInstanceOf(PageState.Loaded::class.java, vm.state.value)
            assertTrue(stubs.first.answered.all { it == NOT_MODIFIED }, "${stubs.first.answered}")
            assertTrue(stubs.second.sent.all { it.second != null }, "${stubs.second.sent}")
        }

    @Test
    fun `offline the saved page stands with its stamp`() =
        runTest {
            val cache = MemoryCache()
            loaded(slugOf("4431299"), graph(cache = cache))
            val (vm, page) = loaded(slugOf("4431299"), graph(offline = true, cache = cache, at = WeekFixture.week.plusSeconds(HOUR)))
            assertEquals(SavedReason.Offline, page.freshness.saved)
            assertEquals("${AppWords.lastRead} Sat 12:00 pm", vm.stampWords())
        }

    @Test
    fun `a slug the run does not name says nothing lives there`() =
        runTest {
            val vm = PlayerPageViewModel("no-such-player", graph(), null)
            vm.read()
            assertEquals(PageState.Failed(Words.InSeason.notFoundLine), vm.state.value)
        }

    @Test
    fun `with no answer and nothing saved the page says it could not be reached`() =
        runTest {
            val vm = PlayerPageViewModel(slugOf("4431299"), graph(offline = true), null)
            vm.read()
            assertEquals(PageState.Failed(AppWords.cannotLoad), vm.state.value)
        }

    private companion object {
        const val NOT_MODIFIED = 304
        const val HOUR = 3600L
    }
}
