package app.trycommish.feature.start

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LeagueHost
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.start.MoveStep
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.StartState
import app.trycommish.core.start.StartUi
import app.trycommish.core.start.StripChip
import app.trycommish.core.start.startModel
import app.trycommish.core.start.startPin
import app.trycommish.core.start.startStamp
import app.trycommish.design.CommishTheme
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The Start screen's mock, the same states as the iOS screen's (Lane 180): the fixture league's lineup
 * before kickoff with the swaps offered (Saturday), during the games with kicked-off lines and their
 * changes held (Sunday 18:56Z), held once every starter has kicked off (Monday night, Locked), and a
 * saved read with no signal (the verb disabled with its stamp), each as the phone's first screen with the
 * verb pinned, then its lineup and its bench in full; and the move's confirmation and its outcomes on
 * ESPN, the pin alone. Both themes, a Pixel 9 and a small phone (the Nexus 5's 360 by 640 dp). The
 * persona panel reads these images.
 */
@RunWith(Parameterized::class)
class StartSnapshotTest(
    private val scene: Scene,
    private val part: Part,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        val clock: String,
        val parts: List<Part>,
        /** ESPN takes the lineup from here; the fixture's FFPC league does not, so its verb copies. */
        val writes: Boolean,
    ) {
        Before("before", StartFixtures.WEEK, listOf(Part.Phone, Part.Lineup, Part.Bench), false),
        Sunday("sunday", StartFixtures.SUNDAY, listOf(Part.Phone, Part.Lineup, Part.Bench), false),
        Held("held", StartFixtures.HELD, listOf(Part.Phone, Part.Lineup), false),
        Stale("stale", StartFixtures.WEEK, listOf(Part.Phone), true),
        MoveConfirm("move-confirm", StartFixtures.WEEK, listOf(Part.Pin), true),
        MoveDone("move-done", StartFixtures.WEEK, listOf(Part.Pin), true),
        MoveRefused("move-refused", StartFixtures.WEEK, listOf(Part.Pin), true),
        MovePending("move-pending", StartFixtures.WEEK, listOf(Part.Pin), true),
    }

    enum class Part(
        val id: String,
    ) {
        /** The phone's first screen: the room between the top bar and the bottom bar, the lineup's top with
         * the pin over its foot. */
        Phone("phone"),
        Lineup("lineup"),
        Bench("bench"),
        Pin("pin"),
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        /** The room a screen has between the status bar with the top bar and the bottom bar. */
        val room: Dp,
    ) {
        /** A Pixel 9's 411 by 923 dp, drawn at 2x so a whole lineup stays legible and small enough to keep. */
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),

        /** The Nexus 5's 360 by 640 dp. */
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Test
    fun start() {
        val mode = if (part == Part.Lineup || part == Part.Bench) RenderingMode.V_SCROLL else RenderingMode.SHRINK
        val shown = mutableMapOf<String, Boolean>()
        paparazzi.unsafeUpdateConfig(deviceConfig = phone.config, renderingMode = mode)
        paparazzi.snapshot(name = "start-${scene.id}-${part.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Mock(scene, part, phone) { key, whole -> shown[key] = whole } }
        }
        if (part == Part.Phone || part == Part.Lineup) everyChipIsDrawnWhole(shown)
    }

    /** The strip draws every chip the model holds, each whole: a swap the verb makes is never hidden by the
     * strip's own height (Lane 181 review H1, the D/ST chip clipped under "Three changes"). */
    private fun everyChipIsDrawnWhole(shown: Map<String, Boolean>) {
        val chips = startModel(adviceOf(scene), leagueOf(scene), StartFixtures.instant(scene.clock), Fixtures.zone).chips
        assertEquals(chips.map { it.key }.toSet(), shown.keys)
        assertEquals(chips.count { it is StripChip.SwapChip }, chips.count { it is StripChip.SwapChip && shown[it.key] == true })
        assertEquals(emptyList<String>(), shown.filterValues { !it }.keys.toList())
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{1}-{3}-dark={2}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene ->
                scene.parts.flatMap { part ->
                    listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, part, dark, it) } }
                }
            }
    }
}

