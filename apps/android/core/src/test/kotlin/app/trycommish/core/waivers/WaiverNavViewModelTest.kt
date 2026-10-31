package app.trycommish.core.waivers

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverStanding
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * The position cards as the Waivers view model's navigation (WaiverScreen.svelte, Lane 305), as the iOS
 * one is held: the screen opens on the weakest Need and reads it quietly; a card chosen reads its position,
 * All the page's rows; the toggle sets the cards and the list's order together; after a claim the chosen
 * position is read again, and until it lands the kept list never lists a player the fresher roster holds.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WaiverNavViewModelTest {
    private val main = StandardTestDispatcher()
    private val league = WaiverFixtures.PENDING

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(reads: WaiverReads) =
        WaiverViewModel(
            reads,
            MemoryCache(),
            FixedClock(StartFixtures.instant(WaiverFixtures.WEEK)),
            Fixtures.zone,
            LeagueHost.espn,
            copy = { true },
            openPage = {},
            sessionEnd =
                object : SessionEnd {
                    override fun signedOut() = Unit
                },
        )

    private suspend fun TestScope.open(vm: WaiverViewModel) {
        val read = vm.load(league)
        advanceUntilIdle()
        read.join()
    }

    private fun page(): WaiverAdvice = WaiverFixtures.waivers(league)

    private fun tightEnds(advice: WaiverAdvice): WaiverAdvice = WaiverNav.atPosition(advice, "TE")

    @Test
    fun `the screen opens on the weakest Need and reads it quietly`() =
        runTest(main) {
            val page = page()
            val stub = WaiverStub(page, positions = mapOf(WaiverPosition.TE to tightEnds(page)))
            val vm = viewModel(stub)
            open(vm)
            val ui = vm.ui.value
            assertEquals("TE", ui.navKey)
            assertEquals(listOf(null, WaiverPosition.TE), stub.asked)
            assertFalse(ui.reading)
            assertTrue(ui.table.rows.isNotEmpty())
            assertTrue(ui.table.rows.all { it.source.add.player.position == "TE" })
            val compare = ui.compare
            assertEquals("Your TE", compare?.yours)
            assertEquals("Free at TE", compare?.free)
            assertEquals(Words.Waivers.starter, compare?.rows?.firstOrNull()?.role)
            assertEquals(NavLead("TE rank 9 of 12", Words.WaiverPanel.needSays), ui.lead)
            assertEquals(WaiverNav.ALL, ui.nav.first().key)
            assertTrue(ui.nav.first { it.key == "TE" }.pickup)
            // The same answer again reads the position no second time.
            open(vm)
            assertEquals(listOf(null, WaiverPosition.TE, null), stub.asked)
        }

    @Test
    fun `a card chosen reads its position and All the whole page`() =
        runTest(main) {
            val page = page()
            val stub = WaiverStub(page)
            val vm = viewModel(stub)
            open(vm)
            vm.chooseNav("QB", league)
            advanceUntilIdle()
            assertEquals("QB", vm.ui.value.navKey)
            assertEquals(WaiverPosition.QB, stub.asked.last())
            assertEquals(
                "Your QB",
                vm.ui.value.compare
                    ?.yours,
            )
            vm.chooseNav(WaiverNav.ALL, league)
            advanceUntilIdle()
            assertNull(vm.ui.value.position)
            assertNull(vm.ui.value.compare)
            assertEquals(NavLead(Words.WaiverNav.allHead, Words.WaiverNav.allSays), vm.ui.value.lead)
            assertEquals(page.rows.size, vm.ui.value.table.rows.size)
            assertEquals(Words.Waivers.noneFound, vm.ui.value.empty)
        }

    @Test
    fun `the toggle sets the cards and the list's order`() =
        runTest(main) {
            val vm = viewModel(WaiverStub(page()))
            open(vm)
            assertTrue(vm.ui.value.navHasWeek)
            vm.choosePanelMode(PanelMode.Week)
            assertEquals(WaiverSort(WaiverSortKey.Proj, true), vm.ui.value.sort)
            assertTrue(
                vm.ui.value.nav
                    .none { it.need },
                "the need is the rest of the season's",
            )
            assertEquals(
                "rank 12 of 12",
                vm.ui.value.nav
                    .first { it.key == "TE" }
                    .place,
            )
            vm.choosePanelMode(PanelMode.Season)
            assertEquals(WaiverSort.Initial, vm.ui.value.sort)
        }

    @Test
    fun `after a claim the list never lists a player the roster now holds`() =
        runTest(main) {
            val page = page()
            val stub = WaiverStub(page, positions = mapOf(WaiverPosition.TE to tightEnds(page)))
            val vm = viewModel(stub)
            open(vm)
            val taylor = page.pickups.first { it.add.player.position == "TE" }
            val id = taylor.add.player.hostId
            assertTrue(
                vm.ui.value.table.rows
                    .any { it.key == id },
            )
            // Claimed: the page's fresher answer has him on the roster; the TE read fails this time.
            val claimed =
                page.copy(
                    rows = page.rows.filter { it.add.player.hostId != id },
                    roster = page.roster + taylor.add,
                    readAt = page.readAt + "+claimed",
                )
            stub.advice = claimed
            stub.failsPosition = true
            open(vm)
            assertEquals(2, stub.asked.count { it == WaiverPosition.TE })
            assertTrue(
                vm.ui.value.table.rows
                    .none { it.key == id },
            )
            assertNull(vm.ui.value.problem, "a position's own list stands, saying nothing")
            // Read again, the position's own read lands.
            stub.failsPosition = false
            stub.positions = mapOf(WaiverPosition.TE to tightEnds(claimed))
            open(vm)
            assertEquals(3, stub.asked.count { it == WaiverPosition.TE })
            assertTrue(
                vm.ui.value.table.rows
                    .none { it.key == id },
            )
        }

    @Test
    fun `a failed first read keeps the page's rows and says so`() =
        runTest(main) {
            val page = page()
            val stub = WaiverStub(page).apply { failsPosition = true }
            val vm = viewModel(stub)
            open(vm)
            assertEquals(WaiverNav.firstRead("TE"), vm.ui.value.problem)
            val here =
                WaiverNav
                    .atPosition(page, "TE")
                    .rows
                    .map { WaiverRows.key(it) }
                    .toSet()
            assertTrue(here.isNotEmpty())
            assertEquals(
                here,
                vm.ui.value.table.rows
                    .map { it.key }
                    .toSet(),
            )
        }

    /** The page with RB the weakest Need in place of TE (a saved answer from before the league moved). */
    private fun runningBacksNeed(page: WaiverAdvice): WaiverAdvice =
        page.copy(
            positions =
                page.positions.orEmpty().map { card ->
                    val key = card.position.value
                    card.copy(
                        need = key == "RB" || key == "QB",
                        restOfSeason = if (key == "RB") WaiverStanding(11, 400.0, 500.0) else card.restOfSeason,
                    )
                },
        )

    private fun warm(
        saved: WaiverAdvice,
        reads: WaiverReads,
    ): WaiverViewModel {
        val cache = MemoryCache()
        cache.write(WaiverKeys.waivers(league), Cached(envelopeOf(saved), StartFixtures.instant(WaiverFixtures.WEEK)))
        return WaiverViewModel(
            reads,
            cache,
            FixedClock(StartFixtures.instant(WaiverFixtures.WEEK)),
            Fixtures.zone,
            LeagueHost.espn,
            copy = { true },
            openPage = {},
            sessionEnd =
                object : SessionEnd {
                    override fun signedOut() = Unit
                },
        )
    }

    @Test
    fun `a warm start opens on the fresh answer's Need, not the saved one's`() =
        runTest(main) {
            val page = page()
            val saved = runningBacksNeed(page)
            assertEquals("RB", WaiverNav.opening(saved))
            val vm = warm(saved, WaiverStub(page, positions = mapOf(WaiverPosition.TE to tightEnds(page))))
            open(vm)
            assertEquals("TE", vm.ui.value.navKey)
            assertTrue(
                vm.ui.value.table.rows
                    .all { it.source.add.player.position == "TE" },
            )
        }

    @Test
    fun `a card the member chose stands when the fresh answer lands`() =
        runTest(main) {
            val page = page()
            val stub = WaiverStub(page).apply { failsPage = true }
            val vm = warm(runningBacksNeed(page), stub)
            open(vm)
            assertEquals("RB", vm.ui.value.navKey, "the saved answer opens on its own Need")
            vm.chooseNav("QB", league)
            advanceUntilIdle()
            stub.failsPage = false
            open(vm)
            assertEquals("QB", vm.ui.value.navKey, "the fresh answer never moves a card the member chose")
        }

    @Test
    fun `the opening is the weakest Need, the first on a tie`() {
        val page = page()

        fun withRanks(
            quarterbacks: Int,
            tightEnds: Int,
        ) = page.copy(
            positions =
                page.positions.orEmpty().map { card ->
                    when (card.position.value) {
                        "QB" -> card.copy(need = true, restOfSeason = WaiverStanding(quarterbacks, 248.0, 264.0))
                        "TE" -> card.copy(need = true, restOfSeason = WaiverStanding(tightEnds, 141.0, 155.0))
                        else -> card
                    }
                },
        )
        // A second Need with a weaker rank wins over the first.
        assertEquals("TE", WaiverNav.opening(withRanks(8, 9)))
        // On a tie, the first card in the panel's order wins.
        assertEquals("QB", WaiverNav.opening(withRanks(8, 8)))
    }
}
