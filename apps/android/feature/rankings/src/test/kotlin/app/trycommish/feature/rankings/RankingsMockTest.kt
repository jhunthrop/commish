package app.trycommish.feature.rankings

import app.trycommish.core.AppWords
import app.trycommish.core.rankings.RankingsContent
import app.trycommish.core.rankings.RankingsState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Test
import java.io.File

/** The mock shows the states it names, and every committed reference is small enough to keep. */
@OptIn(ExperimentalCoroutinesApi::class)
class RankingsMockTest {
    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun content(scene: RankingsSnapshotTest.Scene) = (viewModelAt(scene, scheduler).ui.value.state as RankingsState.Loaded).content

    @Test
    fun theMockShowsTheStatesItNames() {
        val top = content(RankingsSnapshotTest.Scene.Top) as RankingsContent.Order
        assertEquals("121 on NFL rosters today", top.model.hits)
        val position = content(RankingsSnapshotTest.Scene.Position) as RankingsContent.Order
        assertEquals("53 matches", position.model.hits)
        val kicker = content(RankingsSnapshotTest.Scene.Kicker) as RankingsContent.Week
        assertEquals("Week 6 kickers", kicker.model.heading)
        val search = content(RankingsSnapshotTest.Scene.Search) as RankingsContent.Order
        assertEquals("12 matches", search.model.hits)
        assertEquals("Last read Sat 12:00 pm", viewModelAt(RankingsSnapshotTest.Scene.Stale, scheduler).stampWords())
        val problem = viewModelAt(RankingsSnapshotTest.Scene.Problem, scheduler).ui.value
        assertEquals(AppWords.cannotLoad, problem.problem)
        assertNull(problem.chip)
        assertTrue((problem.state as RankingsState.Loaded).stale)
    }

    @Test
    fun everyReferenceIsSmallEnoughToKeep() {
        // The record job draws the references in this same task, so it checks them on the run after.
        assumeFalse(System.getProperty("paparazzi.test.record") == "true")
        val folder = File("src/test/snapshots/images")
        val images = requireNotNull(folder.listFiles()) { "no references at ${folder.absolutePath}" }
        assertEquals(REFERENCES, images.count { it.name.contains("_rankings-") })
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        const val MAX_BYTES = 300 * 1024
        const val REFERENCES = 24
    }
}
