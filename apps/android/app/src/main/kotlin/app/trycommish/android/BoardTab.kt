package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.board.BoardModel
import app.trycommish.core.board.BoardState
import app.trycommish.core.board.BoardViewModel
import app.trycommish.core.shell.SheetOffer
import app.trycommish.design.RailItem
import app.trycommish.feature.board.BoardActions
import app.trycommish.feature.board.BoardScreen
import app.trycommish.feature.shell.LocalPlayerSheet

/** The rail's keys for the board's page (web nav.ts): the draft's Board, and in season with no league
 * the Rest of season item, the same page over the run's rest-of-season board. */
private const val BOARD_KEY = "board"
private const val REST_KEY = "rest_first"

/** The board's season by the bar item that opens it: true for Rest of season, false for Board, null
 * where the bar has no board (the tab cannot be shown then). */
fun boardInSeason(bar: List<RailItem>): Boolean? =
    when (bar.firstOrNull { it.page == BOARD_PAGE }?.key) {
        BOARD_KEY -> false
        REST_KEY -> true
        else -> null
    }

/** The board's page on the bar, the web's /board. */
const val BOARD_PAGE = "board"

/**
 * The Board tab, reached from the bar as the web's rail reaches it: its own view model per season and
 * league state, which holds the chips while the player sheet is open over it and after. The saved board
 * at once, then the run's; a pull reads again; a row opens the one player sheet by his id, which keeps
 * him as the board reads again under it, with Compare as its verb; the head's links (ADP, the schedule)
 * and a row's club chip push their pages through `link`; the one verb opens its page on the site.
 */
@Composable
fun BoardTab(
    graph: AppGraph,
    inSeason: Boolean,
    following: Boolean,
    link: (String) -> Unit,
) {
    val vm: BoardViewModel = viewModel(key = "board-$inSeason-$following") { graph.boardViewModel(inSeason, following) }
    val state by vm.state.collectAsStateWithLifecycle()
    val filter by vm.filter.collectAsStateWithLifecycle()
    val formats by vm.formats.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    LaunchedEffect(vm) { if (vm.state.value == BoardState.Loading) vm.load() }
    LaunchedEffect(state) {
        (state as? BoardState.Loaded)?.model?.let { model -> sheet.parentRefreshed(model.rows.mapNotNull { it.sheetPlayer }) }
    }
    BoardScreen(
        state = state,
        stamp = vm.stampWords(state),
        formats = BoardModel.formatChips(formats, filter.format),
        refreshing = refreshing && state is BoardState.Loaded,
        actions =
            BoardActions(
                // The sheet's verb here is Compare, with him on one side (shelf-state.ts compareOffer).
                open = { sheet.open(it, SheetOffer.compare(it, link)) },
                format = { vm.choose(it) },
                position = { vm.choose(it) },
                refresh = { vm.load() },
                openPage = link,
            ),
    )
}