/** A phone of `width` by `height` dp at 2x (320 dpi), Paparazzi's own resolution kept: a whole lineup is
 * taller than the 1000 px it would otherwise scale every image down to. */
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

private const val PLAN_SENTENCE =
    "Start Patrick Mahomes over Aaron Rodgers at QB, Travis Etienne over Ja'Marr Chase in the flex, and Houston Texans " +
        "over Minnesota Vikings at DEF, on ESPN now."
private const val ESPN_PAGE = "https://fantasy.espn.com/football/team"

/** The screen's state at a scene, as the view model holds it: loaded at the scene's clock, a saved read
 * (read at the scene's clock, shown with no signal since), or the move at one of its steps. */
private fun leagueOf(scene: StartSnapshotTest.Scene): LeagueHost = if (scene.writes) LeagueHost.espn else LeagueHost.ffpc

private fun adviceOf(scene: StartSnapshotTest.Scene) =
    if (scene.writes) StartFixtures.writes(scene.clock) else StartFixtures.lineup(scene.clock)

private fun uiOf(scene: StartSnapshotTest.Scene): StartUi {
    val now = StartFixtures.instant(scene.clock)
    val model = startModel(adviceOf(scene), leagueOf(scene), now, Fixtures.zone)
    val loaded = StartState.Loaded(model, now, stale = scene == StartSnapshotTest.Scene.Stale)
    return StartUi(state = loaded, step = stepOf(scene))
}

private fun stepOf(scene: StartSnapshotTest.Scene): MoveStep =
    when (scene) {
        StartSnapshotTest.Scene.MoveConfirm -> MoveStep.Confirm(PLAN_SENTENCE, "tok-1")
        StartSnapshotTest.Scene.MoveDone -> MoveStep.made(result(HostMoveResult.Outcome.done))
        StartSnapshotTest.Scene.MoveRefused -> MoveStep.made(result(HostMoveResult.Outcome.refused))
        StartSnapshotTest.Scene.MovePending -> MoveStep.made(result(HostMoveResult.Outcome.pending))
        else -> MoveStep.Closed
    }

private fun result(outcome: HostMoveResult.Outcome): HostMoveResult =
    HostMoveResult(
        outcome = outcome,
        sentence =
            when (outcome) {
                HostMoveResult.Outcome.refused -> "ESPN did not take the move, and nothing changed."
                HostMoveResult.Outcome.pending -> "We sent it, and ESPN has not shown it yet. Check your lineup on ESPN."
                else -> "Your lineup is set on ESPN."
            },
        hostWords =
            if (outcome ==
                HostMoveResult.Outcome.refused
            ) {
                "Lineup transaction could not be completed, Patrick Mahomes is locked"
            } else {
                null
            },
        hostUrl = ESPN_PAGE,
        moveId = null,
        processesAt = null,
    )

@Composable
private fun Mock(
    scene: StartSnapshotTest.Scene,
    part: StartSnapshotTest.Part,
    phone: StartSnapshotTest.Phone,
    chipShown: (String, Boolean) -> Unit,
) {
    val ui = uiOf(scene)
    val loaded = ui.state as StartState.Loaded
    val stamp = startStamp(ui, Fixtures.zone)
    val pin = startPin(ui, ValueWords.platform(if (scene.writes) LeagueHost.espn else LeagueHost.ffpc), Fixtures.zone)
    val rows = RowActions({}, {}, emptySet())
    val bg = Modifier.background(CommishTheme.colors.bg)
    when (part) {
        StartSnapshotTest.Part.Phone ->
            Column(bg.fillMaxWidth().height(phone.room)) {
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) {
                    StartPage(
                        loaded.model,
                        stamp,
                        rows,
                        {},
                        listOf(StartPart.Lineup),
                        Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                        chipShown,
                    )
                }
                if (!pin.isEmpty) Pin(pin, PinActions())
            }
        StartSnapshotTest.Part.Lineup -> StartPage(loaded.model, stamp, rows, {}, listOf(StartPart.Lineup), bg, chipShown)
        StartSnapshotTest.Part.Bench -> StartPage(loaded.model, stamp, rows, {}, listOf(StartPart.Bench), bg)
        StartSnapshotTest.Part.Pin -> Pin(pin, PinActions())
    }
}
