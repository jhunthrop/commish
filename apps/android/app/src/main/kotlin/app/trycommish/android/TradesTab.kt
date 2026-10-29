package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.AppWords
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.ShellState
import app.trycommish.core.trades.TradesState
import app.trycommish.core.trades.TradesUi
import app.trycommish.core.trades.TradesViewModel
import app.trycommish.feature.shell.LocalPlayerSheet
import app.trycommish.feature.trades.TradeActions
import app.trycommish.feature.trades.TradesScreen

/** The Trades tab: the builder, our ideas its presets, in the league the shell shows; with none to show, the
 * sentence for why (none followed, or nothing kept and no connection). */
@Composable
fun TradesTab(
    graph: AppGraph,
    shell: ShellState,
    onRetry: () -> Unit,
) {
    val league = (shell as? ShellState.Ready)?.selected
    if (league != null) {
        LeagueTrades(graph, league)
        return
    }
    val waiting =
        when (shell) {
            ShellState.Restoring -> TradesState.Loading
            ShellState.SignedOut -> TradesState.SignedOut
            ShellState.Unreachable -> TradesState.Failed(AppWords.cannotLoad)
            is ShellState.Ready -> TradesState.Failed(AppWords.followNone)
        }
    TradesScreen(TradesUi(waiting), null, refreshing = false, actions = TradeActions(refresh = onRetry))
}

/** One league's Trades, its own view model per league: the saved trades at once, then the API's; a pull
 * reads again; a row's name opens the one player sheet by his id, which keeps its player as the trades read
 * again under it; an idea loads its ticks and every tick posts the check; the verb copies the offer to the
 * clipboard and opens the platform's trade page, Share copies the trade as text. */
@Composable
private fun LeagueTrades(
    graph: AppGraph,
    league: FollowedLeague,
) {
    val vm: TradesViewModel = viewModel(key = "trades-${league.id}") { graph.tradesViewModel(league) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    val id = league.id
    LaunchedEffect(id) { if (vm.shown != id) vm.load(id) }
    LaunchedEffect(ui.builder?.sheetPlayers) { ui.builder?.let { sheet.parentRefreshed(it.sheetPlayers) } }
    TradesScreen(
        ui = ui,
        stamp = vm.stampWords(ui),
        refreshing = refreshing && ui.state is TradesState.Loaded,
        actions =
            TradeActions(
                open = sheet::open,
                idea = { vm.loadIdea(it, id) },
                more = vm::showAllIdeas,
                show = vm::show,
                team = { vm.chooseTeam(it, id) },
                tap = { side, player -> vm.tap(side, player, id) },
                press = vm::pressBuilder,
                share = vm::share,
                refresh = { vm.load(id) },
            ),
    )
}
