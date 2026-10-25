package app.trycommish.feature.record

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.rankings.RecordFixture
import app.trycommish.core.rankings.StubRecord
import app.trycommish.core.record.RecordState
import app.trycommish.core.record.RecordViewModel
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
import java.time.Instant

/**
 * Our record's mock, the iOS screen's states (Lane 194 after its fix round), each the view model's over
 * the record's fixtures and the contract run's schedule through a stub: the head with the summary once
 * the STAND-IN week 7 is graded against ESPN and the week's published projection, the weeks with that
 * graded week and its caption, the summary before week 7 is graded (the week and when it grades), the
 * draft record, and the run's own record saved and read again with no signal (stale with its stamp). The
 * room between the top bar and the tab bar; both themes, a Pixel 9 and a small phone.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class RecordSnapshotTest(
    private val scene: Scene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        val fixture: RecordFixture,
        val now: String,
        val parts: List<RecordPart>,
    ) {
        Head("head", RecordFixture.Published, GRADED, listOf(RecordPart.Head)),
        Week("week", RecordFixture.Published, GRADED, listOf(RecordPart.Weeks)),
        Pending("pending", RecordFixture.Upcoming, THURSDAY, listOf(RecordPart.Head)),
        Draft("draft", RecordFixture.Published, GRADED, listOf(RecordPart.Draft)),
        Stale("stale", RecordFixture.Own, THURSDAY, listOf(RecordPart.Head)),
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        val room: Dp,
    ) {
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),
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
    fun record() {
        paparazzi.unsafeUpdateConfig(renderingMode = RenderingMode.SHRINK)
        val vm = viewModelAt(scene, scheduler)
        val ui = vm.ui.value
        val model = (ui.state as RecordState.Loaded).model
        val stamp = vm.stampWords(ui)
        paparazzi.snapshot(name = "record-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) {
                Box(
                    Modifier
                        .background(CommishTheme.colors.bg)
                        .fillMaxWidth()
                        .height(phone.room)
                        .clipToBounds(),
                ) {
                    RecordPage(
                        model,
                        ui,
                        stamp,
                        RecordActions(),
                        scene.parts,
                        still = true,
                        modifier = Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                    )
                }
            }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene -> listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } } }
    }
}

/** The Thursday after week 7 graded, and the Thursday it was set. */
private const val GRADED = "2026-10-29T17:00:00Z"
private const val THURSDAY = "2026-10-22T17:00:00Z"
private const val HALF_HOUR = 1800L

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

/** The view model at the scene's state through the stub: read fresh, or saved and then read with no signal
 * half an hour on. */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun viewModelAt(
    scene: RecordSnapshotTest.Scene,
    scheduler: TestCoroutineScheduler,
): RecordViewModel {
    val now = Instant.parse(scene.now)
    val cache = MemoryCache()
    val stub = StubRecord(scene.fixture)
    if (scene == RecordSnapshotTest.Scene.Stale) {
        RecordViewModel(stub, cache, FixedClock(now), Fixtures.zone) {}.load()
        scheduler.advanceUntilIdle()
        stub.offline = true
    }
    val later = if (scene == RecordSnapshotTest.Scene.Stale) now.plusSeconds(HALF_HOUR) else now
    val vm = RecordViewModel(stub, cache, FixedClock(later), Fixtures.zone) {}
    vm.load()
    scheduler.advanceUntilIdle()
    return vm
}
