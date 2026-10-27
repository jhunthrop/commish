package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.api.models.LeagueSettings
import app.trycommish.api.models.LobbyFormat
import app.trycommish.core.lobby.LobbyLandingViewModel
import app.trycommish.core.lobby.LobbyReportViewModel
import app.trycommish.core.lobby.LobbyViewModel
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.feature.mock.LobbyExits
import app.trycommish.feature.mock.LobbyReportView
import app.trycommish.feature.mock.LobbyRoomView
import app.trycommish.feature.mock.LobbySetup

/** The open house drafts the setup draws (one list per account, kept by the shell) and the lobby a join opens. */
class LobbyEntry(
    val landing: LobbyLandingViewModel,
    val open: (String) -> Unit,
)

/** The list as the setup draws it, from the landing's state: collected so the cards redraw as the list, the
 * seats and the handle's question move. */
@Composable
internal fun lobbySetup(
    landing: LobbyLandingViewModel,
    settings: LeagueSettings,
    join: (LobbyFormat) -> Unit,
    saveHandle: (String) -> Unit,
): LobbySetup {
    val lobbies by landing.lobbies.collectAsStateWithLifecycle()
    val seated by landing.seated.collectAsStateWithLifecycle()
    val busy by landing.busy.collectAsStateWithLifecycle()
    val problem by landing.problem.collectAsStateWithLifecycle()
    val asking by landing.handleFor.collectAsStateWithLifecycle()
    val handleProblem by landing.handleProblem.collectAsStateWithLifecycle()
    val read by landing.read.collectAsStateWithLifecycle()
    return remember(lobbies, seated, busy, problem, asking, handleProblem, read, settings) {
        LobbySetup(
            head = landing.head,
            cards = landing.cards,
            problem = problem,
            enabled = !busy,
            asking = asking != null,
            handleProblem = handleProblem,
            join = { join(it.format) },
            joinNearest = { join(LobbyLandingViewModel.nearest(settings)) },
            saveHandle = saveHandle,
            listed = read,
        )
    }
}

/** Where the lobby over the shell sends the member: its room or its report shown, the lobby closed (the list read
 * again), a mock against bots started from its report, and a player's sheet. */
internal class LobbyCoverExits(
    val show: (OpenLobby) -> Unit,
    val close: () -> Unit,
    val solo: (String) -> Unit,
    val open: (SheetPlayer) -> Unit,
)

/** The lobby full screen over the shell: the room, or its report once the member reads it; its own view model for
 * the room it shows. The landing's "Your seat" follows it: a seat left, a room drafted to its end, its report's Join
 * another lobby, and a seat taken from a closed lobby. */
@Composable
internal fun LobbyCover(
    graph: AppGraph,
    open: OpenLobby,
    landing: LobbyLandingViewModel,
    exits: LobbyCoverExits,
) {
    if (open.report) {
        val vm: LobbyReportViewModel = viewModel(key = "lobby-report-${open.id}") { graph.lobbyReportViewModel(open.id) }
        LobbyReportView(
            vm,
            lobbies = {
                landing.forget(open.id)
                exits.close()
            },
            solo = exits.solo,
            open = exits.open,
        )
        return
    }
    val vm: LobbyViewModel = viewModel(key = "lobby-room-${open.id}") { graph.lobbyViewModel(open.id) }
    val state by vm.lobby.collectAsStateWithLifecycle()
    LaunchedEffect(state?.complete) { if (state?.complete == true) landing.forget(open.id) }
    LobbyRoomView(
        vm,
        LobbyExits(
            close = exits.close,
            left = {
                landing.forget(open.id)
                exits.close()
            },
            report = { exits.show(OpenLobby(open.id, report = true)) },
            opened = { id ->
                landing.forget(open.id)
                vm.room?.format?.let { landing.seat(id, it) }
                exits.show(OpenLobby(id))
            },
            open = exits.open,
        ),
    )
}
