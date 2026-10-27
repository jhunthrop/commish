package app.trycommish.feature.mock

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.trycommish.core.AppWords
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.lobby.LobbyReportState
import app.trycommish.core.lobby.LobbyReportViewModel
import app.trycommish.core.lobby.LobbyRoomModel
import app.trycommish.core.lobby.LobbyScreenState
import app.trycommish.core.lobby.LobbyViewModel
import app.trycommish.core.mock.MockCallState
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.companion.PickStripView
import app.trycommish.feature.companion.TeamView
import app.trycommish.feature.companion.WallView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

/** LobbyRoomView TICK_MS: a second clock read four times a second never shows a stale second. */
private const val TICK_MS = 250L

/** What the lobby's controls do: the call's verb (draft on your clock, queue him first off it), a pool row's mark,
 * queue and draft, a chip, more rows, the notices' verbs, and a face opening the player sheet. */
class LobbyActions(
    val draft: (String?) -> Unit = {},
    val queueFirst: (String) -> Unit = {},
    val queue: (String) -> Unit = {},
    val mark: (String) -> Unit = {},
    val filter: (String) -> Unit = {},
    val more: () -> Unit = {},
    val report: () -> Unit = {},
    val another: () -> Unit = {},
    val open: (SheetPlayer) -> Unit = {},
) {
    /** The mock room's controls for the parts the lobby shares with it: the pool's. */
    val room: MockRoomActions
        get() = MockRoomActions(draft = draft, queue = queue, mark = mark, filter = filter, more = more, open = open)
}

/**
 * The lobby as its model says it, in the web's order at 390 (LobbyRoomView.svelte with the room page's notices),
 * the iOS LobbyRoomScreen's: the notices, the score bug, the seats, the filling line, the picks as they land, our
 * call, the pool, the wall, the dock's line and your team. Pure of state, so a snapshot draws it from the fixture;
 * `roomNow` redraws the score bug's clock and the filling line's countdown on the room's clock (null draws the
 * model's own moment, a snapshot's), and `still` lays the strips, chips and wall at rest.
 */
@Composable
fun LobbyRoomScreen(
    model: LobbyRoomModel,
    notices: List<String>,
    complete: Boolean,
    abandoned: Boolean,
    actions: LobbyActions,
    modifier: Modifier = Modifier,
    shown: Int = PoolModel.FIRST_ROWS,
    still: Boolean = false,
    roomNow: (() -> Instant)? = null,
) {
    Column(modifier.padding(vertical = Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        notices.forEach { LobbyNoticeView(it) }
        if (complete) LobbyNoticeView(Words.Lobby.over, Words.Lobby.readReport to actions.report)
        if (abandoned) {
            LobbyNoticeView(Words.Lobby.abandoned, Words.Lobby.joinAnother to actions.another)
        } else {
            Ticking(model, roomNow) { now ->
                now.bug?.let { LobbyScoreBugView(it) }
                LobbySeatsView(now.seats, still)
                now.wait?.let { LobbyWaitView(it) }
            }
            model.landing?.let { PickStripView(it, actions.open, still, ringStrong = true) }
            model.call?.let { call ->
                MockCallView(MockCallState.Call(call.model, call.playerId), enabled = true) { player ->
                    player?.let { if (call.drafts) actions.draft(it) else actions.queueFirst(it) }
                }
            }
            model.pool?.let { MockPoolView(it, shown, model.yourTurn, actions.room, still) }
            WallView(model.wall, actions.open, still)
            LobbyAboutView(model.aboutHead, model.about)
            TeamView(model.team, actions.open, Words.Room.yourTeam)
        }
    }
}

/** The parts drawn on the room's clock: redrawn four times a second from the model's state, nothing else. */
@Composable
private fun Ticking(
    model: LobbyRoomModel,
    roomNow: (() -> Instant)?,
    content: @Composable (LobbyRoomModel) -> Unit,
) {
    if (roomNow == null) {
        content(model)
        return
    }
    var now by remember { mutableStateOf(roomNow()) }
    LaunchedEffect(roomNow) {
        while (true) {
            now = roomNow()
            delay(TICK_MS)
        }
    }
    content(model.at(now))
}

/** Where the lobby sends the member: out of it (the seat stays), the seat given up, its report, another lobby
 * joined from a closed one, and a player's sheet. */
class LobbyExits(
    val close: () -> Unit,
    val left: () -> Unit,
    val report: () -> Unit,
    val opened: (String) -> Unit,
    val open: (SheetPlayer) -> Unit = {},
)

/**
 * The lobby full screen with its view model (web/src/routes/lobby/[id] at 390), the iOS LobbyRoomView's: the close
 * (the seat stays, its queue drafting until the member comes back) and the quiet Leave at the top, which asks the
 * web's question with Stay beside it; the room scrolling under it. The socket lives as long as this screen.
 */
@Composable
fun LobbyRoomView(
    vm: LobbyViewModel,
    exits: LobbyExits,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val drawn by vm.drawn.collectAsStateWithLifecycle()
    val lobby by vm.lobby.collectAsStateWithLifecycle()
    val stopped by vm.stopped.collectAsStateWithLifecycle()
    val problem by vm.problem.collectAsStateWithLifecycle()
    val dismissed by vm.dismissed.collectAsStateWithLifecycle()
    val socket by vm.socket.collectAsStateWithLifecycle()
    val status = socket?.status?.collectAsState()?.value
    val refusal = socket?.refusal?.collectAsState()?.value
    var asking by rememberSaveable { mutableStateOf(false) }
    var shown by rememberSaveable { mutableIntStateOf(PoolModel.FIRST_ROWS) }
    val scope = rememberCoroutineScope()
    // A run again (Try again after a read that did not go) is a new key; a configuration change runs the same
    // key again, which the view model resumes from the last seq.
    var attempt by rememberSaveable { mutableIntStateOf(0) }
    LaunchedEffect(vm, attempt) { vm.run() }
    BackHandler(onBack = exits.close)
    val notices = listOfNotNull(stopped, LobbyViewModel.notice(status, refusal, problem, dismissed))
    val open = state == LobbyScreenState.Room && stopped == null && lobby?.let { !it.complete && !it.abandoned } == true
    Column(
        Modifier
            .fillMaxSize()
            .background(CommishTheme.colors.bg)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        RoomTop(exits.close, AppWords.lobbyClose, leave = if (open) ({ asking = true }) else null)
        Box(Modifier.weight(1f)) {
            when (val now = state) {
                LobbyScreenState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                LobbyScreenState.Room ->
                    drawn?.let { model ->
                        LobbyRoomScreen(
                            model,
                            notices.distinct(),
                            complete = lobby?.complete == true,
                            abandoned = lobby?.abandoned == true,
                            actions =
                                LobbyActions(
                                    draft = { scope.launch { vm.draft(it) } },
                                    queueFirst = { scope.launch { vm.queueFirst(it) } },
                                    queue = { scope.launch { vm.toggleQueue(it) } },
                                    mark = vm::mark,
                                    filter = {
                                        shown = PoolModel.FIRST_ROWS
                                        vm.choose(it)
                                    },
                                    more = { shown += PoolModel.MORE_ROWS },
                                    report = exits.report,
                                    another = { scope.launch { vm.joinAnother()?.let(exits.opened) } },
                                    open = exits.open,
                                ),
                            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                            shown = shown,
                            roomNow = vm::roomNow,
                        )
                    }
                is LobbyScreenState.Failed -> Failed(now.sentence, exits.close, retry = if (now.final) null else ({ attempt++ }))
            }
        }
    }
    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false },
            text = { Text(vm.leaveQuestion) },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    scope.launch { if (vm.leave()) exits.left() }
                }) { Text(Words.Lobby.leaveVerb) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text(Words.Lobby.stay) } },
        )
    }
}

