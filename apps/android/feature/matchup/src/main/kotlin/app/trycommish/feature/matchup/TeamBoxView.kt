package app.trycommish.feature.matchup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.trycommish.core.matchup.TeamBox
import app.trycommish.design.Avatar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BoxRow
import app.trycommish.feature.boxscore.BoxStyle
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.HeadRow
import app.trycommish.feature.boxscore.NoteRow
import app.trycommish.feature.boxscore.RowActions
import app.trycommish.feature.boxscore.SectionRow
import app.trycommish.feature.boxscore.TableFrame
import app.trycommish.feature.boxscore.TeamRowView

private val HEAD_RULE = 2.dp
private val TEAM_FACE = 32.dp

/** One team's box (BoxTable.svelte at 390): its name with its face over the columns (Slot, Player, Our
 * rank, Proj, Pts), its starters, the sentence in place of starters the platform does not send, the Team
 * row lit like the bug, then its bench in the same columns. The member's rule in the accent. */
@Composable
internal fun TeamBoxView(
    box: TeamBox,
    actions: RowActions,
) {
    TableFrame {
        TeamHead(box)
        HeadRow(BoxStyle.Matchup)
        box.empty?.let { NoteRow(it) }
        box.starters.forEach { BoxRow(it, bench = false, actions = actions, style = BoxStyle.Matchup) }
        TeamRowView(box.teamRow, BoxStyle.Matchup)
        if (box.bench.isNotEmpty()) {
            SectionRow(Words.Box.bench)
            box.bench.forEach { BoxRow(it, bench = true, actions = actions, style = BoxStyle.Matchup) }
        }
    }
}

/** The box's head: the team's face, its name, "You" on the member's own, over a rule in the accent. */
@Composable
private fun TeamHead(box: TeamBox) {
    val c = CommishTheme.colors
    val rule = if (box.mine) c.accent else c.lineStrong
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.bg)
            .drawBehind {
                val y = size.height - HEAD_RULE.toPx() / 2
                drawLine(rule, Offset(0f, y), Offset(size.width, y), HEAD_RULE.toPx())
            }.padding(Tokens.Space.s3.dp)
            .semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        Avatar(box.initials, TEAM_FACE, mine = box.mine)
        Text(box.team, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink, modifier = Modifier.weight(1f, fill = false))
        if (box.mine) {
            Text(
                Words.Box.you.uppercase(),
                style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = HEAD_TRACKING.em),
                color = c.accentText,
            )
        }
    }
}
