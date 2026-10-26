package app.trycommish.feature.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.companion.RoomWall
import app.trycommish.core.companion.WallCell
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.edgeRule

/** Wall.svelte's widths, the iOS WallView's: the round's column, a team's (a cell's least width), a cell's
 * least height, the face, the drafter's edge, the clock's dashes and their inset. */
private object WallSize {
    val round = 24.dp
    val team = 96.dp
    val cell = 54.dp
    val face = 22.dp
    val edge = 3.dp
    val dash = 2.dp
    val inset = 4.dp
    const val DASH_ON = 5f
    const val DASH_OFF = 3f
}

/** The wall (Wall.svelte at 390): its title and how many rounds it shows, then a grid that scrolls
 * sideways, each seat's name across the top (the drafter's in the accent) and each round's picks seat by
 * seat: his face, position and club, his last name; the drafter's own on the accent's wash with its edge;
 * the pick on the clock dashed in the accent with whose it is. */
@Composable
internal fun WallView(
    wall: RoomWall,
    open: (SheetPlayer) -> Unit,
    still: Boolean,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        Row(
            Modifier.padding(horizontal = Tokens.Space.s3.dp),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SectionHead(wall.title)
            HeadText(wall.label, end = false, lines = 1)
        }
        val scroll =
            if (still) {
                Modifier.wrapContentWidth(
                    Alignment.Start,
                    unbounded = true,
                )
            } else {
                Modifier.horizontalScroll(rememberScrollState())
            }
        Box(
            Modifier
                .padding(horizontal = Tokens.Space.s3.dp)
                .fillMaxWidth()
                .clip(shape)
                .background(c.surface)
                .border(1.dp, c.line, shape),
        ) {
            Column(scroll) {
                Row(Modifier.underline(c.line), verticalAlignment = Alignment.Bottom) {
                    Box(Modifier.width(WallSize.round))
                    wall.names.forEachIndexed { index, name ->
                        Text(
                            name.uppercase(),
                            style = Faces.label,
                            color = if (index + 1 == wall.you) c.accentText else c.ink3,
                            modifier = Modifier.width(WallSize.team).padding(horizontal = 6.dp, vertical = 8.dp),
                        )
                    }
                }
                wall.rows.forEachIndexed { index, row ->
                    Row(Modifier.height(IntrinsicSize.Min).underline(c.line)) {
                        Box(Modifier.width(WallSize.round).fillMaxHeight(), contentAlignment = Alignment.Center) {
                            Text((index + 1).toString(), style = Faces.number(NumWeight.Bold), color = c.ink3)
                        }
                        row.forEach { cell -> WallCellView(cell, open) }
                    }
                }
            }
        }
    }
}

/** A hairline under a row of the grid. */
private fun Modifier.underline(color: Color): Modifier =
    drawBehind { drawRect(color, Offset(0f, size.height - 1.dp.toPx()), Size(size.width, 1.dp.toPx())) }

@Composable
private fun WallCellView(
    cell: WallCell,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    val player = cell.player
    val now = cell.now
    val box =
        Modifier
            .width(WallSize.team)
            .heightIn(min = WallSize.cell)
            .fillMaxHeight()
            .edgeRule(c.line, 1.dp)
    when {
        player != null ->
            Column(
                box
                    .background(if (cell.mine) c.accentWash else Color.Transparent)
                    .then(if (cell.mine) Modifier.edgeRule(c.accent, WallSize.edge) else Modifier)
                    .opens(player, open)
                    .padding(6.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                    PlayerFace(player, WallSize.face)
                    Text(
                        cell.line.orEmpty(),
                        style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                        color = c.ink3,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                    )
                }
                Text(cell.name.orEmpty(), style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
            }
        now != null ->
            Column(
                box
                    .background(c.accentWash)
                    .drawBehind {
                        val inset = WallSize.inset.toPx()
                        drawRoundRect(
                            c.accent,
                            Offset(inset, inset),
                            Size(size.width - inset * 2, size.height - inset * 2),
                            CornerRadius(2.dp.toPx()),
                            style =
                                Stroke(
                                    WallSize.dash.toPx(),
                                    pathEffect =
                                        PathEffect.dashPathEffect(
                                            floatArrayOf(
                                                WallSize.DASH_ON * density,
                                                WallSize.DASH_OFF * density,
                                            ),
                                        ),
                                ),
                        )
                    }.padding(6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(now.words, style = Faces.small.copy(fontWeight = FontWeight.Bold), color = c.accentText)
                Text(now.pick, style = Faces.label.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.sp), color = c.accentText)
            }
        else -> Box(box)
    }
}
