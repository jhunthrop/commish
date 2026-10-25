package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalUriHandler
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.AppWords
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.ShellState
import app.trycommish.core.shell.SiteLinks
import app.trycommish.core.start.StartPin
import app.trycommish.core.start.StartState
import app.trycommish.core.start.StartUi
import app.trycommish.core.start.StartViewModel
import app.trycommish.feature.shell.LocalPlayerSheet
import app.trycommish.feature.start.PinActions
import app.trycommish.feature.start.StartActions
import app.trycommish.feature.start.StartScreen

/** The Lineup tab: the Start screen of the league the shell shows; with none to show, the sentence for
 * why (none followed, or nothing kept and no connection). */
@Composable
fun StartTab(
    graph: AppGraph,
    shell: ShellState,
    onRetry: () -> Unit,
) {
    val league = (shell as? ShellState.Ready)?.selected
    if (league != null) {
        LeagueStart(graph, league)
        return
    }
    val waiting =
        when (shell) {
            ShellState.Restoring -> StartState.Loading
            ShellState.SignedOut -> StartState.SignedOut
            ShellState.Unreachable -> StartState.Failed(AppWords.cannotLoad)
            is ShellState.Ready -> StartState.Failed(AppWords.followNone)
        }
    val nothing = StartPin(null, false, emptyList(), null)
    StartScreen(StartUi(waiting), null, nothing, refreshing = false, actions = StartActions(refresh = onRetry))
}

/** One league's Start screen, its own view model per league: the saved lineup at once, then the API's;
 * a pull reads again; a row's name opens the one player sheet, which keeps its player as the lineup reads
 * again under it; the lineup copied to the phone's clipboard; a platform's page opened in the browser. */
@Composable
private fun LeagueStart(
    graph: AppGraph,
    league: FollowedLeague,
) {
    val vm: StartViewModel = viewModel(key = "start-${league.id}") { graph.startViewModel(league.host) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    val uri = LocalUriHandler.current
    val id = league.id
    LaunchedEffect(id) { if (vm.shown != id) vm.load(id) }
    LaunchedEffect(ui.state) { (ui.state as? StartState.Loaded)?.let { sheet.parentRefreshed(it.model.sheetPlayers) } }
    StartScreen(
        ui = ui,
        stamp = vm.stampWords(ui),
        pin = vm.pin(ui),
        refreshing = refreshing && ui.state is StartState.Loaded,
        actions =
            StartActions(
                open = sheet::open,
                toggleWhy = vm::toggleWhy,
                openRecord = { uri.openUri(SiteLinks.RECORD) },
                refresh = { vm.load(id) },
                pin =
                    PinActions(
                        press = { vm.press(id) },
                        confirm = { vm.confirm(id) },
                        close = vm::close,
                        openPage = uri::openUri,
                    ),
            ),
    )
}
