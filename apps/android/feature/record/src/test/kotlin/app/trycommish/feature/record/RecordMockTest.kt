package app.trycommish.feature.record

import app.trycommish.core.record.RecordBug
import app.trycommish.core.record.RecordState
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

/** The mock shows the states it names, and every committed reference is small enough to keep. */
@OptIn(ExperimentalCoroutinesApi::class)
class RecordMockTest {
    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun loaded(scene: RecordSnapshotTest.Scene) = viewModelAt(scene, scheduler).ui.value.state as RecordState.Loaded

    @Test
    fun theMockShowsTheStatesItNames() {
        assertTrue(loaded(RecordSnapshotTest.Scene.Head).model.weekly.bug is RecordBug.Tiles)
        val week =
            loaded(RecordSnapshotTest.Scene.Week)
                .model.weekly.rows
                .first { it.graded }
        assertEquals("Our rest-of-season order, set Oct 22, graded Wed Oct 28", week.caption)
        assertTrue(loaded(RecordSnapshotTest.Scene.Pending).model.weekly.bug is RecordBug.Pending)
        assertEquals(null, loaded(RecordSnapshotTest.Scene.Draft).model.draft.waiting)
        assertTrue(loaded(RecordSnapshotTest.Scene.Stale).stale)
        assertEquals("Last read Thu 12:00 pm", viewModelAt(RecordSnapshotTest.Scene.Stale, scheduler).stampWords())
    }

    @Test
    fun everyReferenceIsSmallEnoughToKeep() {
        // The record job draws the references in this same task, so it checks them on the run after.
        assumeFalse(System.getProperty("paparazzi.test.record") == "true")
        val folder = File("src/test/snapshots/images")
        val images = requireNotNull(folder.listFiles()) { "no references at ${folder.absolutePath}" }
        assertEquals(REFERENCES, images.count { it.name.contains("_record-") })
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        const val MAX_BYTES = 300 * 1024
        const val REFERENCES = 20
    }
}
