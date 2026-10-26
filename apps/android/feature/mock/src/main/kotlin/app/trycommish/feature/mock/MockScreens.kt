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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.trycommish.api.models.LeagueSettings
import app.trycommish.core.AppWords
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.mock.MockRoomState
import app.trycommish.core.mock.MockRoomViewModel
import app.trycommish.core.mock.MockWords
import app.trycommish.core.mock.SharedMockState
import app.trycommish.core.mock.SharedMockViewModel
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.BasisText

/** Where the room sends the member: out of it, into a new mock, to the setup from a draft's settings, and a
 * player's sheet. */
class MockRoomExits(
    val close: () -> Unit,
    val opened: (String) -> Unit,
    val anotherSlot: (LeagueSettings) -> Unit,
    val open: (SheetPlayer) -> Unit = {},
)

/**
 * The room full screen with its view model (web/src/routes/mock/[id] at 390): a close that asks first at the
 * top (back asks the same), the room scrolling under it, the web's bar at the bottom while the draft is on;
 * the report in its place once it is over. Every verb goes to the API and the room is redrawn from its
 * answer; a saved room shows stale with its verbs held until a pull reads it again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MockRoomView(
    vm: MockRoomViewModel,
    exits: MockRoomExits,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refusal by vm.refusal.collectAsStateWithLifecycle()
    val copied by vm.copied.collectAsStateWithLifecycle()
    var leaving by rememberSaveable { mutableStateOf(false) }
    var shown by rememberSaveable { mutableIntStateOf(PoolModel.FIRST_ROWS) }
    val clipboard = LocalClipboardManager.current
    val share = {
        vm.shareUrl?.let {
            clipboard.setText(AnnotatedString(it))
            vm.linkCopied()
        }
        Unit
    }
    LaunchedEffect(vm) { if (vm.state.value == MockRoomState.Loading) vm.load() }
    val ask = { if (state is MockRoomState.Room) leaving = true else exits.close() }
    BackHandler(onBack = ask)
    Column(
        Modifier
            .fillMaxSize()
            .background(CommishTheme.colors.bg)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        RoomTop(ask)
        Box(Modifier.weight(1f)) {
            when (val now = state) {
                MockRoomState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                is MockRoomState.Room -> {
                    val actions =
                        MockRoomActions(
                            draft = { vm.draft(it) },
                            undo = { vm.undo() },
                            autopick = { vm.autopick() },
                            finish = { vm.finish() },
                            share = share,
                            queue = { vm.toggleQueue(it) },
                            mark = vm::mark,
                            filter = {
                                shown = PoolModel.FIRST_ROWS
                                vm.choose(it)
                            },
                            more = { shown += PoolModel.MORE_ROWS },
                            open = exits.open,
                        )
                    Column {
                        PullToRefreshBox(isRefreshing = false, onRefresh = { vm.refresh() }, modifier = Modifier.weight(1f)) {
                            MockRoom(
                                now.model,
                                vm.staleWords(now),
                                refusal,
                                now.canWrite,
                                actions,
                                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                                shown,
                            )
                        }
                        now.model.bar?.let { MockBarView(it, now.canWrite, copied, actions) }
                    }
                }
                is MockRoomState.Report ->
                    MockReportScreen(
                        now.report,
                        MockReportVerbs(
                            lead = MockWords.runAgain(now.slot),
                            run = { vm.runAgain(exits.opened) },
                            another = { exits.anotherSlot(now.settings) },
                            copied = copied,
                            copy = share,
                        ),
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                        open = exits.open,
                    )
                is MockRoomState.Failed -> Failed(now.sentence) { vm.load() }
            }
        }
    }
    if (leaving) {
        LeaveDialog(stay = { leaving = false }, leave = {
            leaving = false
            exits.close()
        })
    }
}

/** Back while drafting asks first: the draft stays on the account, and the way back to it. */
@Composable
private fun LeaveDialog(
    stay: () -> Unit,
    leave: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = stay,
        title = { Text(AppWords.mockLeaveTitle) },
        text = { Text(AppWords.mockLeaveMessage) },
        confirmButton = { TextButton(onClick = leave) { Text(AppWords.mockLeave) } },
        dismissButton = { TextButton(onClick = stay) { Text(AppWords.mockStay) } },
    )
}

/** The words for a room that cannot be shown, and the way to read again. */
@Composable
private fun Failed(
    sentence: String,
    retry: (() -> Unit)?,
) {
    Column(
        Modifier.fillMaxSize().padding(Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BasisText(sentence)
        retry?.let { QuietButton(AppWords.tryAgain, onClick = it) }
    }
}

/**
 * A shared draft read by its code (web/src/routes/mock/share/[code] at 390): its head and the room as it
 * stood, read and never drafted in; once finished its report. Its one verb runs the draft as the reader's own
 * and the app opens that room.
 */
@Composable
fun SharedMockScreen(
    vm: SharedMockViewModel,
    opened: (String) -> Unit,
    open: (SheetPlayer) -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val starting by vm.starting.collectAsStateWithLifecycle()
    val problem by vm.problem.collectAsStateWithLifecycle()
    var shown by rememberSaveable { mutableIntStateOf(PoolModel.FIRST_ROWS) }
    LaunchedEffect(vm) { if (vm.state.value == SharedMockState.Loading) vm.load() }
    val ground = Modifier.fillMaxSize().background(CommishTheme.colors.bg)
    when (val now = state) {
        SharedMockState.Loading -> Box(ground, Alignment.Center) { CircularProgressIndicator() }
        is SharedMockState.Room ->
            MockRoom(
                now.model,
                stale = null,
                refusal = problem,
                enabled = false,
                actions =
                    MockRoomActions(
                        filter = {
                            shown = PoolModel.FIRST_ROWS
                            vm.choose(it)
                        },
                        more = { shown += PoolModel.MORE_ROWS },
                        open = open,
                    ),
                modifier = ground.verticalScroll(rememberScrollState()),
                shown = shown,
                shared = SharedVerb(starting) { vm.run(opened) },
            )
        is SharedMockState.Report ->
            MockReportScreen(
                now.report,
                MockReportVerbs(lead = now.verb, run = { vm.run(opened) }),
                ground.verticalScroll(rememberScrollState()),
                open = open,
            )
        is SharedMockState.Failed -> Box(ground) { Failed(now.sentence, retry = null) }
    }
}
