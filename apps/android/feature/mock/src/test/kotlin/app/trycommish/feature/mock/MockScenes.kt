package app.trycommish.feature.mock

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.mock.MockFixtures
import app.trycommish.core.mock.MockRoomState
import app.trycommish.core.mock.MockRoomViewModel
import app.trycommish.core.mock.MockSetupViewModel
import app.trycommish.core.mock.MockWords
import app.trycommish.core.mock.SharedMockState
import app.trycommish.core.mock.SharedMockViewModel
import app.trycommish.core.mock.StubMock
import app.trycommish.design.Words
import app.trycommish.feature.companion.ReportPart
import kotlinx.coroutines.test.TestCoroutineScheduler

/**
 * The mock room's scenes, the iOS MockRoomSnapshotTests' (Lane 213 after its fix round), each through its view
 * model over the recorded draft (shared/fixtures/mock-room): the setup with slot 5 chosen; the first turn with
 * our call and the bar; round 5 with the pool; the wall and your team at round 5; the queue under its chip;
 * after an undo; the saved room shown stale with no connection (the reconnecting state of a room with no
 * socket); the report at 1st and well down the table; and a shared mock. A mock against bots has no clock, so
 * there is no low clock to draw (Lane 213 NEEDS_CONTEXT 2).
 */
enum class MockScene(
    val id: String,
    val parts: Set<MockRoomPart> = setOf(MockRoomPart.Call, MockRoomPart.Pool),
) {
    Setup("setup"),
    FirstTurn("first-turn"),
    Round5("round5", setOf(MockRoomPart.Pool)),
    Round5Wall("round5-wall", setOf(MockRoomPart.Wall, MockRoomPart.Team)),
    Queue("queue", setOf(MockRoomPart.Pool)),
    Undo("undo"),
    Offline("offline"),
    ReportFirst("report-first"),
    ReportDown("report-down"),
    Shared("shared", setOf(MockRoomPart.Pool)),
}

/** The scene's view models, read through the stub on the test scheduler at the recording's clock. */
internal class MockSceneReads(
    private val scheduler: TestCoroutineScheduler,
) {
    private fun idle() = scheduler.advanceUntilIdle()

    fun room(scene: MockScene): MockRoomViewModel {
        val stub = StubMock(if (scene == MockScene.FirstTurn) MockFixtures.Answer.Create else MockFixtures.Answer.Round5)
        val cache = MemoryCache()
        val made = { MockRoomViewModel(MockFixtures.ID, stub, cache, FixedClock(MockFixtures.readAt), MockFixtures.zone, SessionEnd {}) }
        val vm = made().also { it.load() }
        idle()
        when (scene) {
            MockScene.Queue -> {
                vm.toggleQueue(MockFixtures.room(MockFixtures.Answer.Queue).queue.first())
                idle()
                vm.choose(Words.Mock.queue)
            }
            MockScene.Undo -> {
                vm.undo()
                idle()
            }
            MockScene.Offline -> {
                stub.offline = true
                return made().also {
                    it.load()
                    idle()
                }
            }
            else -> Unit
        }
        return vm
    }

    fun setup(): MockSetupViewModel = MockSetupViewModel(StubMock()).also { it.chooseSlot(SLOT) }

    fun shared(): SharedMockViewModel =
        SharedMockViewModel("code", StubMock(MockFixtures.Answer.SharedRound5)).also {
            it.load()
            idle()
        }

    private companion object {
        const val SLOT = 5
    }
}

/** A scene's screen at rest, and the room's bar at its foot where it has one. */
internal class SceneScreen(
    val body: @Composable () -> Unit,
    val bar: (@Composable () -> Unit)? = null,
)

internal fun screenOf(
    scene: MockScene,
    reads: MockSceneReads,
): SceneScreen =
    when (scene) {
        MockScene.Setup -> {
            val form = reads.setup().form.value
            SceneScreen({ MockSetupScreen(form, MockSetupActions(), still = true) })
        }
        MockScene.ReportFirst, MockScene.ReportDown -> {
            val report = MockFixtures.report(if (scene == MockScene.ReportFirst) "report" else "report-down")
            val model =
                DraftReportModel.of(report, MockWords.seatNames(report.teams, report.slot), Words.Mock.botsByAdp, Words.Mock.reshuffled)
            val verbs = MockReportVerbs(MockWords.runAgain(report.slot), another = {}, copy = {})
            SceneScreen({ MockReportScreen(model, verbs, parts = setOf(ReportPart.Head)) })
        }
        MockScene.Shared -> {
            val model = (reads.shared().state.value as SharedMockState.Room).model
            SceneScreen({
                MockRoom(
                    model,
                    null,
                    null,
                    enabled = false,
                    actions = MockRoomActions(),
                    still = true,
                    parts = scene.parts,
                    shared = SharedVerb(false) {},
                )
            })
        }
        else -> {
            val vm = reads.room(scene)
            val room = vm.state.value as? MockRoomState.Room ?: error("${scene.id} drew no room: ${vm.state.value}")
            val stale = vm.staleWords(room)
            SceneScreen(
                { MockRoom(room.model, stale, null, room.canWrite, MockRoomActions(), still = true, parts = scene.parts) },
                room.model.bar?.let { bar ->
                    { MockBarView(bar, room.canWrite, copied = false, actions = MockRoomActions(), still = true) }
                },
            )
        }
    }

/** The screen's body from the top, unbounded below as the scroll would let it run. */
@Composable
internal fun SceneBody(screen: SceneScreen) {
    Box(Modifier.wrapContentHeight(Alignment.Top, unbounded = true)) { screen.body() }
}
