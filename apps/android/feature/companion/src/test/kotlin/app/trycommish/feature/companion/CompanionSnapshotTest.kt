package app.trycommish.feature.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.core.companion.CompanionState
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The companion's mock, the iOS screen's scenes (CompanionScene), each through its view model over the
 * recorded replay at the replay's clock, framed to the room between the top bar and the bottom bar. Both
 * themes, a Pixel 9 and a small phone. A face draws its initials here (a snapshot loads no image). The
 * persona panel reads these.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class CompanionSnapshotTest(
    private val scene: CompanionScene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        /** The room a screen has between the status bar with the top bar and the bottom bar. */
        val room: Dp,
    ) {
        /** A Pixel 9's 411 by 923 dp at 2x. */
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),

        /** The Nexus 5's 360 by 640 dp at 2x. */
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun companion() {
        paparazzi.unsafeUpdateConfig(deviceConfig = phone.config, renderingMode = RenderingMode.SHRINK)
        val screen = screenOf(scene, SceneReads(scheduler))
        paparazzi.snapshot(name = "companion-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) {
                Box(
                    Modifier
                        .background(CommishTheme.colors.bg)
                        .fillMaxWidth()
                        .height(phone.room)
                        .clipToBounds(),
                ) {
                    NumberFaceWarmUp()
                    Box(Modifier.wrapContentHeight(Alignment.Top, unbounded = true)) { screen() }
                }
            }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            CompanionScene.entries.flatMap { scene ->
                listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } }
            }
    }
}

/** A scene's screen at rest, drawn from its view model. */
internal fun screenOf(
    scene: CompanionScene,
    reads: SceneReads,
): @Composable () -> Unit {
    if (scene == CompanionScene.New) {
        val form = reads.start().form.value
        return { NewCompanionScreen(form, NewCompanionActions(), still = true) }
    }
    val vm = reads.room(scene)
    return when (val state = vm.state.value) {
        is CompanionState.Room -> {
            val stale = vm.stampWords()
            ({ CompanionRoom(state.model, stale, CompanionActions(), still = true, parts = scene.parts) })
        }
        is CompanionState.Report -> ({ DraftReportScreen(state.report, CompanionActions(), parts = setOfNotNull(scene.report)) })
        else -> error("${scene.id} drew no room: $state")
    }
}

/**
 * The number face's semibold cut resolved before any other, unseen (backlog B191, Lane 202 fix round 1
 * M1): layoutlib keeps the first variation of the variable font this JVM resolves, and the companion's
 * first number is the bar's Bold count, after which every SemiBold cell would draw at the file's thinnest
 * instance. A device resolves each cut on its own and is not affected.
 */
@Composable
private fun NumberFaceWarmUp() {
    Box(Modifier.size(0.dp)) { Text("0", style = Faces.cell) }
}

private fun twoX(
    base: DeviceConfig,
    width: Int,
    height: Int,
): DeviceConfig =
    base.copy(
        screenWidth = width * 2,
        screenHeight = height * 2,
        xdpi = Density.XHIGH.dpiValue,
        ydpi = Density.XHIGH.dpiValue,
        density = Density.XHIGH,
    )
