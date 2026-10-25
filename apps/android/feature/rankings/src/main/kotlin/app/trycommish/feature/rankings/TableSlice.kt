package app.trycommish.feature.rankings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.unit.dp
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens

private val CORNER = Tokens.Radius.md.dp
private val EDGE = 1.dp

/**
 * One item's part of a box score's frame (the box-score module's TableFrame) when the table is a lazy
 * list's items: the surface, the hairline down both sides, and the rounded top on the first item and the
 * rounded bottom on the last. The frame's outline is drawn as one rounded rectangle running past the item's
 * ends where it continues, and clipped to the item.
 */
@Composable
internal fun Modifier.tableSlice(
    first: Boolean = false,
    last: Boolean = false,
): Modifier {
    val c = CommishTheme.colors
    val top = if (first) CORNER else 0.dp
    val bottom = if (last) CORNER else 0.dp
    return fillMaxWidth()
        .clip(RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom))
        .background(c.surface)
        .drawWithContent {
            drawContent()
            val edge = EDGE.toPx()
            val radius = CORNER.toPx()
            val past = radius * 2
            val from = if (first) edge / 2 else -past
            val to = if (last) size.height - edge / 2 else size.height + past
            clipRect {
                drawRoundRect(
                    color = c.line,
                    topLeft = Offset(edge / 2, from),
                    size = Size(size.width - edge, to - from),
                    cornerRadius = CornerRadius(radius - edge / 2),
                    style = Stroke(edge),
                )
            }
        }
}
