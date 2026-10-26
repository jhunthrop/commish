package app.trycommish.feature.mock

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
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
 * The mock room's mock, the iOS screen's scenes (MockScene), each through its view model over the recorded
 * draft at the recording's clock, framed to the room under its own top bar, the room's bar at the foot where
 * it has one. Both themes, a Pixel 9 and a small phone. A face draws its initials here (a snapshot loads no
 * image). The persona panel reads these.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class MockSnapshotTest(
    private val scene: MockScene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        /** The room a full-screen page has between the status bar with the room's top bar and the system's
         * navigation. */
        val room: Dp,
    ) {
        /** A Pixel 9's 411 by 923 dp at 2x. */
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 827.dp),

        /** The Nexus 5's 360 by 640 dp at 2x. */
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 544.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun mock() {
        paparazzi.unsafeUpdateConfig(deviceConfig = phone.config, renderingMode = RenderingMode.SHRINK)
        val screen = screenOf(scene, MockSceneReads(scheduler))
        paparazzi.snapshot(name = "mock-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Framed(screen, phone.room) }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            MockScene.entries.flatMap { scene ->
                listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } }
            }
    }
}

/** The screen on its phone: the body clipped to the room, the bar at the foot where it has one. */
@Composable
private fun Framed(
    screen: SceneScreen,
    room: Dp,
) {
    Column(Modifier.background(CommishTheme.colors.bg).fillMaxWidth().height(room)) {
        NumberFaceWarmUp()
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) { SceneBody(screen) }
        screen.bar?.invoke()
    }
}

/**
 * The number face's semibold cut resolved before any other, unseen (backlog B191, Lane 202 fix round 1 M1):
 * layoutlib keeps the first variation of the variable font this JVM resolves. A device resolves each cut on
 * its own and is not affected.
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
