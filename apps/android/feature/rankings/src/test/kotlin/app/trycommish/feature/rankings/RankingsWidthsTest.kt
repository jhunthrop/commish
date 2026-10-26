package app.trycommish.feature.rankings

import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.font.createFontFamilyResolver
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.core.rankings.RankingsPills
import app.trycommish.design.pillStyle
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * The pill slot's widest candidate, measured in the pill's own face through layoutlib (no image is drawn):
 * the slot is sized to it, so the number is logged and pinned rather than guessed (Lane 216 review M2). At
 * 1x the widest is "WR Susp", 50 dp of words and 62 dp with the pill's padding: wider than iOS's fixed 56
 * pt, which was sized to "WR 1xx" alone, because the slot also bounds the list words a pill prints in
 * place of a rank.
 */
class RankingsWidthsTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.NEXUS_5)

    @Test
    fun theSlotIsSizedToTheWidestPillTheOrderCanPrint() {
        val density = Density(1f, 1f)
        val measurer = TextMeasurer(createFontFamilyResolver(paparazzi.context), density, LayoutDirection.Ltr)
        val (widest, px) =
            widestPill(RankingsPills.widestCandidates) { measurer.measure(it, pillStyle, maxLines = 1, softWrap = false).size.width }
        println("lane216 widest pill candidate: \"$widest\" $px dp of words, ${px + PILL_PADDING_DP * 2} dp with padding")
        assertEquals(WIDEST, widest)
    }

    @Test
    fun theWidestIsChosenByWidthNotByOrder() {
        assertEquals("WR 120" to 6, widestPill(listOf("K", "WR 120", "TE 9")) { it.length })
    }

    private companion object {
        const val WIDEST = "WR Susp"
        const val PILL_PADDING_DP = 6
    }
}
