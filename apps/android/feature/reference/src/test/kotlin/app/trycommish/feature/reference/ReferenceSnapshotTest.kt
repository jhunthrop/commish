package app.trycommish.feature.reference

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextLayoutResult
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
import org.junit.Assert.assertTrue
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
        // Every current-week state line, laid out: none may run past its cell (review H1).
        val stateLines = mutableListOf<TextLayoutResult>()
        val screen = screenOf(scene, SceneReads(scene, scheduler)) { stateLines += it }
        paparazzi.snapshot(name = "reference-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) {
                Box(Modifier.background(CommishTheme.colors.bg).fillMaxWidth()) {
                    NumberFaceWarmUp()
                    screen()
                }
            }
        }
        // A row laid out past the first window's height gets no height on that pass (V_SCROLL then redraws the
        // whole screen), so a line given none is not a cut one; any other line must fit its cell both ways.
        val cut = stateLines.filter { it.didOverflowWidth || (it.didOverflowHeight && it.layoutInput.constraints.maxHeight > 0) }
        assertTrue("state lines cut by their cell: ${cut.map { it.layoutInput.text }}", cut.isEmpty())
        if (scene == ReferenceScene.ScheduleUpcoming) assertTrue("no state line was drawn", stateLines.isNotEmpty())
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
    onStateLaid: (TextLayoutResult) -> Unit = {},
): @Composable () -> Unit =
    when (scene) {
        ReferenceScene.AdpTop, ReferenceScene.AdpInSeason, ReferenceScene.Stale -> {
            val vm = reads.adp()
            val model = vm.model()
            val stale = vm.staleWords()
            ({ AdpScreen(model, stale, model.formats, AdpActions(), model.rows.take(ADP_ROWS), still = true) })
        }
        ReferenceScene.CompareTwo, ReferenceScene.CompareAbsent, ReferenceScene.CompareByeAhead, ReferenceScene.CompareByePlayed,
        ReferenceScene.CompareClock, ReferenceScene.CompareClockUnread,
        -> {
            val model = reads.compare().model()
            ({ CompareScreen(model, null, model.formats, CompareActions(), still = true) })
        }
        ReferenceScene.Clubs -> {
            val model = reads.clubs().model()
            ({ ClubsScreen(model, null, ReferenceActions(), model.clubs.take(CLUB_CARDS), still = true) })
        }
        ReferenceScene.Club, ReferenceScene.ClubInSeason, ReferenceScene.ClubClock, ReferenceScene.ClubClockUnread -> {
            val model = reads.club().model()
            ({ ClubScreen(model, null, ReferenceActions(), still = true) })
        }
        ReferenceScene.Schedule, ReferenceScene.ScheduleUpcoming -> {
            val model = reads.schedule().model()
            ({ ScheduleScreen(model, null, ReferenceActions(), model.grid.rows.take(GRID_ROWS), still = true, onStateLaid = onStateLaid) })
        }
    }

/**
 * The number face's semibold cut resolved before any other, unseen. Layoutlib keeps the first variation of
 * the variable font this JVM resolves: where the first number drawn is the heading's Bold, every later
 * SemiBold cell draws at the file's thinnest instance (Lane 202 fix round 1, M1: a cell specimen drawn
 * first made the same scenes draw at weight; the Board's module draws a table scene first, so it never
 * met this). A device resolves each cut on its own and is not affected.
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
