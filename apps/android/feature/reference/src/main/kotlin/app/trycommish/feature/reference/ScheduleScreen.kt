package app.trycommish.feature.reference

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.reference.ScheduleCell
import app.trycommish.core.reference.ScheduleGridModel
import app.trycommish.core.reference.ScheduleGridRow
import app.trycommish.core.reference.ScheduleModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Headshot
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.design.resolve

/** The grid's phone sizes (ScheduleGrid.svelte at 390): the club's column with its rank leading and its
 * strength pinned beside it, then the weeks, which scroll sideways in their own frame. */
private object GridSize {
    val club = 132.dp
    val strength = 48.dp
    val week = 64.dp
    val row = 52.dp

    /** A row whose current week's cell carries the game's state on a third line. */
    val statedRow = 62.dp
    val head = 34.dp
    val rank = 22.dp
    val face = 24.dp
}

/** "Wk 7": a week's head. */
fun weekHead(week: Int): String = "${Words.SchedulePage.week} $week"

/** The pinned columns of a club's row: its rank, its lead player's face, its name opening its page with the
 * player's name under it, then its strength. */
@Composable
private fun GridClubCell(
    height: Dp,
    row: ScheduleGridRow,
    strength: Boolean,
    open: (String) -> Unit,
) {
    val c = CommishTheme.colors
    Column {
        Row(
            Modifier.height(height).padding(horizontal = Tokens.Space.s2.dp),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.width(GridSize.club).clickable(role = Role.Button) { open(row.abbr) },
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                row.rank?.let {
                    Text(
                        it.toString(),
                        style = Faces.number(NumWeight.Bold),
                        color = c.ink,
                        textAlign = TextAlign.End,
                        modifier = Modifier.width(GridSize.rank),
                    )
                }
                Headshot(row.face, row.abbr, GridSize.face)
                Column(Modifier.weight(1f)) {
                    Text(
                        row.name,
                        style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
                        color = c.ink,
                        maxLines = 2,
                        lineHeight = 15.sp,
                    )
                    row.faceName?.let {
                        Text(
                            it,
                            style = Faces.label.copy(fontWeight = FontWeight.Normal),
                            color = c.ink3,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            if (strength) {
                RowFigure(
                    row.strength ?: Words.Box.none,
                    Modifier.width(GridSize.strength),
                    ink = c.ink,
                    style = Faces.cell.copy(fontSize = Tokens.Type.md.sp),
                )
            }
        }
        HorizontalDivider(color = c.line)
    }
}

/** A week's cell: the opponent at or against and his value, shaded among the strongest, set back once
 * played, opening the opponent's page; the bye's word. */
@Composable
private fun GridWeekCell(
    height: Dp,
    cell: ScheduleCell,
    open: (String) -> Unit,
) {
    val c = CommishTheme.colors
    val played = Tokens.Color.playedInk.resolve(c.dark)
    val ink = if (cell.played) played else c.ink
    val club = cell.club
    Column(Modifier.width(GridSize.week)) {
        Box(
            Modifier
                .width(GridSize.week)
                .height(height)
                .background(if (cell.hard) c.surface2 else c.bg)
                .then(if (club != null) Modifier.clickable(role = Role.Button) { open(club) } else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            val opponent = cell.opponent
            if (opponent == null) {
                Text(Words.SchedulePage.bye, style = Faces.label, color = if (cell.played) played else c.ink3)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(opponent, style = Faces.label, color = ink, maxLines = 1)
                    Text(
                        cell.value,
                        style = Faces.cell.copy(fontSize = Tokens.Type.md.sp),
                        color =
                            if (cell.played) {
                                ink
                            } else if (cell.hard) {
                                c.ink2
                            } else {
                                c.ink
                            },
                    )
                    // The current week's game as the run read it, set back once final (Lane 223, B187).
                    cell.state?.let {
                        Text(
                            it,
                            style = Faces.label.copy(fontWeight = FontWeight.Normal),
                            color = if (cell.played) played else c.ink3,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
        HorizontalDivider(color = c.line)
    }
}

/** The grid: the club and strength columns pinned, the weeks scrolling sideways beside them, opened on the
 * current week where the run says its games' states (ScheduleGrid.svelte openOnCurrent); `still` draws the
 * weeks the frame holds from there, the rest cut at its edge (a snapshot's). */
@Composable
fun ScheduleGridView(
    grid: ScheduleGridModel,
    rows: List<ScheduleGridRow>,
    open: (String) -> Unit,
    still: Boolean,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val strength = grid.strengthLabel
    val height = if (grid.current == null) GridSize.row else GridSize.statedRow
    // The weeks before the current one lie left of the frame's edge: week 1 sits at the start.
    val opening = with(LocalDensity.current) { (GridSize.week * ((grid.current ?: 1) - 1)).roundToPx() }
    val weeks = rememberScrollState(opening)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.bg)
            .border(1.dp, c.line, shape),
    ) {
        Column(Modifier.width(IntrinsicSize.Max).trailingRule(c.line)) {
            Row(
                Modifier.height(GridSize.head).padding(horizontal = Tokens.Space.s2.dp),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ColumnHead(Words.SchedulePage.club, Modifier.width(GridSize.club), TextAlign.Start)
                strength?.let { ColumnHead(it, Modifier.width(GridSize.strength)) }
            }
            HorizontalDivider(color = c.line)
            rows.forEach { GridClubCell(height, it, strength != null, open) }
        }
        // At rest (a snapshot's) the weeks lie still where they open, the rest cut at the frame's edge.
        Column(Modifier.weight(1f).horizontalScroll(weeks, enabled = !still)) {
            Row(Modifier.height(GridSize.head)) {
                grid.weeks.forEach { week ->
                    Box(Modifier.width(GridSize.week).height(GridSize.head), contentAlignment = Alignment.Center) {
                        Text(
                            weekHead(week).uppercase(),
                            style = Faces.label,
                            color = if (week <= grid.played) Tokens.Color.playedInk.resolve(c.dark) else c.ink3,
                        )
                    }
                }
            }
            HorizontalDivider(Modifier.width(GridSize.week * grid.weeks.size), color = c.line)
            rows.forEach { row -> Row { row.cells.forEach { GridWeekCell(height, it, open) } } }
        }
    }
}

/** The legend under the grid: a shaded cell's words and a played one's. */
@Composable
private fun ScheduleLegend(model: ScheduleModel) {
    val c = CommishTheme.colors
    Row(
        Modifier.padding(horizontal = Tokens.Space.s3.dp),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(width = 18.dp, height = 14.dp)
                    .clip(RoundedCornerShape(Tokens.Radius.sm.dp))
                    .background(c.surface2)
                    .border(1.dp, c.line, RoundedCornerShape(Tokens.Radius.sm.dp)),
            )
            Text(model.legendHard, style = Faces.label, color = c.ink2)
        }
        Text(model.legendPlayed, style = Faces.label, color = Tokens.Color.playedInk.resolve(c.dark))
    }
}

/** The strength of schedule at 390: the heading and its lead, the grid with its caption and legend. */
@Composable
fun ScheduleScreen(
    model: ScheduleModel,
    stale: String?,
    actions: ReferenceActions,
    rows: List<ScheduleGridRow> = model.grid.rows,
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    val scroll = if (still) Modifier else Modifier.fillMaxSize().verticalScroll(rememberScrollState())
    Column(scroll.background(c.bg).padding(vertical = Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        ReferenceHead(model.heading, model.stamp, model.grid.lead, stale)
        Text(model.caption, style = Faces.small, color = c.ink3, modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp))
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) { ScheduleGridView(model.grid, rows, actions::club, still) }
        // One line under the games naming the run's read, so a state is never claimed live.
        model.grid.asOf?.let { Text(it, style = Faces.small, color = c.ink3, modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp)) }
        ScheduleLegend(model)
    }
}

/** A rule down the trailing edge: the pinned columns' edge against the weeks. */
private fun Modifier.trailingRule(color: Color): Modifier =
    drawWithContent {
        drawContent()
        drawLine(color, Offset(size.width, 0f), Offset(size.width, size.height), strokeWidth = 1.dp.toPx())
    }
