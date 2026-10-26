package app.trycommish.feature.boxscore

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces

/** RangeBar.svelte's track and tick. */
private val TRACK = 8.dp
private val TICK_WIDTH = 3.dp
private val TICK_HEIGHT = 16.dp
private val LEAST_SPAN = 2.dp
private const val HUNDRED = 100f

/**
 * An outcome range on a shared scale (the web's RangeBar.svelte, the iOS RangeBar): the track, the floor to
 * ceiling span in the strong line, the median as an ink tick, and the two ends in words under it. Every
 * position is a percent of the bar, decided by the caller's model; TalkBack reads the ends.
 */
@Composable
fun RangeBar(
    left: Double,
    width: Double,
    mid: Double,
    text: String,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.clearAndSetSemantics { contentDescription = text }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(Modifier.fillMaxWidth().height(TICK_HEIGHT)) {
            val place = { percent: Double -> size.width * percent.toFloat() / HUNDRED }
            val track = TRACK.toPx()
            val top = (size.height - track) / 2
            val round = CornerRadius(track / 2)
            drawRoundRect(c.surface2, Offset(0f, top), Size(size.width, track), round)
            drawRoundRect(c.lineStrong, Offset(place(left), top), Size(maxOf(place(width), LEAST_SPAN.toPx()), track), round)
            val tick = TICK_WIDTH.toPx()
            drawRoundRect(c.ink, Offset(place(mid) - tick / 2, 0f), Size(tick, size.height), CornerRadius(2.dp.toPx()))
        }
        Text(text.uppercase(), style = Faces.label, color = c.ink3, maxLines = 1)
    }
}
