package app.trycommish.core.waivers

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverPositionFree
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.MoveStep
import app.trycommish.core.start.StartFixtures
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
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * The position panel's controls on the Waivers view model, as the iOS ones are held: the toggle and a
 * card opened and closed, and a free agent's Add through the screen's one verb with the advice's drop
 * (the claim planned where it is made here, else his name copied and the platform's page opened), as
 * WaiverScreen.svelte addFromPanel.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WaiverPanelViewModelTest {
    private val main = StandardTestDispatcher()
    private val saturday = StartFixtures.instant(WaiverFixtures.WEEK)

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(
        reads: WaiverReads,
        copies: MutableList<String> = mutableListOf(),
    ) = WaiverViewModel(
        reads,
        MemoryCache(),
        FixedClock(saturday),
        Fixtures.zone,
        LeagueHost.espn,
        copy = {
            copies += it
            true
        },
        openPage = {},
        sessionEnd =
            object : SessionEnd {
                override fun signedOut() = Unit
            },
    )

    private fun stub(advice: WaiverAdvice = WaiverFixtures.waivers(WaiverFixtures.PENDING)) =
        WaiverStub(advice, plan = WaiverFixtures.plan(WaiverFixtures.PENDING), result = WaiverFixtures.made(WaiverFixtures.PENDING))

    private suspend fun TestScope.open(vm: WaiverViewModel) {
        val read = vm.load(WaiverFixtures.PENDING)
        advanceUntilIdle()
        read.join()
    }

    @Test
    fun `the toggle and a card open and close`() =
        runTest(main) {
            val vm = viewModel(stub())
            open(vm)
            val ui = vm.ui.value
            assertEquals(PanelMode.Season, ui.panelMode)
            assertTrue(ui.panelHasWeek)
            val first = ui.panel.first()
            assertNull(ui.openedCard)
            vm.toggleCard(first.key)
            assertEquals(
                first.key,
                vm.ui.value.openedCard
                    ?.key,
            )
            vm.choosePanelMode(PanelMode.Week)
            assertEquals(
                first.key,
                vm.ui.value.openedCard
                    ?.key,
                "the open card stays open across the toggle",
            )
            assertTrue(
                vm.ui.value.panel
                    .none { it.need },
                "the need is the rest of the season's",
            )
            vm.toggleCard(first.key)
            assertNull(vm.ui.value.openedCard)
        }

    @Test
    fun `an add made here is claimed with the advice's drop`() =
        runTest(main) {
            // The strip's first pickup listed as a card's one free agent, so his Add is a claim made here
            // (the fixture's own free agents carry board ids alone).
            val base = WaiverFixtures.waivers(WaiverFixtures.PENDING)
            val pickup = base.pickups.first()
            val cards = base.positions.orEmpty()
            val advice =
                base.copy(
                    positions =
                        listOf(cards.first().copy(available = listOf(WaiverPositionFree(pickup, 100.0)))) + cards.drop(1),
                )
            val stub = stub(advice)
            val vm = viewModel(stub)
            open(vm)
            val model = requireNotNull(vm.ui.value.model)
            val entry =
                vm.ui.value.panel
                    .first()
                    .free
                    .first()
            assertEquals(pickup, entry.pool?.source)
            assertEquals("Add on ESPN", model.panelVerb(pickup))
            vm.addFromPanel(pickup, WaiverFixtures.PENDING)
            advanceUntilIdle()
            val claim = stub.planned.first().claim
            assertEquals(pickup.add.player.hostId, claim?.add)
            assertEquals(
                model
                    .panelPair(pickup)
                    .drop
                    ?.player
                    ?.hostId,
                claim?.drop,
            )
            assertNotEquals(MoveStep.Closed, vm.ui.value.step)
        }

    @Test
    fun `an add not made here copies his name for the platform's page`() =
        runTest(main) {
            val copies = mutableListOf<String>()
            val stub = stub()
            val vm = viewModel(stub, copies)
            open(vm)
            val source =
                requireNotNull(
                    vm.ui.value.panel
                        .flatMap { it.free }
                        .first()
                        .pool,
                ).source
            vm.addFromPanel(source, WaiverFixtures.PENDING)
            advanceUntilIdle()
            assertEquals(listOf(source.add.player.name), copies)
            assertTrue(stub.planned.isEmpty())
            assertTrue(
                vm
                    .pin()
                    .foot
                    .first()
                    .first()
                    .text
                    .startsWith("Copied"),
            )
        }

    @Test
    fun `an answer without the panel draws none`() =
        runTest(main) {
            val vm = viewModel(stub(WaiverFixtures.waivers(WaiverFixtures.PENDING).copy(positions = null)))
            open(vm)
            assertTrue(
                vm.ui.value.panel
                    .isEmpty(),
            )
            assertFalse(vm.ui.value.panelHasWeek)
        }
}
