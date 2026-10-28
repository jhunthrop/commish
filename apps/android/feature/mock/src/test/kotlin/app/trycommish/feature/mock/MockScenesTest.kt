package app.trycommish.feature.mock

import app.trycommish.core.mock.MockCallState
import app.trycommish.core.mock.MockRoomState
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** The mock shows the states it names (as the iOS snapshot tests check theirs), and every committed reference
 * is small enough to keep. */
@OptIn(ExperimentalCoroutinesApi::class)
class MockScenesTest {
    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun room(scene: MockScene) = MockSceneReads(scheduler).room(scene).state.value as MockRoomState.Room

    @Test
    fun theOfflineRoomSaysWhenItWasRead() {
        val vm = MockSceneReads(scheduler).room(MockScene.Offline)
        assertEquals("${Words.Mock.unreachablePhone} Last read Sun 4:00 pm", vm.staleWords())
        assertFalse((vm.state.value as MockRoomState.Room).canWrite)
    }

    @Test
    fun theFirstTurnDrawsOurCallWithItsOneVerb() {
        val call = room(MockScene.FirstTurn).model.call as MockCallState.Call
        assertEquals("Draft him", call.call.verb)
    }

    @Test
    fun theQueueSceneShowsTheQueueUnderItsChip() {
        val pool = requireNotNull(room(MockScene.Queue).model.pool)
        assertEquals(Words.Mock.queue, pool.model.filter)
        assertEquals(3, pool.rows.size)
    }

    @Test
    fun theUndoSceneSaysWhereTheRoomWentBack() {
        assertTrue(room(MockScene.Undo).model.notice?.startsWith("Back to 4.08.") == true)
    }

    @Test
    fun everyReferenceIsSmallEnoughToKeep() {
        val images = File("src/test/snapshots/images").listFiles().orEmpty()
        // A folder not found is a failure, not a pass (Lane 214 review L7).
        assertTrue("no references found", images.isNotEmpty())
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        const val MAX_BYTES = 300 * 1024
    }
}
