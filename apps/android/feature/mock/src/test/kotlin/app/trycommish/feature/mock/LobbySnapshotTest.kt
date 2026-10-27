package app.trycommish.feature.mock

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.Paparazzi
import app.trycommish.api.models.LobbyFormat
import app.trycommish.core.AppWords
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.lobby.LobbyFixtures
import app.trycommish.core.lobby.LobbyLandingViewModel
import app.trycommish.core.lobby.LobbyReportViewModel
import app.trycommish.core.lobby.LobbyRoomModel
import app.trycommish.core.lobby.LobbyWords
import app.trycommish.core.lobby.StubLobby
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.feature.companion.ReportPart
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.time.Instant

/** The lobby's scenes, the iOS LobbySnapshotTests' (Lane 229): the landing with three cards, one your seat; the
 * room before the start; the room on your turn; the room between your turns with a notice; the report at 1st and
 * well down the table. */
enum class LobbyScene(
    val id: String,
) {
    Landing("landing"),
    Filling("filling"),
    YourTurn("your-turn"),
    Between("between"),
    ReportFirst("report-first"),
    ReportDown("report-down"),
}

/**
 * The lobby's mock over the recorded lobby (shared/fixtures/lobby-room) replayed to each state on the parity's
 * clock, framed under the room's top bar, both themes, a Pixel 9 and a small phone. The persona panel reads these
 * beside Lane 229's iOS renders.
 */
@RunWith(Parameterized::class)
class LobbySnapshotTest(
    private val scene: LobbyScene,
    private val dark: Boolean,
    private val phone: MockSnapshotTest.Phone,
) {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Test
    fun lobby() {
        paparazzi.unsafeUpdateConfig(deviceConfig = phone.config, renderingMode = RenderingMode.SHRINK)
        val body = LobbyScenes.body(scene)
        paparazzi.snapshot(name = "lobby-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { LobbyFramed(scene, phone.room, body) }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            LobbyScene.entries.flatMap { scene ->
                listOf(false, true).flatMap { dark -> MockSnapshotTest.Phone.entries.map { arrayOf(scene, dark, it) } }
            }
    }
}

/** The scenes' screens, each from the recorded lobby at rest. */
internal object LobbyScenes {
    private val parity: JsonObject by lazy { Json.parseToJsonElement(LobbyFixtures.parity()).jsonObject }

    /** The parity's state by its name: the frame it is drawn at, its clock, its card. */
    fun model(name: String): LobbyRoomModel {
        val web =
            parity
                .getValue("states")
                .jsonObject
                .getValue(name)
                .jsonObject
        val lobby = LobbyFixtures.replayed(web.getValue("frame").jsonPrimitive.int)
        val room = LobbyFixtures.room()
        val card = web["card"]?.jsonPrimitive?.intOrNull?.let(LobbyFixtures::card)
        val now = Instant.parse(web.getValue("now").jsonPrimitive.content)
        return LobbyRoomModel.of(room, RoomBoardView.of(room.board, room.teams), lobby, card, now)
    }

    fun landing(): LobbySetup {
        val vm = LobbyLandingViewModel(StubLobby())
        runBlocking {
            vm.load()
            vm.join(LobbyFormat._12_ppr)
        }
        return LobbySetup(vm.head, vm.cards, problem = null, enabled = true)
    }

    fun body(scene: LobbyScene): @Composable () -> Unit =
        when (scene) {
            LobbyScene.Landing -> landingBody(landing())
            LobbyScene.ReportFirst, LobbyScene.ReportDown -> {
                val report = LobbyFixtures.report(if (scene == LobbyScene.ReportFirst) "jpk88" else "mara")
                reportBody(LobbyReportViewModel.model(report, LobbyFixtures.room(complete = true)), LobbyWords.soloAgain(report.slot))
            }
            LobbyScene.Filling -> roomBody(model("filling"), emptyList())
            LobbyScene.YourTurn -> roomBody(model("yourTurn"), emptyList())
            LobbyScene.Between -> roomBody(model("between"), listOf(REFUSAL))
        }

    private fun landingBody(landing: LobbySetup): @Composable () -> Unit =
        { Box(Modifier.padding(vertical = Tokens.Space.s4.dp)) { LobbyListView(landing) } }

    private fun reportBody(
        model: DraftReportModel,
        solo: String,
    ): @Composable () -> Unit = { MockReportScreen(model, lobbyReportVerbs(solo, {}, {}), parts = setOf(ReportPart.Head)) }

    private fun roomBody(
        model: LobbyRoomModel,
        notices: List<String>,
    ): @Composable () -> Unit =
        { LobbyRoomScreen(model, notices, complete = false, abandoned = false, actions = LobbyActions(), still = true) }

    /** The room's refusal the between scene shows, as the room words it. */
    const val REFUSAL = "You are not on the clock."
}

/** The screen on its phone under the room's top bar, its Leave while a room is drawn. */
@Composable
private fun LobbyFramed(
    scene: LobbyScene,
    room: Dp,
    body: @Composable () -> Unit,
) {
    val inRoom = scene == LobbyScene.Filling || scene == LobbyScene.YourTurn || scene == LobbyScene.Between
    Column(Modifier.background(CommishTheme.colors.bg).fillMaxWidth().height(room)) {
        Box(Modifier.size(0.dp)) { Text("0", style = Faces.cell) }
        RoomTop({}, AppWords.lobbyClose, leave = if (inRoom) ({}) else null)
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) { SceneBody(SceneScreen(body)) }
    }
}
