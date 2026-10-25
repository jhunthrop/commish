package app.trycommish.feature.reference

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.design.CommishTheme
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
 * The reference screens' mock, the iOS screens' scenes (ReferenceScene), each the view model's over a
 * fixture run through a stub of the run's routes at the run's clock, drawn whole at rest: ADP's first
 * twelve rows, Compare, the clubs index's first four cards, a club's whole page, the schedule's first ten
 * clubs with the first weeks the frame holds. Both themes, a Pixel 9 and a small phone. A face draws its
 * initials here (a snapshot loads no image). The persona panel reads these.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class ReferenceSnapshotTest(
    private val scene: ReferenceScene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Phone(
        val id: String,
        val config: DeviceConfig,
    ) {
        /** A Pixel 9's 411 by 923 dp at 2x. */
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923)),

        /** The Nexus 5's 360 by 640 dp at 2x. */
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640)),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun reference() {
        paparazzi.unsafeUpdateConfig(renderingMode = RenderingMode.V_SCROLL)
        val screen = screenOf(scene, SceneReads(scene, scheduler))
        paparazzi.snapshot(name = "reference-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) {
                Box(Modifier.background(CommishTheme.colors.bg).fillMaxWidth()) { screen() }
            }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            ReferenceScene.entries.flatMap { scene ->
                listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } }
            }
    }
}

/** ADP's rows a mock draws, the first screen of the tallest phone. */
internal const val ADP_ROWS = 12

/** The clubs index's cards a mock draws. */
internal const val CLUB_CARDS = 4

/** The schedule's clubs a mock draws. */
internal const val GRID_ROWS = 10

/** A scene's screen at rest, drawn from its view model. */
internal fun screenOf(
    scene: ReferenceScene,
    reads: SceneReads,
): @Composable () -> Unit =
    when (scene) {
        ReferenceScene.AdpTop, ReferenceScene.AdpInSeason, ReferenceScene.Stale -> {
            val vm = reads.adp()
            val model = vm.model()
            val stale = vm.staleWords()
            ({ AdpScreen(model, stale, model.formats, AdpActions(), model.rows.take(ADP_ROWS), still = true) })
        }
        ReferenceScene.CompareTwo, ReferenceScene.CompareAbsent -> {
            val model = reads.compare().model()
            ({ CompareScreen(model, null, model.formats, CompareActions(), still = true) })
        }
        ReferenceScene.Clubs -> {
            val model = reads.clubs().model()
            ({ ClubsScreen(model, null, ReferenceActions(), model.clubs.take(CLUB_CARDS), still = true) })
        }
        ReferenceScene.Club -> {
            val model = reads.club().model()
            ({ ClubScreen(model, null, ReferenceActions(), still = true) })
        }
        ReferenceScene.Schedule -> {
            val model = reads.schedule().model()
            ({ ScheduleScreen(model, null, ReferenceActions(), model.grid.rows.take(GRID_ROWS), still = true) })
        }
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
