package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.player.CardVerb
import app.trycommish.core.player.PlayerPageViewModel
import app.trycommish.core.player.PlayerSheets
import app.trycommish.core.player.page
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.ShellRoute
import app.trycommish.design.RailItem
import app.trycommish.feature.player.PlayerPageView
import app.trycommish.feature.player.PlayerSheetBody
import app.trycommish.feature.shell.PlayerSheet

/** A player's page pushed on the tab in view (the sheet's Full page): its own view model per slug and
 * league, read on open and on a pull; its verb opens the bar's tab where the bar has it, or the platform's
 * own page with his name on the clipboard. */
@Composable
fun PlayerPage(
    graph: AppGraph,
    slug: String,
    league: FollowedLeague?,
    bar: List<RailItem>,
    openTab: (String) -> Unit,
) {
    val vm: PlayerPageViewModel = viewModel(key = "player-$slug-${league?.id}") { graph.playerPageViewModel(slug, league) }
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { vm.load() }
    PlayerPageView(state, vm.stampWords(state), refreshing, refresh = { vm.load() }) { verb, name ->
        actOf(graph, verb, name, bar, openTab)
    }
}

/** What the page's verb does in the app, null where the bar holds no tab for it. */
private fun actOf(
    graph: AppGraph,
    verb: CardVerb,
    name: String,
    bar: List<RailItem>,
    openTab: (String) -> Unit,
): (() -> Unit)? {
    val target = verb.target
    if (target is CardVerb.Target.Platform) return { graph.copyAndOpen(name, target.url) }
    val page = target.page?.takeIf { tab -> bar.any { it.page == tab } } ?: return null
    return { openTab(page) }
}

/** The one player sheet over the tabs: one view model per player the host shows (Review Focus 3), his
 * week read in the league shown; the screen's verb pinned at its foot. */
@Composable
fun PlayerSheetOver(
    graph: AppGraph,
    host: PlayerSheetHost,
    league: FollowedLeague?,
    openPlayer: (ShellRoute.Player) -> Unit,
) {
    val sheets = remember(graph, league?.id) { PlayerSheets { graph.playerSheetViewModel(it, league) } }
    PlayerSheet(host, openPlayer) { player ->
        PlayerSheetBody(sheets.of(player), host.offer, close = host::close)
    }
}
