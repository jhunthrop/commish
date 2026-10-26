package app.trycommish.feature.companion

import app.trycommish.core.companion.CompanionState
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** The mock shows the states it names (as the iOS snapshot tests check theirs), and every committed
 * reference is small enough to keep. */
@OptIn(ExperimentalCoroutinesApi::class)
class CompanionMockTest {
    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun room(scene: CompanionScene): CompanionState.Room = SceneReads(scheduler).room(scene).state.value as CompanionState.Room

    @Test
    fun theStaleSceneSaysWhenItsPicksWereRead() {
        val vm = SceneReads(scheduler).room(CompanionScene.Stale)
        assertEquals("Last read Sun 2:31 pm", vm.stampWords())
    }

    @Test
    fun theMarkedSceneShowsTheDraftersPickOnTheStrip() {
        val model = room(CompanionScene.Marked).model
        val mine = model.strip?.picks?.firstOrNull { it.strong }
        assertNotNull(mine)
        assertEquals(listOf("2.08", Words.Companion.you), mine?.lines)
        assertTrue(model.team.slots.any { it.pick == "2.08" })
    }

    @Test
    fun theTurnSceneDrawsTheCallWithTheOneVerb() {
        val call = room(CompanionScene.Turn).model.call
        assertEquals("Make the pick on Sleeper", call?.verb)
    }

    @Test
    fun theReportScenesDrawTheReport() {
        assertTrue(SceneReads(scheduler).room(CompanionScene.ReportHead).state.value is CompanionState.Report)
    }

    @Test
    fun everyReferenceIsSmallEnoughToKeep() {
        val images = File("src/test/snapshots/images").listFiles().orEmpty()
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        const val MAX_BYTES = 300 * 1024
    }
}
