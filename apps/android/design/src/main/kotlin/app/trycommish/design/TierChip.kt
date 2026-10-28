package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em

/** ui/tier.ts (the iOS TierRamp): a tier's shade on the one ink ramp and the text on it, seven steps, a
 * tier past the last sharing its lightest. The Board's bands and the cheat sheet's chips draw from it. */
object TierRamp {
    /** tierColor: the seven steps (TIER_HUES). */
    private val shades =
        with(Tokens.Color) { listOf(tier1, tier2, tier3, tier4, tier5, tier6, tier7) }

    /** tierInk: the text on each step. */
    private val inks =
        with(Tokens.Color) { listOf(tierInk1, tierInk2, tierInk3, tierInk4, tierInk5, tierInk6, tierInk7) }

    fun shade(
        tier: Int,
        dark: Boolean,
    ): Color = shades[step(tier)].resolve(dark)

    fun ink(
        tier: Int,
        dark: Boolean,
    ): Color = inks[step(tier)].resolve(dark)

    /** The tier's step on the ramp, zero-based, the last for every tier past it. */
    private fun step(tier: Int): Int = tier.coerceIn(1, shades.size) - 1
}

private val CHIP_HEIGHT = 20.dp
private val CHIP_PADDING = 7.dp
private const val CHIP_TRACKING = 0.04

/** A tier in a row (TierChip.svelte, the iOS TierChip): "T3" on the tier's shade. */
@Composable
fun TierChip(
    tier: Int,
    modifier: Modifier = Modifier,
) {
    val dark = CommishTheme.colors.dark
    Text(
        "T$tier",
        style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = CHIP_TRACKING.em),
        color = TierRamp.ink(tier, dark),
        modifier =
            modifier
                .height(CHIP_HEIGHT)
                .background(TierRamp.shade(tier, dark), RoundedCornerShape(Tokens.Radius.sm.dp))
                .padding(horizontal = CHIP_PADDING)
                .wrapContentHeight(Alignment.CenterVertically),
    )
}
