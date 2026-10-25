package app.trycommish.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.phoneBar
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.ShellFixtures
import app.trycommish.core.shell.leagueSwitch
import app.trycommish.core.shell.playerSheetModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The shell's mock, the same states as the iOS shell's (Lane 177): the top bar over a league in season
 * and over one before its draft with the bar's five under each, the switch open with three leagues in
 * three phases, and the player sheet partly open and expanded, both themes, a Pixel 9 and a small phone
 * (the Nexus 5's 360 by 640 dp), from the shared fixture's leagues at its Saturday clock. The bottom
 * bar is the app's own; the sheet is drawn as Material's modal sheet lies over a screen (the real one
 * is a window Paparazzi does not draw). The persona panel reads these images.
 */
@RunWith(Parameterized::class)
class ShellSnapshotTest(
    private val scene: Scene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
    ) {
        BarInSeason("bar-in-season"),
        BarPreDraft("bar-pre-draft"),
        SwitchOpen("switch-open"),
        SheetPartial("sheet-partial"),
        SheetExpanded("sheet-expanded"),
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
    ) {
        /** A Pixel 9: 1080 by 2424 at 420 dpi, 411 by 923 dp. */
        Pixel9("pixel9", DeviceConfig.PIXEL_6.copy(screenWidth = 1080, screenHeight = 2424, xdpi = 422, ydpi = 422)),
        Small("small", DeviceConfig.NEXUS_5),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0)

    @Test
    fun shell() {
        paparazzi.snapshot(name = "shell-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Scene(scene) }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene ->
                listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } }
            }
    }
}

@Composable
private fun Scene(scene: ShellSnapshotTest.Scene) {
    val leagues = ShellFixtures.three()
    when (scene) {
        ShellSnapshotTest.Scene.BarInSeason -> ShellMock(leagues, leagues[0], open = false)
        ShellSnapshotTest.Scene.BarPreDraft -> ShellMock(leagues, leagues[1], open = false)
        ShellSnapshotTest.Scene.SwitchOpen -> ShellMock(leagues, leagues[0], open = true)
        ShellSnapshotTest.Scene.SheetPartial -> SheetMock(expanded = false)
        ShellSnapshotTest.Scene.SheetExpanded -> SheetMock(expanded = true)
    }
}

/** The bar, the room a screen takes under it, and the phone's five at the foot; open, the switch's
 * list lies under the bar as on the web's phone. */
@Composable
private fun ShellMock(
    leagues: List<FollowedLeague>,
    shown: FollowedLeague,
    open: Boolean,
) {
    val model = leagueSwitch(leagues, shown.id, ShellFixtures.week, Fixtures.zone)
    val bar = phoneBar(shown, null)
    Column(Modifier.fillMaxSize().background(CommishTheme.colors.bg)) {
        TopBar(model.face, open, "", {}, TopBarActions({}, {}, {}))
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (open) {
                LeagueSwitchMenu(
                    model,
                    {},
                    Modifier.padding(horizontal = Tokens.Space.s3.dp).padding(top = Tokens.Space.s1.dp),
                )
            }
        }
        PhoneTabBar(bar, bar.first().page) {}
    }
}

/** The sheet over a dimmed screen at one of its two heights: partly open (half the screen) or
 * expanded (the whole of it under the status bar), its drag handle at the top as Material draws it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetMock(expanded: Boolean) {
    val c = CommishTheme.colors
    val scrim = BottomSheetDefaults.ScrimColor
    Column(Modifier.fillMaxSize().background(c.bg).background(scrim)) {
        Spacer(Modifier.weight(if (expanded) STATUS_SHARE else 1f))
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = SHEET_CORNER, topEnd = SHEET_CORNER))
                .background(c.bg),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BottomSheetDefaults.DragHandle()
            PlayerSheetFrame(playerSheetModel(PLAYER), close = {}, openFullPage = {})
        }
    }
}

/** Material's expanded sheet leaves the status bar's room above it: a sliver of the screen. */
private const val STATUS_SHARE = 0.04f
private val SHEET_CORNER: Dp = 28.dp
private val PLAYER = SheetPlayer("4983", "puka-nacua", "Puka Nacua", "WR", "4", "LAR")
