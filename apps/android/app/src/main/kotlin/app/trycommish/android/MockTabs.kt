package app.trycommish.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.api.CommishJson
import app.trycommish.api.models.Feature
import app.trycommish.api.models.LeagueSettings
import app.trycommish.api.models.LobbyFormat
import app.trycommish.core.mock.MockRoomViewModel
import app.trycommish.core.mock.MockSetupSeed
import app.trycommish.core.mock.MockSetupViewModel
import app.trycommish.core.mock.SharedMockViewModel
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.ShellState
import app.trycommish.feature.mock.MockRoomExits
import app.trycommish.feature.mock.MockRoomView
import app.trycommish.feature.mock.MockSetupActions
import app.trycommish.feature.mock.MockSetupScreen
import app.trycommish.feature.mock.SharedMockScreen
import app.trycommish.feature.shell.LocalPlayerSheet
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException

/** The bar's Mock draft page (nav.ts MOCK_SETUP): the setup. */
const val MOCK_PAGE = "mock"

/** Where a mock's setup starts (the web's site context): the selected league's board and saved league, else
 * the format chosen with no league; a link's `?league=` names the saved league first. */
fun mockSeed(
    shell: ShellState,
    league: String?,
): MockSetupSeed {
    val ready = shell as? ShellState.Ready
    val selected = ready?.selected
    return MockSetupSeed(
        format = selected?.format ?: ready?.format,
        league = league ?: selected?.settingsLeagueId,
        exactRules = ready?.features?.contains(Feature.custom_scoring.value) == true,
    )
}

/** A draft's settings as a route carries them (Try another slot), and back; null for none or a value that does
 * not read. */
fun settingsArg(settings: LeagueSettings?): String =
    settings?.let { android.net.Uri.encode(CommishJson.encodeToString(LeagueSettings.serializer(), it)) }.orEmpty()

fun settingsOf(arg: String?): LeagueSettings? =
    arg?.takeIf { it.isNotEmpty() }?.let {
        try {
            CommishJson.decodeFromString(LeagueSettings.serializer(), it)
        } catch (e: SerializationException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
    }

/** The setup in the bar's tab or pushed: its own view model per route; starting opens the room full screen. Under
 * its form the open house drafts (the web's /lobby is this page), read on appear and on a pull; a join opens the
 * lobby full screen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MockSetupTab(
    graph: AppGraph,
    route: ShellRoute.MockSetup,
    shell: ShellState,
    start: (String) -> Unit,
    lobby: LobbyEntry,
) {
    val key = "mock-setup-${route.league}-${route.from?.hashCode()}"
    val vm: MockSetupViewModel = viewModel(key = key) { graph.mockSetupViewModel(route.from, mockSeed(shell, route.league)) }
    val form by vm.form.collectAsStateWithLifecycle()
    val landing = lobby.landing
    val scope = rememberCoroutineScope()
    var pulling by remember { mutableStateOf(false) }
    LaunchedEffect(vm) { vm.load() }
    LaunchedEffect(landing) { landing.load() }
    LaunchedEffect(form.started) {
        form.started?.let {
            vm.opened()
            start(it)
        }
    }
    val join = { format: LobbyFormat -> scope.launch { landing.join(format)?.let(lobby.open) } }
    PullToRefreshBox(
        isRefreshing = pulling,
        onRefresh = {
            pulling = true
            scope.launch {
                landing.load()
                pulling = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        MockSetupScreen(
            form,
            MockSetupActions(
                scoring = vm::choose,
                teams = vm::chooseTeams,
                slot = vm::chooseSlot,
                lineup = vm::choose,
                start = { vm.start() },
            ),
            Modifier.fillMaxSize(),
            lobby =
                lobbySetup(landing, form.settings, { join(it) }) { handle ->
                    scope.launch { landing.saveHandle(handle)?.let(lobby.open) }
                },
        )
    }
}

/** A shared draft pushed where its link was opened; running it opens the reader's own room. */
@Composable
fun SharedMockTab(
    graph: AppGraph,
    code: String,
    start: (String) -> Unit,
) {
    val vm: SharedMockViewModel = viewModel(key = "mock-shared-$code") { graph.sharedMockViewModel(code) }
    val sheet = LocalPlayerSheet.current
    SharedMockScreen(vm, start, open = { sheet.open(it) })
}

/** The room full screen over the shell (its bars hidden while drafting): its own view model for the mock it
 * shows; leaving closes it, a new mock from the report opens in its place, Try another slot opens the setup
 * from the draft's settings. A face on the wall or the team opens the one player sheet over it. */
@Composable
fun MockRoomCover(
    graph: AppGraph,
    id: String,
    exits: MockRoomExits,
) {
    val vm: MockRoomViewModel = viewModel(key = "mock-room-$id") { graph.mockRoomViewModel(id) }
    MockRoomView(vm, exits)
}
