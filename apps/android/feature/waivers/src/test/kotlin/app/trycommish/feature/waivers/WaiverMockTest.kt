package app.trycommish.feature.waivers

import app.trycommish.core.waivers.PanelMode
import app.trycommish.core.waivers.WaiverPosition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** The mock shows the states it names, and every committed reference is small enough to keep. */
@OptIn(ExperimentalCoroutinesApi::class)
class WaiverMockTest {
    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun theMockShowsTheStatesItNames() {
        val faab = viewModelAt(WaiverSnapshotTest.Scene.Faab)
        assertEquals("Your bid in waiver dollars, \$0 to \$87, what your team has left", faab.pin().bid?.label)
        val pending = viewModelAt(WaiverSnapshotTest.Scene.Pending)
        assertTrue(
            pending
                .pin()
                .panel
                ?.line
                .orEmpty()
                .startsWith("Claim submitted. ESPN processes it Wed 2:00 am"),
        )
        val refused = viewModelAt(WaiverSnapshotTest.Scene.Refused)
        assertEquals("ESPN said: Player 4808766 is not a free agent.", refused.pin().panel?.said)
        assertEquals("Done on ESPN. He is on your roster there now.", viewModelAt(WaiverSnapshotTest.Scene.Done).pin().panel?.line)
        assertFalse(viewModelAt(WaiverSnapshotTest.Scene.Stale).pin().enabled)
        assertNotNull(viewModelAt(WaiverSnapshotTest.Scene.Drops).pin().pair)
        assertEquals(
            listOf("Jahan Dotson"),
            viewModelAt(WaiverSnapshotTest.Scene.Reach)
                .ui.value.table.rows
                .map { it.cells.row.name },
        )
        val narrowed = viewModelAt(WaiverSnapshotTest.Scene.Narrowed).ui.value
        assertEquals(WaiverPosition.DEF, narrowed.position)
        assertTrue(narrowed.table.rows.isNotEmpty() && narrowed.table.rows.all { it.cells.row.position == "D/ST" })
        val positions = viewModelAt(WaiverSnapshotTest.Scene.Positions).ui.value
        assertTrue(positions.openedCard?.need == true)
        assertEquals(5, positions.openedCard?.free?.size)
        val week = viewModelAt(WaiverSnapshotTest.Scene.PositionsWeek).ui.value
        assertEquals(PanelMode.Week, week.panelMode)
        assertEquals("TE rank 12 of 12", week.openedCard?.rank)
        assertTrue(
            viewModelAt(WaiverSnapshotTest.Scene.PositionsEmpty)
                .ui.value.openedCard
                ?.free
                ?.isEmpty() == true,
        )
        assertEquals(
            null,
            viewModelAt(WaiverSnapshotTest.Scene.PositionsDefense)
                .ui.value.openedCard
                ?.median,
        )
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
