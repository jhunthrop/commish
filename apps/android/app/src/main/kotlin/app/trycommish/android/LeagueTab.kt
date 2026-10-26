package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.AppWords
import app.trycommish.core.leaguehome.DraftDayEntry
import app.trycommish.core.leaguehome.LeagueHomeState
import app.trycommish.core.leaguehome.LeagueHomeViewModel
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.ShellState
import app.trycommish.feature.account.SignInScreen
import app.trycommish.feature.leaguehome.DraftDay
import app.trycommish.feature.leaguehome.LeagueHomeScreen

/** The League tab: sign-in when the device holds no token, else the home of the league the shell
 * shows; with none to show, the sentence for why (none followed, or nothing kept and no connection). */
@Composable
fun LeagueTab(
    graph: AppGraph,
    shell: ShellState,
    onRetry: () -> Unit,
    onOpenLineup: (leagueId: String) -> Unit,
    onOpenGame: (leagueId: String, roster: Int?) -> Unit,
    openAdvisor: () -> Unit,
) {
    val signedIn by graph.signedIn.collectAsStateWithLifecycle()
    if (!signedIn) {
        val context = LocalContext.current
        val message by graph.signInMessage.collectAsStateWithLifecycle()
        SignInScreen(message, onSignIn = { graph.signInFlow.launch(context) })
        return
    }
    val league = (shell as? ShellState.Ready)?.selected
    if (league != null) {
        LeagueHome(graph, league.id, onOpenLineup, onOpenGame, draftDayOf(graph, league, openAdvisor))
        return
    }
    val waiting =
        when (shell) {
            ShellState.Restoring, ShellState.SignedOut -> LeagueHomeState.Loading
            ShellState.Unreachable -> LeagueHomeState.Failed(AppWords.cannotLoad)
            is ShellState.Ready -> LeagueHomeState.Failed(AppWords.noLeague)
        }
    LeagueHomeScreen(waiting, graph.zone, refreshing = false, onRefresh = onRetry, onOpenLineup = {})
}

/** A followed league's draft day on its home (SeasonPanel.svelte): the entry on the member's clock and the
 * Advisor's verb; null in every other phase. */
fun draftDayOf(
    graph: AppGraph,
    league: FollowedLeague?,
    openAdvisor: () -> Unit,
): DraftDay? =
    league
        ?.let { DraftDayEntry.of(it.phase, it.draftAt, graph.clock.now(), graph.zone) }
        ?.let { DraftDay(it, openAdvisor) }

/** One league's home, its own view model per screen it is on (the League tab's, or one pushed from the
 * league switch): the kept page at once, the API's after; a pull reads it again; a score bug opens its
 * game; on its draft day the Advisor's verb under its head. */
@Composable
fun LeagueHome(
    graph: AppGraph,
    leagueId: String,
    onOpenLineup: (leagueId: String) -> Unit,
    onOpenGame: (leagueId: String, roster: Int?) -> Unit,
    draftDay: DraftDay? = null,
    vm: LeagueHomeViewModel = viewModel { graph.leagueHomeViewModel() },
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    LaunchedEffect(leagueId) { if (vm.shown != leagueId) vm.load(leagueId) }
    LeagueHomeScreen(
        state = state,
        zone = graph.zone,
        refreshing = refreshing && state is LeagueHomeState.Loaded,
        onRefresh = { vm.load(leagueId) },
        onOpenLineup = { onOpenLineup(leagueId) },
        onOpenGame = { onOpenGame(leagueId, it) },
        draftDay = draftDay,
    )
}
