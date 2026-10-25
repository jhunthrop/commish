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
import app.trycommish.feature.trades.BuilderActions
import app.trycommish.feature.trades.TradeActions
import app.trycommish.feature.trades.TradesScreen

/** The Trades tab: the trade finder and builder in the league the shell shows; with none to show, the
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

/** One league's Trades, its own view model per league: the saved finder at once, then the API's; a pull
 * reads again; a row's name opens the one player sheet by his id, which keeps its player as the finder
 * reads again under it; the picker reads the trades holding a player; the builder posts its check as
 * picks land; a verb copies the offer to the clipboard and opens the platform's trade page. */
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
    LaunchedEffect(ui.state) { (ui.state as? TradesState.Loaded)?.let { sheet.parentRefreshed(it.model.sheetPlayers) } }
    TradesScreen(
        ui = ui,
        stamp = vm.stampWords(ui),
        refreshing = refreshing && ui.state is TradesState.Loaded,
        actions =
            TradeActions(
                open = sheet::open,
                toggle = vm::toggle,
                press = vm::press,
                showEvery = vm::showEvery,
                sort = vm::sortBy,
                pick = { vm.pick(it, id) },
                refresh = { vm.load(id) },
                builder =
                    BuilderActions(
                        new = vm::buildNew,
                        from = { vm.buildFrom(it, id) },
                        close = vm::closeBuilder,
                        team = { vm.chooseTeam(it, id) },
                        tap = { side, player -> vm.tap(side, player, id) },
                        press = vm::pressBuilder,
                    ),
            ),
    )
}
