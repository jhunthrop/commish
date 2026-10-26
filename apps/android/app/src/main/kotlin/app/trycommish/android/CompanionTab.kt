package app.trycommish.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.companion.CompanionState
import app.trycommish.core.companion.CompanionViewModel
import app.trycommish.core.companion.NewCompanionViewModel
import app.trycommish.core.companion.PoolModel
import app.trycommish.design.CommishTheme
import app.trycommish.feature.companion.CompanionActions
import app.trycommish.feature.companion.CompanionScreen
import app.trycommish.feature.companion.NewCompanionActions
import app.trycommish.feature.companion.NewCompanionScreen
import app.trycommish.feature.shell.LocalPlayerSheet

/** The bar's Advisor page (nav.ts ADVISOR links COMPANION_START). */
const val ADVISOR_PAGE = "advisor"

/**
 * The live-draft companion's start page, the Advisor's screen: its own view model (the development replay
 * where asked), the drafts followed before read on open; following a draft, or tapping one followed before,
 * opens it through `open`. A follow that answers after the page has left the screen opens nothing until the
 * page is shown again.
 */
@Composable
fun CompanionStartTab(
    graph: AppGraph,
    replay: Boolean,
    open: (String) -> Unit,
) {
    val vm: NewCompanionViewModel = viewModel(key = "companion-new-$replay") { graph.newCompanionViewModel(replay) }
    val form by vm.form.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { vm.load() }
    LaunchedEffect(form.followed) {
        form.followed?.let {
            vm.opened()
            open(it)
        }
    }
    NewCompanionScreen(
        form,
        NewCompanionActions(
            link = vm::type,
            seat = vm::seat,
            slot = vm::slot,
            username = vm::username,
            follow = { vm.follow() },
            open = open,
        ),
        Modifier.fillMaxSize().background(CommishTheme.colors.bg).verticalScroll(rememberScrollState()),
    )
}

/**
 * A followed draft: its own view model per draft, read every three seconds while it is on screen with the
 * app started and never in the background; the report once the draft is over. The verb and the bar's link
 * open the platform's draft room (its app where one claims the link); a row opens the one player sheet,
 * which keeps him as the picks land under it; another draft is followed from the start page.
 */
@Composable
fun CompanionDraftTab(
    graph: AppGraph,
    id: String,
    followAnother: () -> Unit,
) {
    val vm: CompanionViewModel = viewModel(key = "companion-$id") { graph.companionViewModel(id) }
    val state by vm.state.collectAsStateWithLifecycle()
    val filter by vm.filter.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    val uri = LocalUriHandler.current
    var shown by rememberSaveable(filter) { mutableIntStateOf(PoolModel.FIRST_ROWS) }
    // Started and on screen: visible. Stopped (backgrounded, another tab) or left: hidden.
    LifecycleStartEffect(vm) {
        vm.setVisible(true)
        onStopOrDispose { vm.setVisible(false) }
    }
    LaunchedEffect(state) {
        (state as? CompanionState.Room)?.model?.let { model ->
            sheet.parentRefreshed(
                model.pool
                    ?.rows
                    .orEmpty()
                    .map { it.player.sheetPlayer },
            )
        }
    }
    val bar =
        when (val now = state) {
            is CompanionState.Room -> now.model.bar
            is CompanionState.Report -> now.bar
            CompanionState.Loading, is CompanionState.Failed -> null
        }
    CompanionScreen(
        state = state,
        stale = vm.stampWords(state),
        refreshing = refreshing,
        shown = shown,
        actions =
            CompanionActions(
                open = { sheet.open(it) },
                openDraft = { bar?.let { uri.openUri(it.openUrl) } },
                filter = vm::choose,
                followAnother = followAnother,
                more = { shown += PoolModel.MORE_ROWS },
            ),
        refresh = { vm.refresh() },
        retry = vm::retry,
    )
}
