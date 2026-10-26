package app.trycommish.feature.leaguehome

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.core.leaguehome.DraftDayEntry
import app.trycommish.core.leaguehome.LeagueHomeModel
import app.trycommish.core.leaguehome.LeagueHomeState
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Mark
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.Tokens
import java.time.Instant
import java.time.ZoneId

/**
 * The League home (web route /league/[id]): the week's scoreboard, the standings, the member's lineup
 * and the league's moves, in the web's order, under the league's name and the answer's stamp. Pull
 * down to read again. The screen's one verb is Open Lineup; a score bug opens its game (`onOpenGame`, null
 * for the member's, else the roster of the game's first side).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeagueHomeScreen(
    state: LeagueHomeState,
    zone: ZoneId,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onOpenLineup: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenGame: (Int?) -> Unit = {},
    draftDay: DraftDay? = null,
) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        modifier = modifier.fillMaxSize().background(CommishTheme.colors.bg),
    ) {
        when (state) {
            LeagueHomeState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            is LeagueHomeState.Failed -> Failed(state.message)
            is LeagueHomeState.Loaded -> Loaded(state.model, stampText(state.stamp, state.stale, zone), onOpenLineup, onOpenGame, draftDay)
            LeagueHomeState.SignedOut -> Failed(AppWords.signedOut)
        }
    }
}

/** "Read Sun 1:56 pm", or the kept answer's instant while there is no connection. */
private fun stampText(
    stamp: Instant,
    stale: Boolean,
    zone: ZoneId,
): String = "${if (stale) AppWords.offline else AppWords.read} ${Format.weekdayTime(stamp, zone)}"

@Composable
private fun Failed(message: String) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Mark(size = 48.dp)
        Spacer(Modifier.height(Tokens.Space.s4.dp))
        Text(message, style = Faces.body, color = CommishTheme.colors.ink2, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Loaded(
    model: LeagueHomeModel,
    stamp: String,
    onOpenLineup: () -> Unit,
    onOpenGame: (Int?) -> Unit,
    draftDay: DraftDay?,
) {
    LeagueHomePage(model, stamp, onOpenLineup, Modifier.fillMaxSize().verticalScroll(rememberScrollState()), onOpenGame, draftDay)
}

/** The followed league's draft day on its home: the entry the web's SeasonPanel draws, and its verb. */
class DraftDay(
    val entry: DraftDayEntry,
    val openAdvisor: () -> Unit,
)

/** The page itself, every section at its full height: the screen scrolls it, a snapshot draws it whole.
 * A page of six games, twelve teams, ten starters and two weeks of moves needs no lazy list. */
@Composable
fun LeagueHomePage(
    model: LeagueHomeModel,
    stamp: String,
    onOpenLineup: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenGame: (Int?) -> Unit = {},
    draftDay: DraftDay? = null,
) {
    Column(modifier.background(CommishTheme.colors.bg)) {
        Head(model, stamp)
        draftDay?.let { DraftDayPanel(it.entry, it.openAdvisor) }
        if (model.games.isNotEmpty()) ScoreBoard(model.week, model.games, onOpenGame)
        Standings(model.standings)
        LineupSummary(model.lineup, onOpenLineup)
        model.moves?.let { MovesFeed(it) }
        Spacer(Modifier.height(Tokens.Space.s6.dp))
    }
}

/** The stamp a page shows for its answer. */
fun leagueHomeStamp(
    stamp: Instant,
    stale: Boolean,
    zone: ZoneId,
): String = stampText(stamp, stale, zone)

@Composable
private fun Head(
    model: LeagueHomeModel,
    stamp: String,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Pill(model.platform, PillTone.Accent)
            Pill(model.week)
            Text(stamp, style = Faces.small, color = c.ink3, modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(Tokens.Space.s2.dp))
        Text(model.name, style = Faces.head.copy(fontSize = Faces.section.fontSize * 1.4f), color = c.ink, maxLines = 2)
    }
}
