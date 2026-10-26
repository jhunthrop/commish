package app.trycommish.feature.boxscore

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.start.Ease
import app.trycommish.core.start.StripCell
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens

/** The strip's measures (the web's FigureStrip.svelte and iOS's FigureStrip). */
object FigureStripSize {
    /** A step under the cell labels (Tokens.Type.xs), so five heads fit the smallest phone's row, as the
     * web's strip sets its heads (--strip-head). */
    val head = 10.sp

    /** The room between two cells, as the web's phone strip. */
    val gap = 4.dp
}

/** The heads' tracking, the web's strip's. */
private const val STRIP_HEAD_TRACKING = 0.02

/** The opponent's tint's room each side of the rank it sits behind (OppRank). */
private val TINT_PADDING = 3.dp

/**
 * A row's figures as labelled cells in one strip (the web's FigureStrip.svelte, Lane 209; iOS's, Lane
 * 215): each cell its head in small caps over its figure, never a sentence. The cells take fixed shares
 * of the row, so every head sits over its column down the list; the key the rows sort on is in ink, the
 * opponent's rank carries its tint. Any box-score screen can draw it.
 */
@Composable
fun FigureStrip(
    cells: List<StripCell>,
    modifier: Modifier = Modifier,
) {
    val shares = cells.map { it.share }
    Layout(
        content = { cells.forEach { StripCellView(it) } },
        modifier = modifier.fillMaxWidth(),
    ) { measurables, constraints ->
        val gap = FigureStripSize.gap.roundToPx()
        val tracks = stripTracks(shares, constraints.maxWidth, gap)
        val placeables = measurables.zip(tracks).map { (m, w) -> m.measure(Constraints.fixedWidth(w)) }
        val height = placeables.maxOfOrNull { it.height } ?: 0
        layout(constraints.maxWidth, height) {
            var x = 0
            placeables.zip(tracks).forEach { (p, w) ->
                p.place(x, 0)
                x += w + gap
            }
        }
    }
}

/** stripTracks: each track's width in pixels, the room after the gaps shared out by each cell's share. */
internal fun stripTracks(
    shares: List<Double>,
    width: Int,
    gap: Int,
): List<Int> {
    val total = shares.sum()
    if (total <= 0) return shares.map { 0 }
    val room = (width - gap * (shares.size - 1).coerceAtLeast(0)).coerceAtLeast(0)
    return shares.map { (room * it / total).toInt() }
}

/** One cell: the head over the figure, both to the cell's trailing edge as a figure column is. */
@Composable
private fun StripCellView(cell: StripCell) {
    val c = CommishTheme.colors
    Column(
        Modifier.clearAndSetSemantics { contentDescription = "${cell.head} ${cell.value}" },
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text(
            cell.head.uppercase(),
            style = Faces.label.copy(fontSize = FigureStripSize.head, letterSpacing = STRIP_HEAD_TRACKING.em),
            color = if (cell.key) c.ink2 else c.ink3,
            maxLines = 1,
            softWrap = false,
        )
        StripFigure(cell)
    }
}

@Composable
private fun StripFigure(cell: StripCell) {
    val c = CommishTheme.colors
    val style = Faces.number(if (cell.key) NumWeight.Bold else NumWeight.SemiBold, Tokens.Type.sm.sp)
    val tint =
        when (cell.ease) {
            Ease.Easy -> c.gainBg
            Ease.Hard -> c.lossBg
            Ease.Even, null -> null
        }
    when {
        cell.opp && tint != null ->
            Text(
                cell.value,
                style = style,
                color = c.ink2,
                maxLines = 1,
                modifier = Modifier.background(tint, RoundedCornerShape(Tokens.Radius.sm.dp)).padding(horizontal = TINT_PADDING),
            )
        cell.opp && cell.ease == null -> Text(cell.value, style = style, color = c.ink3, maxLines = 1)
        else -> Text(cell.value, style = style, color = if (cell.key) c.ink else c.ink2, maxLines = 1)
    }
}

/** A text's drawn width in a face, as the platform sets it (the number face in tabular figures, so every
 * figure of as many digits is one width): what a figure column needs to hold it whole. */
@Composable
fun rememberTextWidth(
    text: String,
    style: TextStyle,
): Dp {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    return remember(text, style, density) {
        with(density) {
            measurer
                .measure(text, style, maxLines = 1, softWrap = false)
                .size.width
                .toDp()
        }
    }
}

/** A figure's width at a weight of the number face. */
@Composable
fun rememberFigureWidth(
    text: String,
    weight: NumWeight,
    size: TextUnit,
): Dp = rememberTextWidth(text, Faces.number(weight, size))
