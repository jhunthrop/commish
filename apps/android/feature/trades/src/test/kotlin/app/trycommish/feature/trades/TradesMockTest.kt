package app.trycommish.feature.trades

import app.trycommish.core.trades.BuilderPinWords
import app.trycommish.core.trades.TradeFixtures
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
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
        val open = viewModelAt(TradesSnapshotTest.Scene.Open).ui.value.builder
        assertEquals(Words.Builder.pickBoth, open?.sentence)
        assertEquals("8 more", open?.more)
        val idea = viewModelAt(TradesSnapshotTest.Scene.Idea).ui.value.builder
        assertEquals(TradeFixtures.BEST, idea?.pressed)
        assertTrue(idea?.verbEnabled == true)
        assertNull(
            viewModelAt(TradesSnapshotTest.Scene.Ideas)
                .ui.value.builder
                ?.more,
        )
        val refused = viewModelAt(TradesSnapshotTest.Scene.Refused).ui.value.builder
        assertEquals(BuilderPinWords.Said(Words.Trades.theyGiveUp), refused?.pin)
        assertTrue(
            refused
                ?.bug
                ?.theirs
                ?.rest
                ?.refuses == true,
        )
        val stale = viewModelAt(TradesSnapshotTest.Scene.Stale)
        assertEquals("Last read Sat 12:00 pm", stale.stampWords())
        assertEquals(
            Words.InSeason.narrowingUnread,
            stale.ui.value.builder
                ?.sentence,
        )
        val sunday = viewModelAt(TradesSnapshotTest.Scene.Sunday).ui.value.builder
        assertEquals(
            Words.Box.none,
            sunday
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
