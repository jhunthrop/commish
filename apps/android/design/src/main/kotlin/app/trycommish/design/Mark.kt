package app.trycommish.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The outline's weight for a rendering `size` dp square: heavier at small sizes, as the web's. */
fun markStroke(size: Float): Float = if (size <= MarkShape.SMALL_MAX_DP) MarkShape.SMALL_STROKE else MarkShape.STROKE

/** The whistle, drawn from the web's one path (MarkShape, generated from web/src/lib/ui/mark.ts): the
 * outline in ink, the pea in the accent. */
@Composable
fun Mark(
    size: Dp = 24.dp,
    modifier: Modifier = Modifier,
) {
    val colors = CommishTheme.colors
    val path = remember { PathParser().parsePathString(MarkShape.PATH).toPath() }
    val pad = (MarkShape.VIEW_SIDE - MarkShape.BOX) / 2
    Canvas(modifier.size(size)) {
        val unit = this.size.minDimension / MarkShape.VIEW_SIDE
        scale(unit, unit, pivot = Offset.Zero) {
            translate(pad, pad) {
                drawPath(path, colors.ink, style = Stroke(width = markStroke(size.value), join = StrokeJoin.Round))
                drawCircle(colors.accent, radius = MarkShape.PEA_R, center = Offset(MarkShape.PEA_X, MarkShape.PEA_Y))
            }
        }
    }
}
