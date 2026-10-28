package app.trycommish.feature.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.board.TierBand
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.TierRamp
import app.trycommish.design.Tokens

/** The tier's number column and the band's least height at 390 (TierStrip.svelte). */
private val STRIP = 36.dp
private val BAND_HEIGHT = 40.dp

/** The rule under the band. */
private val RULE = 2.dp

/** tokens.css --tier-wash: how much of the tier's shade tints its band, light and dark. */
private const val WASH_LIGHT = 0.09f
private const val WASH_DARK = 0.16f

/**
 * A tier's band over its rows, as the web's TierStrip draws it at 390 (the iOS TierStripView's twin): a
 * row's height, the tier's number once on its shade of the one ink ramp, its name and count, and the
 * drop to the next tier in the row's figure size (or the last tier's words), on the band's wash with the
 * shade's rule under it.
 */
@Composable
internal fun TierStrip(band: TierBand) {
    val c = CommishTheme.colors
    val shade = TierRamp.shade(band.tier, c.dark)
    val wash = lerp(c.bg, shade, if (c.dark) WASH_DARK else WASH_LIGHT)
    val top = RoundedCornerShape(topStart = Tokens.Radius.md.dp, topEnd = Tokens.Radius.md.dp)
    Box(Modifier.padding(top = Tokens.Space.s4.dp).fillMaxWidth().semantics(mergeDescendants = true) { heading() }) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
                .heightIn(min = BAND_HEIGHT)
                .clip(top)
                .background(wash),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(STRIP).fillMaxHeight().background(shade), contentAlignment = Alignment.Center) {
                Text(band.tier.toString(), style = number(NumWeight.Bold), color = TierRamp.ink(band.tier, c.dark))
            }
            Row(
                Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(band.name, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink, maxLines = 1)
                Quiet(band.count, c.ink2)
            }
            Row(
                Modifier.padding(end = Tokens.Space.s2.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                band.drop?.let { Text(it, style = number(NumWeight.SemiBold), color = c.ink) }
                Quiet(band.dropWords, c.ink2)
            }
        }
        Box(
            Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .height(RULE)
                .background(shade),
        )
    }
}

private fun number(weight: NumWeight) = Faces.number(weight, Tokens.Type.md.sp)

@Composable
private fun Quiet(
    text: String,
    color: Color,
) {
    Text(
        text,
        style = Faces.small.copy(fontSize = Tokens.Type.xs.sp, fontWeight = FontWeight.Medium),
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
