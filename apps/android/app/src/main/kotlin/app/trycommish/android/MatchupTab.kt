package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.AppWords
import app.trycommish.core.matchup.MatchupModel
import app.trycommish.core.matchup.MatchupState
import app.trycommish.core.matchup.MatchupViewModel
import app.trycommish.core.shell.SheetOffer
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.ShellState
import app.trycommish.design.Words
import app.trycommish.feature.matchup.MatchupActions
import app.trycommish.feature.matchup.MatchupScreen
import app.trycommish.feature.shell.LocalPlayerSheet

/** The Matchup tab: the week of the league the shell shows; with none to show, the sentence for why
 * (none followed, or nothing kept and no connection). */
@Composable
fun MatchupTab(
    graph: AppGraph,
    shell: ShellState,
    onRetry: () -> Unit,
    openLineup: () -> Unit,
) {
    val league = (shell as? ShellState.Ready)?.selected
    if (league != null) {
        LeagueMatchup(graph, GameOf(league.id, roster = null), openLineup)
        return
    }
    val waiting =
        when (shell) {
            ShellState.Restoring -> MatchupState.Loading
            ShellState.SignedOut -> MatchupState.SignedOut
            ShellState.Unreachable -> MatchupState.Failed(AppWords.cannotLoad)
            is ShellState.Ready -> MatchupState.Failed(AppWords.followNone)
        }
    MatchupScreen(waiting, null, refreshing = false, actions = MatchupActions(refresh = onRetry))
}

/** The sheet's verb on the Matchup (MatchupPanel.svelte's lineupOffer): the way to the member's lineup on
 * his own rows, none on the opponent's. */
private fun lineupOffer(
    state: MatchupState,
    player: SheetPlayer,
    openLineup: () -> Unit,
): SheetOffer? {
    val week = ((state as? MatchupState.Loaded)?.model as? MatchupModel.Week)?.week ?: return null
    return if (week.isMine(player)) SheetOffer(Words.Card.openLineup, null, lineup = true, act = openLineup) else null
}

/** The game a Matchup shows: the league's, the member's own (`roster` null) or another team's by its first
 * side's roster (pushed from its score bug, Lane 207). */
data class GameOf(
    val leagueId: String,
    val roster: Int?,
)

/** Another team's game, pushed from its score bug: the same screen as the Matchup tab's, none of the
 * member's verbs (no row of his, so the sheet offers no lineup), its whose line's Your game opening the
 * member's own. */
@Composable
fun GameScreen(
    graph: AppGraph,
    game: GameOf,
    openLineup: () -> Unit,
    yourGame: () -> Unit,
) = LeagueMatchup(graph, game, openLineup, yourGame)

/** One game's Matchup, its own view model per league and roster: the saved week at once, then the API's. While
 * the tab is on screen with the app started it reads again once a minute; it stops when the tab is left,
 * the app goes to the background, or the screen is torn down (the view model is cleared with it). A pull
 * reads again; a row's name opens the one player sheet by his id, which keeps its player as the week
 * reads again under it. */
@Composable
private fun LeagueMatchup(
    graph: AppGraph,
    game: GameOf,
    openLineup: () -> Unit,
    yourGame: () -> Unit = {},
) {
    val vm: MatchupViewModel =
        viewModel(key = "matchup-${game.leagueId}-${game.roster}") { graph.matchupViewModel(game.roster) }
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    val id = game.leagueId
    // Started and on screen: visible. Stopped (backgrounded, another tab) or left: hidden.
    LifecycleStartEffect(id) {
        vm.setVisible(true, id)
        onStopOrDispose { vm.setVisible(false, id) }
    }
    LaunchedEffect(state) {
        val week = ((state as? MatchupState.Loaded)?.model as? MatchupModel.Week)?.week
        week?.let { sheet.parentRefreshed(it.sheetPlayers) }
    }
    MatchupScreen(
        state = state,
        stamp = vm.stampWords(state),
        refreshing = refreshing && state is MatchupState.Loaded,
        actions =
            MatchupActions(
                open = { sheet.open(it, lineupOffer(state, it, openLineup)) },
                refresh = { vm.load(id) },
                yourGame = yourGame,
            ),
    )
}