/** A room or a report that cannot be read: why, and the quiet way back to the lobbies. */
@Composable
private fun Failed(
    sentence: String,
    back: () -> Unit,
    retry: (() -> Unit)? = null,
) {
    Column(
        Modifier.fillMaxSize().padding(Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BasisText(sentence)
        // A read that did not go (no signal, the API's own fault) can be tried again; a refusal for good cannot.
        retry?.let { QuietButton(Words.Lobby.tryAgain, onClick = it) }
        QuietButton(Words.Lobby.joinLobby, onClick = back)
    }
}

/**
 * The lobby's report (web/src/routes/lobby/[id]/report at 390), the iOS LobbyReportView's: the mock report's box
 * score with the people's names, its solid verb back to the lobbies and its quiet one against bots from the slot.
 */
@Composable
fun LobbyReportView(
    vm: LobbyReportViewModel,
    lobbies: () -> Unit,
    solo: (String) -> Unit,
    open: (SheetPlayer) -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val problem by vm.problem.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { if (vm.state.value == LobbyReportState.Loading) vm.load() }
    BackHandler(onBack = lobbies)
    Column(
        Modifier
            .fillMaxSize()
            .background(CommishTheme.colors.bg)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        RoomTop(lobbies, AppWords.lobbyClose)
        Box(Modifier.weight(1f)) {
            when (val now = state) {
                LobbyReportState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                is LobbyReportState.Report ->
                    MockReportScreen(
                        now.report,
                        lobbyReportVerbs(now.solo, lobbies, { vm.runSolo(solo) }, problem),
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                        open = open,
                    )
                is LobbyReportState.Failed -> Failed(now.sentence, lobbies)
            }
        }
    }
}

/** The lobby report page's verbs: Join another lobby solid, the same draft against bots quiet; no share link. */
fun lobbyReportVerbs(
    solo: String,
    lobbies: () -> Unit,
    runSolo: () -> Unit,
    refusal: String? = null,
): MockReportVerbs =
    MockReportVerbs(lead = Words.Lobby.joinAnother, run = lobbies, another = runSolo, anotherLabel = solo, refusal = refusal)
