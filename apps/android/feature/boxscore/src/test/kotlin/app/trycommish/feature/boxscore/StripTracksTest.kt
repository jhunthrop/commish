package app.trycommish.feature.boxscore

import org.junit.Assert.assertEquals
import org.junit.Test

/** The strip's tracks: shared out by each cell's share after the gaps, the rounding left over given to the
 * last track, so the tracks and the gaps fill the row exactly. */
class StripTracksTest {
    @Test
    fun theOrdersFiveCellsFillTheRowWithTheNarrowCellAtItsShare() {
        val shares = listOf(0.6, 1.0, 1.0, 1.0, 1.0)
        val tracks = stripTracks(shares, width = 655, gap = 8)
        // 623 px of room over 4.6 shares: 81 for the narrow cell, 135 each, and the 2 px left to the last.
        assertEquals(listOf(81, 135, 135, 135, 137), tracks)
        assertEquals(655, tracks.sum() + 8 * 4)
    }

    @Test
    fun equalSharesSplitEvenlyWhenTheRoomDividesWhole() {
        assertEquals(listOf(100, 100, 100), stripTracks(listOf(1.0, 1.0, 1.0), width = 316, gap = 8))
    }

    @Test
    fun noRoomOrNoSharesDrawsNothing() {
        assertEquals(listOf(0, 0), stripTracks(listOf(1.0, 1.0), width = 4, gap = 8))
        assertEquals(emptyList<Int>(), stripTracks(emptyList(), width = 300, gap = 8))
    }
}
