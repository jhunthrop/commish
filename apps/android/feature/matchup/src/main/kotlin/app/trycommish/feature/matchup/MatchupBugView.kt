package app.trycommish.feature.matchup

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.matchup.BugTeam
import app.trycommish.core.matchup.MatchupBug
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.HEAD_TRACKING

private const val HEAD_FACE_TRACKING = 0.04

/** The matchup's score bug on the lit board (MatchupBug.svelte at 390): across its top the week, the
 * game's head and its words and the read beside a live score, centred; under it the two teams side by
 * side, each with You or Opponent (neither on another team's game), its name, where its starters stand, its big figure and the small one;
 * across its foot the API's line on where the member stands. The member's figure in the board's number
 * colour. */
@Composable
internal fun MatchupBugView(bug: MatchupBug) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.scoreboard)
            .border(1.dp, c.scoreboardLine, shape),
    ) {
        TopLine(bug)
        Rule()
        // The two sides as tall as the taller, with the board's rule between them.
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            Side(bug.mine, leading = true, Modifier.weight(1f))
            bug.opponent?.let { opponent ->
                Box(Modifier.width(1.dp).fillMaxHeight().background(c.scoreboardLine))
                Side(opponent, leading = false, Modifier.weight(1f))
            }
        }
        bug.standing?.let { standing ->
            Rule()
            Text(
                standing,
                style = Faces.small.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"),
                color = c.scoreboardInk,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp, horizontal = Tokens.Space.s3.dp),
            )
        }
    }
}

@Composable
private fun Rule() = Box(Modifier.fillMaxWidth().height(1.dp).background(CommishTheme.colors.scoreboardLine))

/** "Week 6 · Next kickoff · Sun 3:05 pm, ARI at LAR · FFPC 4 min ago", wrapping between its parts, each
 * line centred as the web's is at 390. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TopLine(bug: MatchupBug) {
    val c = CommishTheme.colors
    FlowRow(
        Modifier
            .fillMaxWidth()
            .background(c.scoreboard2)
            .padding(vertical = 6.dp, horizontal = Tokens.Space.s3.dp),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp, Alignment.CenterHorizontally),
    ) {
        val centred = Modifier.align(Alignment.CenterVertically)
        Text(bug.week.uppercase(), style = label(), color = c.scoreboardInk2, modifier = centred)
        bug.head?.let { head ->
            Text(
                head.uppercase(),
                style = Faces.number(NumWeight.Bold).copy(letterSpacing = HEAD_FACE_TRACKING.em),
                color = c.scoreboardInk,
                modifier = centred,
            )
            if (bug.words.isNotEmpty()) {
                Text(
                    bug.words,
                    style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                    color = c.scoreboardInk2,
                    modifier = centred,
                )
            }
        }
        bug.read?.let { read ->
            Text(
                read,
                style = Faces.label.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.sp, fontFeatureSettings = "tnum"),
                color = c.scoreboardInk,
                modifier = centred,
            )
        }
    }
}

@Composable
private fun label() = Faces.label.copy(fontWeight = FontWeight.SemiBold, letterSpacing = HEAD_TRACKING.em)

/** One team: the second reads from the right edge in, as the web's does. */
@Composable
private fun Side(
    team: BugTeam,
    leading: Boolean,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val align = if (leading) Alignment.Start else Alignment.End
    val text = if (leading) TextAlign.Start else TextAlign.End
    Column(
        modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        horizontalAlignment = align,
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) {
        if (team.label.isNotEmpty()) Text(team.label.uppercase(), style = label(), color = c.scoreboardInk2)
        Text(
            team.name,
            style = Faces.small.copy(fontWeight = FontWeight.Bold),
            color = c.scoreboardInk,
            textAlign = text,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        if (team.toPlay.isNotEmpty()) {
            Text(team.toPlay, style = label().copy(letterSpacing = 0.sp), color = c.scoreboardNum)
        }
        Spacer(Modifier.weight(1f))
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "${team.bigLabel} ${team.big} ${team.small}" },
        ) {
            Text(
                team.big,
                style = Faces.head,
                color = if (team.me) c.scoreboardNum else c.scoreboardInk,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.alignByBaseline(),
            )
            if (team.small.isNotEmpty()) {
                Text(
                    team.small,
                    style = Faces.number(NumWeight.Medium, Tokens.Type.sm.sp),
                    color = c.scoreboardInk2,
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.alignByBaseline(),
                )
            }
        }
    }
}
