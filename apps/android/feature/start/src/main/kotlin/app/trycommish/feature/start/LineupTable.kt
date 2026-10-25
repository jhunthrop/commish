package app.trycommish.feature.start

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.start.StartModel
import app.trycommish.core.start.TeamRow
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Words

/** The phone's columns (LineupTable.svelte at 390): the slot, the player taking the rest, Our rank, Proj,
 * Pts and the cell that opens a swap's evidence line. */
internal object Column {
    val slot = 44.dp
    val rank = 36.dp
    val proj = 50.dp
    val pts = 42.dp
    val why = 30.dp
    val face = 28.dp
}

private const val HEAD_TRACKING = 0.06
private const val IDLE_TINT = 0.35f

/** What a row does when tapped: his name opens the player sheet, the chevron his evidence line. */
internal class RowActions(
    val open: (SheetPlayer) -> Unit,
    val toggleWhy: (String) -> Unit,
    val opened: Set<String>,
)

/** The Lineup's one table (web LineupTable.svelte): the heads, the lineup the advice sets with its
 * evidence lines, the spots no one can play, the Team row lit like the score bug. */
@Composable
internal fun LineupTable(
    model: StartModel,
    actions: RowActions,
) {
    TableFrame {
        HeadRow()
        model.starters.forEach { LineupRow(it, bench = false, actions = actions) }
        model.empty.forEach { EmptyRow(it) }
        TeamRowView(model.team)
    }
}

/** The bench and the injured reserve (the table's second and third bodies on the web). */
@Composable
internal fun BenchTable(
    model: StartModel,
    actions: RowActions,
) {
    TableFrame {
        SectionRow(Words.Box.bench)
        if (model.bench.isEmpty()) NoteRow(Words.InSeason.noBench)
        model.bench.forEach { LineupRow(it, bench = true, actions = actions) }
        if (model.reserve.isNotEmpty()) {
            SectionRow(Words.Box.reserve)
            model.reserve.forEach { LineupRow(it, bench = true, actions = actions) }
        }
    }
}

/** The table's surface, hairline and corners. */
@Composable
private fun TableFrame(content: @Composable ColumnScope.() -> Unit) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.line, shape),
        content = content,
    )
}

@Composable
internal fun Hairline() = HorizontalDivider(color = CommishTheme.colors.line)

/** The column heads: Slot, Player, Our rank on two lines over the rank alone, Proj, Pts. */
@Composable
private fun HeadRow() {
    val c = CommishTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 34.dp)
            .background(c.bg)
            .padding(horizontal = Tokens.Space.s2.dp)
            .clearAndSetSemantics {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Head(Words.Box.slot, Modifier.width(Column.slot))
        Head(Words.Box.player, Modifier.weight(1f))
        Head(Words.Box.ourRank, Modifier.width(Column.rank))
        Head(Words.Box.proj, Modifier.width(Column.proj), TextAlign.End)
        Head(Words.Box.pts, Modifier.width(Column.pts), TextAlign.End)
        Spacer(Modifier.width(Column.why))
    }
    Hairline()
}

@Composable
private fun Head(
    words: String,
    modifier: Modifier,
    align: TextAlign = TextAlign.Start,
) {
    Text(
        words.uppercase(),
        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em, lineHeight = 12.sp),
        color = CommishTheme.colors.ink3,
        textAlign = align,
        modifier = modifier,
    )
}

/** A section's head inside the table: Bench, Injured reserve. */
@Composable
private fun SectionRow(title: String) {
    val c = CommishTheme.colors
    Text(
        title.uppercase(),
        style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = HEAD_TRACKING.em),
        color = c.ink3,
        modifier =
            Modifier
                .fillMaxWidth()
                .background(c.bg)
                .heightIn(min = 32.dp)
                .padding(horizontal = Tokens.Space.s3.dp)
                .wrapCenter()
                .semantics { heading() },
    )
    Hairline()
}

/** A line of words across the table: the bench with nobody on it. */
@Composable
private fun NoteRow(text: String) {
    Text(text, style = Faces.small, color = CommishTheme.colors.ink2, modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s3.dp))
    Hairline()
}

/** A spot empty on the platform that no one who can play fills: its slot, the sentence, no figures. */
@Composable
private fun EmptyRow(slot: String) {
    val c = CommishTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .background(idleGround())
            .padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            slot,
            style = Faces.cell.copy(fontSize = Tokens.Type.md.sp, fontWeight = FontWeight.Bold),
            color = c.ink2,
            modifier = Modifier.width(Column.slot),
        )
        Text(Words.Lineup.noOneHere, style = Faces.small, color = c.ink3, modifier = Modifier.weight(1f))
        Figure(Words.Box.none, Column.proj, muted = true)
        Figure(Words.Box.none, Column.pts, muted = true)
        Spacer(Modifier.width(Column.why))
    }
    Hairline()
}

/** The ground of a spot no one can play: the loss's wash on the surface. */
@Composable
internal fun idleGround(): Color =
    CommishTheme.colors.lossBg
        .copy(alpha = IDLE_TINT)
        .compositeOver(CommishTheme.colors.surface)

/** The Team row, lit like the score bug (TeamFigures.svelte): before kickoff the Proj big and the Pts
 * small; from kickoff the Pts big and the projected final small under its caption. */
@Composable
private fun TeamRowView(team: TeamRow) {
    val c = CommishTheme.colors
    val (ink, ink2, num) = Triple(c.scoreboardInk, c.scoreboardInk2, c.scoreboardNum)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .background(c.scoreboard)
            .padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                Words.Box.totals.uppercase(),
                style = Faces.cell.copy(fontWeight = FontWeight.Bold, letterSpacing = HEAD_TRACKING.em),
                color = ink,
            )
            team.note?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = ink2) }
        }
        Column(Modifier.width(Column.proj), horizontalAlignment = Alignment.End) {
            team.caption?.let {
                // The caption runs past the narrow column to its left rather than cut, as the web's does.
                Text(
                    it.uppercase(),
                    style = Faces.label,
                    color = ink2,
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.wrapContentWidth(Alignment.End, unbounded = true),
                )
            }
            TeamFigure(team.proj, big = !team.live, if (!team.live) num else ink2)
        }
        Column(Modifier.width(Column.pts), horizontalAlignment = Alignment.End) {
            TeamFigure(team.pts, big = team.live, if (team.live) num else ink2)
        }
        Spacer(Modifier.width(Column.why))
    }
}

@Composable
private fun TeamFigure(
    text: String,
    big: Boolean,
    color: Color,
) {
    Text(
        text,
        style = if (big) Faces.figure else Faces.cell.copy(fontWeight = FontWeight.Bold),
        color = color,
        maxLines = 1,
        softWrap = false,
    )
}

/** A figure cell: one decimal in the number face, trailing, "--" quiet. */
@Composable
internal fun Figure(
    text: String,
    width: Dp,
    muted: Boolean = text == Words.Box.none,
) {
    Text(
        text,
        style = Faces.cell.copy(fontWeight = FontWeight.Medium),
        color = if (muted) CommishTheme.colors.ink3 else CommishTheme.colors.ink,
        textAlign = TextAlign.End,
        maxLines = 1,
        modifier = Modifier.width(width),
    )
}
