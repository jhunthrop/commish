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
    fun everyReferenceIsThereAndSmallEnoughToKeep() {
        // The record job draws the references in this same task, so it checks them on the run after.
        assumeFalse(System.getProperty("paparazzi.test.record") == "true")
        val folder = File("src/test/snapshots/images")
        val images = requireNotNull(folder.listFiles()) { "no references at ${folder.absolutePath}" }
        assertEquals(REFERENCES, images.count { it.name.contains("_reference-") })
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        /** Eight scenes, two themes, two phones. */
        const val REFERENCES = 32
        const val MAX_BYTES = 300 * 1024
    }
}
