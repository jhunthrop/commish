package app.trycommish.feature.trades

import app.trycommish.core.trades.TradeFixtures
import app.trycommish.core.trades.TradesState
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** The mock shows the states it names, and every committed reference is small enough to keep. */
@OptIn(ExperimentalCoroutinesApi::class)
class TradesMockTest {
    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun theMockShowsTheStatesItNames() {
        val finder = viewModelAt(TradesSnapshotTest.Scene.Finder).ui.value
        assertEquals(9, (finder.state as TradesState.Loaded).model.rows.size)
        val copied = viewModelAt(TradesSnapshotTest.Scene.Copied).ui.value
        assertEquals("Copied. Propose it on FFPC's trade page.", copied.copied[TradeFixtures.BEST]?.words)
        val holding = viewModelAt(TradesSnapshotTest.Scene.Holding).ui.value
        assertEquals("Aaron Rodgers", holding.model?.picker?.label)
        val builder = viewModelAt(TradesSnapshotTest.Scene.Builder).ui.value.builder
        assertNotNull(builder?.theirs)
        assertTrue(builder?.verbEnabled == true)
        assertEquals(
            Words.Builder.pickBoth,
            viewModelAt(TradesSnapshotTest.Scene.New)
                .ui.value.builder
                ?.sentence,
        )
        val stale = viewModelAt(TradesSnapshotTest.Scene.Stale)
        assertEquals("Last read Sat 12:00 pm", stale.stampWords())
        assertEquals(
            Words.InSeason.narrowingUnread,
            stale.ui.value.builder
                ?.sentence,
        )
        val sunday = viewModelAt(TradesSnapshotTest.Scene.Sunday).ui.value
        assertNull(
            sunday.model
                ?.row(TradeFixtures.BEST)
                ?.opened
                ?.week,
        )
        assertEquals(
            Words.Box.none,
            sunday.builder
                ?.bug
                ?.yours
                ?.figures
                ?.projBefore,
        )
    }

    @Test
    fun everyReferenceIsSmallEnoughToKeep() {
        val folder = File("src/test/snapshots/images")
        val images = requireNotNull(folder.listFiles()) { "no references at ${folder.absolutePath}" }
        // Every case's reference is there, so the size check below never passes over nothing.
        assertEquals(REFERENCES, images.count { it.name.contains("_trades-") })
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        const val MAX_BYTES = 300 * 1024
        val REFERENCES = TradesSnapshotTest.cases().size
    }
}
