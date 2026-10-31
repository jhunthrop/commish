package app.trycommish.feature.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.trycommish.core.account.AccountLeagueRow
import app.trycommish.core.account.AccountModel
import app.trycommish.core.account.AccountSection
import app.trycommish.core.account.AccountUi
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.Hairline

/** The leagues followed (league/AccountLeagues.svelte) as the web's table reads on a phone: each league's
 * name and team, its record and place, its last read, and Open and Detach; a league detached a moment
 * ago keeps its row with "Detached." and Undo. With none, the web's way to follow one. The follow verb
 * is the app's connect step, so the not-affiliated line sits under it (Lane 310). */
@Composable
internal fun AccountLeagues(
    model: AccountModel,
    ui: AccountUi,
    actions: AccountActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SectionHead(Words.Attached.title, model.leaguesAside)
        val leagues = model.leagues
        when {
            leagues == null -> BasisText(Words.Attached.unread)
            leagues.isEmpty() -> {
                BasisText(Words.Attached.none)
                QuietButton(Words.LeagueSwitch.followFirst) { actions.openLink(SiteLinks.LEAGUE_START) }
                BasisText(Words.NotAffiliated.line)
            }
            else -> {
                Column { leagues.forEach { LeagueRowView(it, ui.busy, actions) } }
                ui.problem?.takeIf { it.section == AccountSection.Leagues }?.let { ProblemText(it.text) }
                if (model.followMore) {
                    QuietButton(Words.LeagueSwitch.followAnother) { actions.openLink(SiteLinks.LEAGUE_START) }
                    BasisText(Words.NotAffiliated.line)
                }
            }
        }
    }
}

/** One league: name and team over the record and place, the last read beside its verbs. */
@Composable
private fun LeagueRowView(
    row: AccountLeagueRow,
    busy: String?,
    actions: AccountActions,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth().padding(top = Tokens.Space.s2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    row.name,
                    style = Faces.body.copy(fontWeight = FontWeight.Bold),
                    color = if (row.detached) c.ink3 else c.ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(row.team, style = Faces.small, color = c.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.record, style = Faces.number(NumWeight.Bold), color = c.ink)
                if (row.place.isNotEmpty()) Text(row.place, style = Faces.label.copy(fontWeight = FontWeight.Normal), color = c.ink3)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
            Text(row.readLine, style = Faces.label.copy(fontWeight = FontWeight.Normal), color = c.ink3, modifier = Modifier.weight(1f))
            if (row.detached) {
                Text(Words.Attached.detached, style = Faces.small, color = c.ink2)
                QuietButton(Words.Attached.undo, enabled = busy == null) { actions.restore(row.id) }
            } else {
                QuietButton(Words.Attached.open) { actions.openLeague(row.id) }
                val verb = if (busy == row.id) Words.Attached.detaching else Words.Attached.detach
                QuietButton(verb, enabled = busy == null) { actions.detach(row.id) }
            }
        }
        Hairline()
    }
}
