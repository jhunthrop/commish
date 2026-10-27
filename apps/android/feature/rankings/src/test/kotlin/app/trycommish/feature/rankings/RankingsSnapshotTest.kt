package app.trycommish.feature.rankings

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
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.rankings.OrderPosition
import app.trycommish.core.rankings.RankingsChip
import app.trycommish.core.rankings.RankingsFixtures
import app.trycommish.core.rankings.RankingsState
import app.trycommish.core.rankings.RankingsViewModel
import app.trycommish.core.rankings.StubRankings
import app.trycommish.core.start.StartFixtures
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
 * The Rankings' mock, the iOS screen's states (Lane 194 after its fix round), each the view model's over
 * the order's fixtures through a stub of the API at the week's clock (Saturday noon Central): the top in
 * season (every position), a position's view (WR), the kickers' week (K), the defenses' (DEF, each face
 * its club's chip, B245), a search ("wa", the matches at
 * their places in the order), the order saved and read again with no signal (stale with its stamp), and
 * WR never read failing over All (All's rows kept with the reason said once, the chips still there); and,
 * as if scrolled, the RB view as far as its fifth row (Travis Etienne's game line wraps his status to a
 * line of its own) and All as far as its 80th row (three-digit pills whole, the club column lined up; Lane
 * 215 review H1). The phone's first screen between the top bar and the tab bar; both themes, a Pixel 9
 * and a small phone. A face draws its initials here (a snapshot loads no image). The persona panel reads
 * these.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class RankingsSnapshotTest(
    private val scene: Scene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        /** The rows drawn; a scrolled scene draws as far as its last and shows the end. */
        val rows: Int = FIRST_ROWS,
        val scrolled: Boolean = false,
    ) {
        Top("top"),
        Position("position"),
        Kicker("kicker"),

        /** The defenses' week, each face its club's chip (B245). */
        Defense("defense"),
        Search("search"),
        Stale("stale"),
        Problem("problem"),
        Wrapped("wrapped", rows = 5, scrolled = true),
        Deep("deep", rows = 80, scrolled = true),
    }

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
    fun rankings() {
        paparazzi.unsafeUpdateConfig(renderingMode = RenderingMode.SHRINK)
        val vm = viewModelAt(scene, scheduler)
        val ui = vm.ui.value
        val content = (ui.state as RankingsState.Loaded).content
        val head = RankingsHead(vm.name, vm.lead(ui), vm.stampWords(ui))
        paparazzi.snapshot(name = "rankings-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) {
                Box(
                    Modifier
                        .background(CommishTheme.colors.bg)
                        .fillMaxWidth()
                        .height(phone.room)
                        .clipToBounds(),
                ) {
                    NumberFaceWarmUp()
                    RankingsPage(
                        content,
                        ui,
                        head,
                        RankingsActions(),
                        Modifier.wrapContentHeight(if (scene.scrolled) Alignment.Bottom else Alignment.Top, unbounded = true),
                        rows = scene.rows,
                        still = true,
                    )
                }
            }
        }
    }

    companion object {
        /** Rows enough to fill the first screen of the tallest phone. */
        const val FIRST_ROWS = 8

        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene -> listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } } }
    }
}

/**
 * The number face's semibold cut resolved before any other, unseen (B191). Layoutlib keeps the first
 * variation of the variable font this JVM resolves: where the first number drawn is a Bold, every later
 * SemiBold figure (the strip's) draws at the file's thinnest instance. A device resolves each cut on its
 * own and is not affected.
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

/** The view model at the scene's state, through the stub at the week's clock: read fresh, a chip or the
 * search read, the order saved then read with no signal half an hour on, or WR failing over All. */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun viewModelAt(
    scene: RankingsSnapshotTest.Scene,
    scheduler: TestCoroutineScheduler,
): RankingsViewModel {
    val week = StartFixtures.instant(RankingsFixtures.WEEK)
    val cache = MemoryCache()
    val stub = StubRankings(fails = { scene == RankingsSnapshotTest.Scene.Problem && it.position == OrderPosition.WR })

    fun make(at: java.time.Instant) =
        RankingsViewModel(stub, cache, FixedClock(at), Fixtures.zone, inSeason = true, query = "", sessionEnd = {})
    if (scene == RankingsSnapshotTest.Scene.Stale) {
        make(week).load()
        scheduler.advanceUntilIdle()
        stub.offline = true
    }
    val vm = make(if (scene == RankingsSnapshotTest.Scene.Stale) week.plusSeconds(HALF_HOUR) else week)
    vm.load()
    scheduler.advanceUntilIdle()
    when (scene) {
        RankingsSnapshotTest.Scene.Position, RankingsSnapshotTest.Scene.Problem -> vm.choose(RankingsChip.WR)
        RankingsSnapshotTest.Scene.Wrapped -> vm.choose(RankingsChip.RB)
        RankingsSnapshotTest.Scene.Kicker -> vm.choose(RankingsChip.K)
        RankingsSnapshotTest.Scene.Defense -> vm.choose(RankingsChip.DEF)
        RankingsSnapshotTest.Scene.Search -> vm.find("wa")
        RankingsSnapshotTest.Scene.Top, RankingsSnapshotTest.Scene.Stale, RankingsSnapshotTest.Scene.Deep -> Unit
    }
    scheduler.advanceUntilIdle()
    return vm
}

private const val HALF_HOUR = 1800L
