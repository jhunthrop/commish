package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.leaguehome.LeagueChoice
import app.trycommish.core.leaguehome.LeagueHomeState
import app.trycommish.core.leaguehome.LeagueHomeViewModel
import app.trycommish.feature.leaguehome.LeagueHomeScreen
import kotlinx.coroutines.launch

/** The League tab: sign-in when the device holds no token, else the member's league's home. */
@Composable
fun LeagueTab(
    graph: AppGraph,
    signInFlow: SignInFlow,
    signInMessage: String?,
    onOpenLineup: (leagueId: String) -> Unit,
) {
    val signedIn by graph.signedIn.collectAsStateWithLifecycle()
    if (!signedIn) {
        val context = LocalContext.current
        SignInScreen(signInMessage, onSignIn = { signInFlow.launch(context) })
        return
    }
    val vm: LeagueHomeViewModel = viewModel { graph.leagueHomeViewModel() }
    val state by vm.state.collectAsStateWithLifecycle()
    var unopened by remember { mutableStateOf<String?>(null) }
    var leagueId by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    /** Chooses the league and reads it: the kept page at once, then the API's. */
    suspend fun open() {
        val choice = graph.leagueChooser.choose()
        unopened = choice.message()
        if (choice is LeagueChoice.Chosen) {
            leagueId = choice.leagueId
            vm.load(choice.leagueId)
        }
    }
    LaunchedEffect(Unit) { open() }
    LeagueHomeScreen(
        state = unopened?.let { LeagueHomeState.Failed(it) } ?: state,
        zone = graph.zone,
        refreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                open()
                refreshing = false
            }
        },
        onOpenLineup = { leagueId?.let(onOpenLineup) },
    )
}
