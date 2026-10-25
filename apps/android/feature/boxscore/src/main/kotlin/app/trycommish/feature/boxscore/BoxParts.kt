package app.trycommish.feature.boxscore

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
import app.trycommish.core.start.TeamRow
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words

/** The phone's columns (BoxTable.svelte at 390): the slot, the player taking the rest, Our rank, Proj,
 * Pts and the cell that opens a swap's evidence line. */
object BoxColumn {
    val slot = 44.dp
    val rank = 36.dp
    val proj = 50.dp
    val pts = 42.dp
    val why = 30.dp
    val face = 28.dp
}

/** What a box draws beyond the shared columns: the Lineup's evidence line under each player and its why
 * cell; the Matchup draws neither, as the web's matchup box does not. */
data class BoxStyle(
    val evidence: Boolean,
    val why: Boolean,
) {
    companion object {
        val Lineup = BoxStyle(evidence = true, why = true)
        val Matchup = BoxStyle(evidence = false, why = false)
    }
}

/** What a row does when tapped: his name opens the player sheet, the chevron his evidence line. */
class RowActions(
    val open: (SheetPlayer) -> Unit,
    val toggleWhy: (String) -> Unit = {},
    val opened: Set<String> = emptySet(),
)

const val HEAD_TRACKING = 0.06
private const val IDLE_TINT = 0.35f

/** The table's surface, hairline and corners. */
@Composable
fun TableFrame(content: @Composable ColumnScope.() -> Unit) {
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
fun Hairline() = HorizontalDivider(color = CommishTheme.colors.line)

/** The column heads: Slot, Player, Our rank on two lines over the rank alone, Proj, Pts. */
@Composable
fun HeadRow(style: BoxStyle = BoxStyle.Lineup) {
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
        Head(Words.Box.slot, Modifier.width(BoxColumn.slot))
        Head(Words.Box.player, Modifier.weight(1f))
        Head(Words.Box.ourRank, Modifier.width(BoxColumn.rank))
        Head(Words.Box.proj, Modifier.width(BoxColumn.proj), TextAlign.End)
        Head(Words.Box.pts, Modifier.width(BoxColumn.pts), TextAlign.End)
        if (style.why) Spacer(Modifier.width(BoxColumn.why))
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
fun SectionRow(title: String) {
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

/** A line of words across the table: the bench with nobody on it, starters a platform does not send. */
@Composable
fun NoteRow(text: String) {
    Text(text, style = Faces.small, color = CommishTheme.colors.ink2, modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s3.dp))
    Hairline()
}

/** The ground of a spot no one can play: the loss's wash on the surface. */
@Composable
fun idleGround(): Color =
    CommishTheme.colors.lossBg
        .copy(alpha = IDLE_TINT)
        .compositeOver(CommishTheme.colors.surface)

/** The Team row, lit like the score bug (TeamFigures.svelte): before kickoff the Proj big and the Pts
 * small; from kickoff the Pts big and the projected final small under its caption. */
@Composable
fun TeamRowView(
    team: TeamRow,
    style: BoxStyle = BoxStyle.Lineup,
) {
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
                style = Faces.number(NumWeight.Bold).copy(letterSpacing = HEAD_TRACKING.em),
                color = ink,
            )
            team.note?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = ink2) }
        }
        Column(Modifier.width(BoxColumn.proj), horizontalAlignment = Alignment.End) {
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
        Column(Modifier.width(BoxColumn.pts), horizontalAlignment = Alignment.End) {
            TeamFigure(team.pts, big = team.live, if (team.live) num else ink2)
        }
        if (style.why) Spacer(Modifier.width(BoxColumn.why))
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
        style = if (big) Faces.figure else Faces.number(NumWeight.Bold),
        color = color,
        maxLines = 1,
        softWrap = false,
    )
}

/** A figure cell: one decimal in the number face, trailing, "--" quiet. */
@Composable
fun Figure(
    text: String,
    width: Dp,
    muted: Boolean = text == Words.Box.none,
) {
    Text(
        text,
        style = Faces.number(NumWeight.Medium),
        color = if (muted) CommishTheme.colors.ink3 else CommishTheme.colors.ink,
        textAlign = TextAlign.End,
        maxLines = 1,
        modifier = Modifier.width(width),
    )
}

/** What the numbers are, said once under the rows, in the interface's face at the box score's size (the
 * reading face reads as a document in season); a screen's notes in the same voice. */
@Composable
fun BasisText(text: String) {
    Text(
        text,
        style = Faces.label.copy(fontWeight = Faces.small.fontWeight, letterSpacing = Faces.small.letterSpacing),
        color = CommishTheme.colors.ink3,
    )
}
