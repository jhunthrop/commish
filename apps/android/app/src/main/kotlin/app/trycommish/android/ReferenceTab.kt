package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.reference.AdpModel
import app.trycommish.core.reference.ClubPageModel
import app.trycommish.core.reference.ClubsModel
import app.trycommish.core.reference.CompareModel
import app.trycommish.core.reference.RunScreenState
import app.trycommish.core.reference.RunScreenViewModel
import app.trycommish.core.reference.ScheduleModel
import app.trycommish.core.reference.ScreenAsk
import app.trycommish.core.reference.choose
import app.trycommish.core.reference.chooseFormat
import app.trycommish.core.reference.pressing
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.SheetOffer
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.SiteLinks
import app.trycommish.feature.board.BoardPin
import app.trycommish.feature.reference.AdpActions
import app.trycommish.feature.reference.AdpScreen
import app.trycommish.feature.reference.ClubScreen
import app.trycommish.feature.reference.ClubsScreen
import app.trycommish.feature.reference.CompareActions
import app.trycommish.feature.reference.CompareScreen
import app.trycommish.feature.reference.ReferenceActions
import app.trycommish.feature.reference.RunScreenFrame
import app.trycommish.feature.reference.ScheduleScreen
import app.trycommish.feature.shell.LocalPlayerSheet

/**
 * A reference page pushed on the tab in view (ADP, Compare, the clubs, a club, the schedule), reached as the
 * web links them: its own view model per route, read on open and on a pull. A row opens the one player
 * sheet with Compare as its verb; a link to another reference page pushes it (`link`), any other link opens
 * on the site.
 */
@Composable
fun ReferenceScreen(
    graph: AppGraph,
    route: ShellRoute,
    league: FollowedLeague?,
    link: (String) -> Unit,
) {
    val sheet = LocalPlayerSheet.current
    val actions = ReferenceActions(open = { sheet.open(it, SheetOffer.compare(it, link)) }, link = link)
    when (route) {
        is ShellRoute.Adp -> AdpRoute(viewModel(key = "adp-${route.format}") { graph.adpViewModel(route.format) }, actions, sheet, link)
        is ShellRoute.Compare ->
            CompareRoute(
                viewModel(key = "compare-${route.first}-${route.second}-${league?.id}") {
                    graph.compareViewModel(listOf(route.first, route.second), league)
                },
                actions,
            )
        ShellRoute.Clubs -> ClubsRoute(viewModel(key = "clubs") { graph.clubsViewModel() }, actions)
        is ShellRoute.Club -> ClubRoute(viewModel(key = "club-${route.abbr}") { graph.clubViewModel(route.abbr) }, actions, sheet, link)
        ShellRoute.Schedule -> ScheduleRoute(viewModel(key = "schedule") { graph.scheduleViewModel() }, actions, link)
        else -> Unit
    }
}

/** The view model's state and its read on open. */
@Composable
private fun <Model> RunScreenViewModel<Model>.collected(): Triple<RunScreenState<Model>, String?, Boolean> {
    val state by state.collectAsStateWithLifecycle()
    val notice by notice.collectAsStateWithLifecycle()
    val refreshing by refreshing.collectAsStateWithLifecycle()
    LaunchedEffect(this) { if (this@collected.state.value == RunScreenState.Loading) load() }
    return Triple(state, staleWords(state, notice), refreshing)
}

@Composable
private fun AdpRoute(
    vm: RunScreenViewModel<AdpModel>,
    actions: ReferenceActions,
    sheet: PlayerSheetHost,
    link: (String) -> Unit,
) {
    val (state, stale, refreshing) = vm.collected()
    val ask by vm.ask.collectAsStateWithLifecycle()
    LaunchedEffect(state) {
        (state as? RunScreenState.Loaded)?.model?.let { model -> sheet.parentRefreshed(model.rows.mapNotNull { it.row.sheetPlayer }) }
    }
    RunScreenFrame(state, refreshing, { vm.load() }, pin = { model -> BoardPin(model.verb) { link(model.verb.page) } }) { model ->
        val chosen = (ask as? ScreenAsk.Adp)?.format ?: model.format
        AdpScreen(model, stale, model.formats.pressing(chosen), AdpActions(actions) { vm.choose(it) })
    }
}

@Composable
private fun CompareRoute(
    vm: RunScreenViewModel<CompareModel>,
    actions: ReferenceActions,
) {
    val (state, stale, refreshing) = vm.collected()
    val ask by vm.ask.collectAsStateWithLifecycle()
    RunScreenFrame(state, refreshing, { vm.load() }) { model ->
        val chosen = (ask as? ScreenAsk.Compare)?.ask?.format ?: model.format
        CompareScreen(
            model,
            stale,
            model.formats.pressing(chosen),
            CompareActions(pick = { slot, slug -> vm.choose(slot, slug) }, format = { vm.chooseFormat(it) }, open = actions.open),
        )
    }
}

@Composable
private fun ClubsRoute(
    vm: RunScreenViewModel<ClubsModel>,
    actions: ReferenceActions,
) {
    val (state, stale, refreshing) = vm.collected()
    RunScreenFrame(state, refreshing, { vm.load() }) { model -> ClubsScreen(model, stale, actions) }
}

@Composable
private fun ClubRoute(
    vm: RunScreenViewModel<ClubPageModel>,
    actions: ReferenceActions,
    sheet: PlayerSheetHost,
    link: (String) -> Unit,
) {
    val (state, stale, refreshing) = vm.collected()
    LaunchedEffect(state) {
        (state as? RunScreenState.Loaded)?.model?.let { model -> sheet.parentRefreshed(model.rows.mapNotNull { it.sheetPlayer }) }
    }
    RunScreenFrame(
        state,
        refreshing,
        { vm.load() },
        pin = { model ->
            model.compare?.let { pair ->
                BoardPin(pair.label) { link(SiteLinks.compare(pair.slugs.first(), pair.slugs.last())) }
            }
        },
    ) { model -> ClubScreen(model, stale, actions) }
}

@Composable
private fun ScheduleRoute(
    vm: RunScreenViewModel<ScheduleModel>,
    actions: ReferenceActions,
    link: (String) -> Unit,
) {
    val (state, stale, refreshing) = vm.collected()
    RunScreenFrame(state, refreshing, { vm.load() }, pin = { model -> BoardPin(model.verb) { link(model.verb.page) } }) { model ->
        ScheduleScreen(model, stale, actions)
    }
}
