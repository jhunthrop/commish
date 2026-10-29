package app.trycommish.feature.boxscore

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.trycommish.core.start.RowCells
import app.trycommish.core.trades.PickTick
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.StrokeGlyph
import app.trycommish.design.Tokens
import app.trycommish.design.Words

private const val PICKED_TINT = 0.08f
private const val DROP_TINT = 0.07f
private const val HELD_ALPHA = 0.4f
private const val TICK_TRACKING = 0.06
private val TICK = 24.dp
private val TARGET = 44.dp
private val EDGE = 3.dp
private val CHECK = listOf("M5 12.5l4.5 4.5L19 7.5")

/** One roster row of the trade builder (web BoxLine with its pick, the tight row at 390, the Lineup's
 * height and type): the tick that picks him for the trade, his face and name with his club and his game
 * under it (Avg and Last stay at a desk, Lane 268), Proj and his rest-of-season points a game. A picked row is lit in the accent, the member's drop in the loss's ink; a
 * player no trade takes has an empty tick. */
@Composable
fun PickRow(
    cells: RowCells,
    tick: PickTick,
    actions: RowActions,
    toggle: () -> Unit,
) {
    val c = CommishTheme.colors
    val ground =
        when (tick) {
            PickTick.Picked -> c.accent.copy(alpha = PICKED_TINT).compositeOver(c.surface)
            PickTick.Drop -> c.lossInk.copy(alpha = DROP_TINT).compositeOver(c.surface)
            is PickTick.Open, PickTick.None -> c.surface
        }
    val edge =
        when (tick) {
            PickTick.Picked -> c.accent
            PickTick.Drop -> c.lossInk
            is PickTick.Open, PickTick.None -> Color.Transparent
        }
    Row(
        Modifier
            .fillMaxWidth()
            .background(ground)
            .edgeRule(edge, EDGE)
            .padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(BoxColumn.slot), contentAlignment = Alignment.CenterStart) { TickCell(cells, tick, toggle) }
        PlayerCell(cells, actions.open, Modifier.weight(1f), evidence = null, facts = false)
        Figure(cells.proj, BoxColumn.proj)
        Figure(cells.season, BoxColumn.season)
    }
    Hairline()
}

/** The tick: the member's drop named, a dashed box for a player no trade takes, else the box that picks
 * him or puts him back, held back while his side is full. */
@Composable
private fun TickCell(
    cells: RowCells,
    tick: PickTick,
    toggle: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    when (tick) {
        PickTick.Drop ->
            Text(
                Words.Box.drop.uppercase(),
                style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = TICK_TRACKING.em),
                color = c.lossInk,
            )
        PickTick.None -> {
            val line = c.line
            Box(
                Modifier.size(TICK).drawBehind {
                    val radius =
                        Tokens.Radius.sm.dp
                            .toPx()
                    drawRoundRect(
                        line,
                        cornerRadius = CornerRadius(radius),
                        style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.dp.toPx()))),
                    )
                },
            )
        }
        is PickTick.Open, PickTick.Picked -> {
            val picked = tick == PickTick.Picked
            val held = tick is PickTick.Open && tick.disabled
            Box(
                Modifier
                    .size(TARGET)
                    .toggleable(value = picked, enabled = !held, role = Role.Checkbox, onValueChange = { toggle() })
                    .semantics { contentDescription = "${Words.Box.pick} ${cells.row.name}" },
                contentAlignment = Alignment.CenterStart,
            ) {
                Box(
                    Modifier
                        .size(TICK)
                        .alpha(if (held) HELD_ALPHA else 1f)
                        .clip(shape)
                        .background(if (picked) c.accent else c.surface)
                        .border(1.dp, if (picked) c.accent else c.lineStrong, shape),
                    contentAlignment = Alignment.Center,
                ) {
                    if (picked) StrokeGlyph(CHECK, 16.dp, c.accentInk, 2.6f)
                }
            }
        }
    }
}
