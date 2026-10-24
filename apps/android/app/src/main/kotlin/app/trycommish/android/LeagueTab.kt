package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.trycommish.core.leaguehome.LeagueChoice
import app.trycommish.core.leaguehome.LeagueHomeState
import app.trycommish.core.leaguehome.LeagueHomeViewModel
import app.trycommish.feature.leaguehome.LeagueHomeScreen

/** The League tab: sign-in when the device holds no token, else the member's league's home. The view
 * model runs the reads in its own scope; the tab only asks it to open and draws what it says. */
@Composable
fun LeagueTab(
    graph: AppGraph,
    vm: LeagueHomeViewModel,
    onOpenLineup: (leagueId: String) -> Unit,
) {
    val signedIn by graph.signedIn.collectAsStateWithLifecycle()
    if (!signedIn) {
        val context = LocalContext.current
        val message by graph.signInMessage.collectAsStateWithLifecycle()
        SignInScreen(message, onSignIn = { graph.signInFlow.launch(context) })
        return
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val choice by vm.choice.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    // Once per sign-in: a kept page draws at once, the API's follows.
    LaunchedEffect(signedIn) { if (state !is LeagueHomeState.Loaded) vm.open() }
    LeagueHomeScreen(
        state = state,
        zone = graph.zone,
        refreshing = refreshing && state is LeagueHomeState.Loaded,
        onRefresh = { vm.open() },
        onOpenLineup = { (choice as? LeagueChoice.Chosen)?.let { onOpenLineup(it.leagueId) } },
    )
}
