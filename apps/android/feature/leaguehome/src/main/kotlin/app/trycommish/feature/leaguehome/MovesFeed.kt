package app.trycommish.feature.leaguehome

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.leaguehome.FeedPlayer
import app.trycommish.core.leaguehome.MoveRow
import app.trycommish.core.leaguehome.MovesFeed
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.MoveMark
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.Section
import app.trycommish.design.Tokens
import app.trycommish.design.Words

/** The league's moves, newest first: each stacks its kind, its team and its time, then its players in
 * and out and a claim's bid; the member's own on the accent wash. A quiet league reads one sentence. */
@Composable
internal fun MovesFeed(feed: MovesFeed) {
    val c = CommishTheme.colors
    Section(Words.LeagueHome.moves, Words.LeagueHome.movesAside) {
        HorizontalDivider(color = c.lineStrong)
        feed.empty?.let {
            Text(it, style = Faces.body, color = c.ink2, modifier = Modifier.padding(Tokens.Space.s4.dp))
        }
        feed.rows.forEach { row ->
            Move(row)
            HorizontalDivider(color = c.line)
        }
    }
}

@Composable
private fun Move(row: MoveRow) {
    val c = CommishTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .then(if (row.mine) Modifier.background(c.accentWash) else Modifier)
            .padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Pill(row.kind, if (row.kind == Words.MoveKind.trade) PillTone.Accent else PillTone.Plain)
            Text(
                row.teams.joinToString(", "),
                style = Faces.body,
                color = c.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(row.whenText, style = Faces.small, color = c.ink3)
        }
        row.adds.forEach { Player(it, into = if (row.kind == Words.MoveKind.trade) null else true) }
        row.drops.forEach { Player(it, into = false) }
        if (row.detail.isNotEmpty()) Text(row.detail, style = Faces.small, color = c.ink2)
    }
}

@Composable
private fun Player(
    player: FeedPlayer,
    into: Boolean?,
) {
    val c = CommishTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (into != null) MoveMark(into)
        Text(player.name, style = Faces.body, color = if (into == false) c.ink2 else c.ink)
        Text("${player.club} ${player.position}", style = Faces.small, color = c.ink3)
        player.to?.let {
            Text(
                "${AppWords.to} $it",
                style = Faces.small,
                color = c.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
