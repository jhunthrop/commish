package app.trycommish.design

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val VERB_HEIGHT = 48.dp
private val QUIET_HEIGHT = 44.dp

/** The screen's one solid verb, in the accent (web Verb.svelte), full width; disabled, quiet on the
 * second surface, with the reason said under it by the screen. */
@Composable
fun Verb(
    title: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val c = CommishTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(Tokens.Radius.md.dp),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = c.accent,
                contentColor = c.accentInk,
                disabledContainerColor = c.surface2,
                disabledContentColor = c.ink3,
            ),
        modifier = modifier.fillMaxWidth().heightIn(min = VERB_HEIGHT),
    ) {
        Text(title, style = Faces.body.copy(fontWeight = FontWeight.Bold))
    }
}

/** A quiet verb: the accent's text, no fill (web Quiet.svelte). The screen's one solid verb is [Verb]. */
@Composable
fun QuietButton(
    title: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, modifier = modifier.heightIn(min = QUIET_HEIGHT)) {
        Text(title, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = CommishTheme.colors.accentText)
    }
}

/** A row the lineup advice moves (web MoveMark.svelte): an arrow up on the accent for a player it
 * starts, an arrow down on grey for a starter it sits, the web's own paths. The slot word beside it
 * carries the meaning. */
@Composable
fun ArrowMark(
    starts: Boolean,
    side: Dp = 18.dp,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    val ground =
        if (starts) {
            Modifier.background(c.accent, CircleShape)
        } else {
            Modifier.background(c.surface2, CircleShape).border(1.dp, c.lineStrong, CircleShape)
        }
    Box(modifier.size(side).then(ground), contentAlignment = Alignment.Center) {
        StrokeGlyph(if (starts) ARROW_UP else ARROW_DOWN, side - ARROW_INSET, if (starts) c.accentInk else c.ink2, ARROW_STROKE)
    }
}

/** A glyph drawn from SVG path data on the web's 24 grid, stroked with round ends, as the web's own
 * inline glyphs are (the box score's arrows and weather). */
@Composable
fun StrokeGlyph(
    paths: List<String>,
    side: Dp,
    color: Color,
    stroke: Float = 2f,
    modifier: Modifier = Modifier,
) {
    val vector =
        remember(paths, side, color, stroke) {
            paths
                .fold(
                    ImageVector.Builder(defaultWidth = side, defaultHeight = side, viewportWidth = GRID, viewportHeight = GRID),
                ) { builder, d ->
                    builder.addPath(
                        pathData = PathParser().parsePathString(d).toNodes(),
                        stroke = SolidColor(color),
                        strokeLineWidth = stroke,
                        strokeLineCap = StrokeCap.Round,
                        strokeLineJoin = StrokeJoin.Round,
                    )
                }.build()
        }
    Image(rememberVectorPainter(vector), contentDescription = null, modifier = modifier.size(side))
}

private const val GRID = 24f
private const val ARROW_STROKE = 2.6f
private val ARROW_INSET = 6.dp
private val ARROW_UP = listOf("M12 19V5M5 12l7-7 7 7")
private val ARROW_DOWN = listOf("M12 5v14M5 12l7 7 7-7")
