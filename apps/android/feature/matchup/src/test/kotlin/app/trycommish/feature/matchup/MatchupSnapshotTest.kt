package app.trycommish.feature.matchup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
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
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.matchup.MatchupFixtures
import app.trycommish.core.matchup.MatchupModel
import app.trycommish.core.matchup.MatchupState
import app.trycommish.core.matchup.matchupModel
import app.trycommish.core.matchup.matchupStamp
import app.trycommish.core.start.StartFixtures
import app.trycommish.design.CommishTheme
import app.trycommish.feature.boxscore.RowActions
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The Matchup's mock, the same states as the iOS screen's (Lane 183): the fixture league's week before
 * the first kickoff (Saturday noon: each side's Proj, the first kickoff), during the games with mixed
 * states (Sunday 18:56Z: kicked off, still to come and final rows, the live score with its read), after
 * Sunday (Monday morning: Sunday's starters final, Monday night still to come) and final (Tuesday noon);
 * and a poll that failed on Sunday, the week kept with its stamp; and another team's game on Sunday, opened
 * from its score bug (Lane 207, as iOS Lane 206), at the top and at its second roster, and kept with its
 * stamp by a failed poll. Each as the phone's first screen (the
 * title, the bug and the top of the member's box), then the member's box and the opponent's with the
 * basis in full. Both themes, a Pixel 9 and a small phone
 * (the Nexus 5's 360 by 640 dp). The persona panel reads these images.
 */
@RunWith(Parameterized::class)
class MatchupSnapshotTest(
    private val scene: Scene,
    private val part: Part,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        val clock: String,
        val parts: List<Part>,
        /** The roster whose game the scene draws: null for the member's own. */
        val roster: Int? = null,
    ) {
        Before("before", MatchupFixtures.BEFORE, listOf(Part.Phone, Part.Mine, Part.Theirs)),
        Sunday("sunday", MatchupFixtures.SUNDAY, listOf(Part.Phone, Part.Mine, Part.Theirs)),
        Monday("monday", MatchupFixtures.MONDAY, listOf(Part.Phone, Part.Mine, Part.Theirs)),
        Final("final", MatchupFixtures.FINAL, listOf(Part.Phone, Part.Mine, Part.Theirs)),
        Stale("stale", MatchupFixtures.SUNDAY, listOf(Part.Phone)),

        /** Another team's game, Carried by QJs against Bower Rangers (roster 2's). */
        Other("other", MatchupFixtures.SUNDAY, listOf(Part.Phone, Part.Theirs), MatchupFixtures.OTHER_ROSTER),
        OtherStale("other-stale", MatchupFixtures.SUNDAY, listOf(Part.Phone), MatchupFixtures.OTHER_ROSTER),
        ;

        val stale: Boolean get() = this == Stale || this == OtherStale
    }

    enum class Part(
        val id: String,
    ) {
        /** The phone's first screen: the room between the top bar and the bottom bar. */
        Phone("phone"),
        Mine("mine"),
        Theirs("theirs"),
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        /** The room a screen has between the status bar with the top bar and the bottom bar. */
        val room: Dp,
    ) {
        /** A Pixel 9's 411 by 923 dp, drawn at 2x as the Start screen's references are. */
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),

        /** The Nexus 5's 360 by 640 dp. */
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Test
    fun matchup() {
        val mode = if (part == Part.Phone) RenderingMode.SHRINK else RenderingMode.V_SCROLL
        paparazzi.unsafeUpdateConfig(deviceConfig = phone.config, renderingMode = mode)
        paparazzi.snapshot(name = "matchup-${scene.id}-${part.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Mock(scene, part, phone) }
        }
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

/** A phone of `width` by `height` dp at 2x (320 dpi), Paparazzi's own resolution kept, as the Start
 * screen's mock draws it. */
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

/** The screen's state at a scene, as the view model holds it: the week read at the scene's clock, or that
 * read kept after a poll that found no signal; another team's game with the Sleeper league's reads. */
private fun stateOf(scene: MatchupSnapshotTest.Scene): MatchupState.Loaded {
    val now = StartFixtures.instant(scene.clock)
    val model =
        if (scene.roster == null) {
            matchupModel(MatchupFixtures.sync(scene.clock), MatchupFixtures.box(scene.clock), now, Fixtures.zone)
        } else {
            matchupModel(
                MatchupFixtures.otherSync(scene.clock),
                MatchupFixtures.otherBox(scene.clock),
                now,
                Fixtures.zone,
                MatchupFixtures.otherBoard(scene.clock),
            )
        }
    return MatchupState.Loaded(model, now, stale = scene.stale)
}

@Composable
private fun Mock(
    scene: MatchupSnapshotTest.Scene,
    part: MatchupSnapshotTest.Part,
    phone: MatchupSnapshotTest.Phone,
) {
    val state = stateOf(scene)
    val week = (state.model as MatchupModel.Week).week
    val stamp = matchupStamp(state, Fixtures.zone)
    val rows = RowActions({})
    val bg = Modifier.background(CommishTheme.colors.bg)
    when (part) {
        MatchupSnapshotTest.Part.Phone ->
            Box(bg.fillMaxWidth().height(phone.room).clipToBounds()) {
                MatchupPage(
                    week,
                    stamp,
                    rows,
                    listOf(MatchupPart.Head, MatchupPart.Mine),
                    Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                )
            }
        MatchupSnapshotTest.Part.Mine -> MatchupPage(week, stamp, rows, listOf(MatchupPart.Mine), bg)
        MatchupSnapshotTest.Part.Theirs -> MatchupPage(week, stamp, rows, listOf(MatchupPart.Theirs), bg)
    }
}
