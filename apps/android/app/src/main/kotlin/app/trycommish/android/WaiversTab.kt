package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalUriHandler
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.AppWords
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.SheetOffer
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.ShellState
import app.trycommish.core.waivers.WaiverPin
import app.trycommish.core.waivers.WaiverState
import app.trycommish.core.waivers.WaiverUi
import app.trycommish.core.waivers.WaiverViewModel
import app.trycommish.feature.shell.LocalPlayerSheet
import app.trycommish.feature.waivers.WaiverActions
import app.trycommish.feature.waivers.WaiverPinActions
import app.trycommish.feature.waivers.WaiverScreen

/** The Waivers tab: the players free to add in the league the shell shows; with none to show, the
 * sentence for why (none followed, or nothing kept and no connection). */
@Composable
fun WaiversTab(
    graph: AppGraph,
    shell: ShellState,
    onRetry: () -> Unit,
) {
    val league = (shell as? ShellState.Ready)?.selected
    if (league != null) {
        LeagueWaivers(graph, league)
        return
    }
    val waiting =
        when (shell) {
            ShellState.Restoring -> WaiverState.Loading
            ShellState.SignedOut -> WaiverState.SignedOut
            ShellState.Unreachable -> WaiverState.Failed(AppWords.cannotLoad)
            is ShellState.Ready -> WaiverState.Failed(AppWords.followNone)
        }
    WaiverScreen(WaiverUi(waiting), null, WaiverPin(), refreshing = false, actions = WaiverActions(refresh = onRetry))
}

/** The sheet's verb on Waivers (WaiverScreen.svelte's shelfOffer): the claim in the screen's words with
 * the pair and its gain under it, made from his row. */
private fun claimOffer(
    state: WaiverState,
    player: SheetPlayer,
    claim: (String) -> Unit,
): SheetOffer? {
    val model = (state as? WaiverState.Loaded)?.model ?: return null
    val row = model.rows.firstOrNull { it.sheetPlayer?.id == player.id } ?: return null
    val (label, line) = model.sheetOffer(row)
    return SheetOffer(label, line, lineup = false) { claim(row.key) }
}

/** One league's Waivers, its own view model per league: the saved answer at once, then the API's; a
 * pull reads again; a row's name opens the one player sheet by the row's key, which keeps its player as
 * the table reads again under it; a chip reads its position; a typed bid is planned again once it rests;
 * the platform's page opened in the browser with his name on the clipboard. */
@Composable
private fun LeagueWaivers(
    graph: AppGraph,
    league: FollowedLeague,
) {
    val vm: WaiverViewModel = viewModel(key = "waivers-${league.id}") { graph.waiverViewModel(league.host) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    val uri = LocalUriHandler.current
    val id = league.id
    LaunchedEffect(id) { if (vm.shown != id) vm.load(id) }
    LaunchedEffect(ui.state) { (ui.state as? WaiverState.Loaded)?.let { sheet.parentRefreshed(it.model.sheetPlayers) } }
    WaiverScreen(
        ui = ui,
        stamp = vm.stampWords(ui),
        pin = vm.pin(ui),
        refreshing = refreshing && ui.state is WaiverState.Loaded,
        actions =
            WaiverActions(
                open = { player -> sheet.open(player, claimOffer(ui.state, player) { key -> vm.claimFromSheet(key, id) }) },
                chooseCard = vm::chooseCard,
                tapRow = vm::tapRow,
                chooseDrop = vm::chooseDrop,
                choosePosition = { vm.choosePosition(it, id) },
                find = vm::find,
                sortBy = vm::sortBy,
                choosePanelMode = vm::choosePanelMode,
                toggleCard = vm::toggleCard,
                addFromPanel = { vm.addFromPanel(it, id) },
                refresh = { vm.load(id) },
                pin =
                    WaiverPinActions(
                        press = { vm.press(id) },
                        confirm = { vm.confirm(id) },
                        close = vm::close,
                        openPage = uri::openUri,
                        bid = { vm.typeBid(id, it) },
                    ),
            ),
    )
}
