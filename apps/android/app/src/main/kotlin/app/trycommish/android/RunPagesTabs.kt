package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.api.models.SiteSeason
import app.trycommish.core.rankings.RankingsState
import app.trycommish.core.rankings.RankingsViewModel
import app.trycommish.core.record.RecordState
import app.trycommish.core.record.RecordViewModel
import app.trycommish.core.shell.ShellState
import app.trycommish.feature.rankings.RankingsActions
import app.trycommish.feature.rankings.RankingsHead
import app.trycommish.feature.rankings.RankingsScreen
import app.trycommish.feature.record.RecordActions
import app.trycommish.feature.record.RecordScreen
import app.trycommish.feature.shell.LocalPlayerSheet

/** The season names the order's page Rankings (week-names.ts weekNames): the site's regular season,
 * whether or not a league is followed; Players before it, after it and in the NFL's postseason. An
 * unread season reads as in season, as the bar does. */
internal fun inSeason(shell: ShellState): Boolean {
    val season = (shell as? ShellState.Ready)?.season
    return season == null || season == SiteSeason.Phase.in_season
}

/** The Rankings: its own view model per opening (the tab's, or the search's with its letters), which holds
 * the chips and the search while the sheet is open; a row's name opens the one player sheet by his id,
 * which keeps its player as the rows read again under it. */
@Composable
fun RankingsTab(
    graph: AppGraph,
    shell: ShellState,
    query: String,
) {
    val season = inSeason(shell)
    val vm: RankingsViewModel = viewModel(key = "rankings-$season-$query") { graph.rankingsViewModel(season, query) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    LaunchedEffect(vm) { if (ui.state == RankingsState.Loading) vm.load() }
    LaunchedEffect(ui.state) { (ui.state as? RankingsState.Loaded)?.let { sheet.parentRefreshed(it.content.sheetPlayers) } }
    RankingsScreen(
        ui = ui,
        head = RankingsHead(vm.name, vm.lead(ui), vm.stampWords(ui)),
        refreshing = refreshing && ui.state is RankingsState.Loaded,
        actions =
            RankingsActions(
                open = sheet::open,
                choose = { vm.choose(it) },
                find = { vm.find(it) },
                more = { vm.showMore() },
                refresh = { vm.load() },
            ),
    )
}

/** Our record: its own view model, which holds the chips; a pull reads again. */
@Composable
fun RecordTab(graph: AppGraph) {
    val vm: RecordViewModel = viewModel(key = "record") { graph.recordViewModel() }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { if (ui.state == RecordState.Loading) vm.load() }
    RecordScreen(
        ui = ui,
        stamp = vm.stampWords(ui),
        refreshing = refreshing && ui.state is RecordState.Loaded,
        actions =
            RecordActions(
                figure = vm::chooseFigure,
                position = vm::choosePosition,
                draftFigure = vm::chooseDraftFigure,
                refresh = { vm.load() },
            ),
    )
}
