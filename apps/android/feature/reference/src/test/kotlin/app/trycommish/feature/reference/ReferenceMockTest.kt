package app.trycommish.feature.reference

import app.trycommish.core.reference.CompareOutcome
import app.trycommish.core.reference.CompareSlot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Test
import java.io.File

/** The mock shows the states it names (as the iOS snapshot tests check theirs), and every committed
 * reference is there and small enough to keep. */
@OptIn(ExperimentalCoroutinesApi::class)
class ReferenceMockTest {
    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun reads(scene: ReferenceScene) = SceneReads(scene, scheduler)

    @Test
    fun theTopOfAdpCarriesAGapRow() {
        val model = reads(ReferenceScene.AdpTop).adp().model()
        assertTrue(model.gap)
        assertTrue(model.rows.take(ADP_ROWS).any { it.row.gapTone != null })
        assertEquals(listOf("ADP", "Player", "Projected", "Over repl", "Gap"), model.heads)
    }

    @Test
    fun inSeasonAdpShowsTheRunsThreeFormatsAndNoGap() {
        val model = reads(ReferenceScene.AdpInSeason).adp().model()
        assertEquals(3, model.formats.size)
        assertTrue(!model.gap)
    }

    @Test
    fun theStaleSceneSaysWhyItsScreenShows() {
        val vm = reads(ReferenceScene.Stale).adp()
        assertEquals("You're offline, so this is the last board this device saved, updated Oct 21.", vm.staleWords())
    }

    @Test
    fun compareTwoCallsThePairAndTheAbsentSceneSaysTheWebsWords() {
        val two = reads(ReferenceScene.CompareTwo).compare().model()
        assertTrue(two.outcome is CompareOutcome.Table)
        val absent = reads(ReferenceScene.CompareAbsent).compare().model()
        assertTrue(absent.slots[0] is CompareSlot.Picked)
        assertEquals(CompareSlot.Missing, absent.slots[1])
    }

    @Test
    fun theClubSceneIsCincinnatiWithItsPair() {
        val model = reads(ReferenceScene.Club).club().model()
        assertEquals("Cincinnati Bengals", model.name)
        assertTrue(model.compare != null)
        assertTrue(
            reads(ReferenceScene.Clubs)
                .clubs()
                .model()
                .clubs.size == 32,
        )
    }

    @Test
    fun theScheduleSetsBackThePlayedWeeks() {
        val grid = reads(ReferenceScene.Schedule).schedule().model().grid
        assertEquals(5, grid.played)
        assertTrue(
            grid.rows
                .first()
                .cells
                .first()
                .played,
        )
    }

    @Test
    fun theScheduleOpensOnTheRunsCurrentWeekWithItsStatesAndItsRead() {
        val grid = reads(ReferenceScene.Schedule).schedule().model().grid
        assertEquals(6, grid.current)
        assertEquals("Week 6's games as of Wed Oct 21, 7:00 am Central.", grid.asOf)
        val states = grid.rows.flatMap { it.cells }.filter { it.state != null }
        assertTrue(states.isNotEmpty() && states.all { it.week == 6 })
    }

    @Test
    fun theInSeasonClubSaysItsPlayedByeByNothingAndTheWeeksState() {
        val model = reads(ReferenceScene.ClubInSeason).club().model()
        assertEquals("KC", model.meta)
        assertEquals("On our PPR board", model.boardHead)
        assertEquals("Kicked off", model.games.single { it.week == 6 }.state)
        assertTrue(model.asOf != null)
    }

    @Test
    fun theByeRowSaysAheadAndPlayedAsTheBoardDoes() {
        fun bye(scene: ReferenceScene): List<String>? =
            (reads(scene).compare().model().outcome as? CompareOutcome.Table)
                ?.table
                ?.rows
                ?.singleOrNull { it.label == "Bye" }
                ?.cells
                ?.map { it.text }
        assertEquals(setOf("7", "11"), bye(ReferenceScene.CompareByeAhead)?.toSet())
        assertEquals(setOf("", "11"), bye(ReferenceScene.CompareByePlayed)?.toSet())
    }

    @Test
    fun everyReferenceIsThereAndSmallEnoughToKeep() {
        // The record job draws the references in this same task, so it checks them on the run after.
        assumeFalse(System.getProperty("paparazzi.test.record") == "true")
        val folder = File("src/test/snapshots/images")
        val images = requireNotNull(folder.listFiles()) { "no references at ${folder.absolutePath}" }
        assertEquals(REFERENCES, images.count { it.name.contains("_reference-") })
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        /** Eleven scenes, two themes, two phones. */
        const val REFERENCES = 44
        const val MAX_BYTES = 300 * 1024
    }
}
