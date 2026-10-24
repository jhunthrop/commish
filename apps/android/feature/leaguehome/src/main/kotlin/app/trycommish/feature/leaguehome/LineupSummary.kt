package app.trycommish.feature.leaguehome

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.trycommish.core.leaguehome.LineupSummary
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Pill
import app.trycommish.design.Section
import app.trycommish.design.Tokens
import app.trycommish.design.Words

private val SLOT_W = 48.dp
private val VERB_H = 48.dp

/** The member's lineup as the platform has it set: each starter's position, name and club, the bench
 * as a count, and the screen's one verb. */
@Composable
internal fun LineupSummary(
    lineup: LineupSummary,
    onOpenLineup: () -> Unit,
) {
    val c = CommishTheme.colors
    Section(Words.LeagueHome.yourLineup, lineup.team) {
        Column(Modifier.padding(horizontal = Tokens.Space.s2.dp)) {
            lineup.starters.forEach { line ->
                Row(
                    Modifier.fillMaxWidth().height(40.dp).padding(horizontal = Tokens.Space.s2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                ) {
                    Box(Modifier.width(SLOT_W)) { Pill(line.position) }
                    Text(
                        line.name,
                        style = Faces.body,
                        color = c.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(line.club, style = Faces.small, color = c.ink3)
                }
                HorizontalDivider(color = c.line)
            }
            Text(
                lineup.bench,
                style = Faces.small,
                color = c.ink3,
                modifier = Modifier.padding(horizontal = Tokens.Space.s2.dp, vertical = Tokens.Space.s2.dp),
            )
            Button(
                onClick = onOpenLineup,
                shape = RoundedCornerShape(Tokens.Radius.md.dp),
                modifier = Modifier.fillMaxWidth().height(VERB_H).padding(horizontal = Tokens.Space.s2.dp),
            ) {
                Text(Words.LeagueHome.openLineup, style = Faces.body)
            }
        }
    }
}
