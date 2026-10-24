package app.trycommish.feature.leaguehome

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.leaguehome.LeagueHomeModel
import app.trycommish.core.leaguehome.LeagueHomeState
import app.trycommish.core.leaguehome.LeagueHomeWords
import app.trycommish.core.leaguehome.leagueHomeModel
import app.trycommish.design.CommishTheme
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * The League home's mock: the shared fixture's FFPC league at the fixture's Sunday clock (the noon
 * games in their fourth quarter), light and dark. The first screen a member sees at a Pixel 8's size
 * (411 by 914 dp, the Pixel 6 config Paparazzi ships) and a small phone's (360 by 640 dp, the Nexus
 * 5); each section whole at the small phone's width, since Paparazzi scales any image over 1000 px
 * down; the stale stamp with no connection; the sentence with nothing kept. The persona panel reads
 * these images before a build is accepted.
 */
class LeagueHomeSnapshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = SMALL, maxPercentDifference = 0.0)

    private val clock: Instant = Fixtures.sunday
    private val model: LeagueHomeModel =
        leagueHomeModel(Fixtures.sync(), Fixtures.scoreboard(clock), clock, Fixtures.zone)
    private val fresh = LeagueHomeState.Loaded(model, clock, stale = false)

    private fun snap(
        name: String,
        dark: Boolean,
        device: DeviceConfig = SMALL,
        mode: RenderingMode = RenderingMode.V_SCROLL,
        content: @Composable () -> Unit,
    ) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device, renderingMode = mode)
        paparazzi.snapshot(name = "$name-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Box(Modifier.background(CommishTheme.colors.bg)) { content() } }
        }
    }

    private fun screen(
        name: String,
        dark: Boolean,
        device: DeviceConfig = SMALL,
        state: LeagueHomeState = fresh,
    ) = snap(name, dark, device, RenderingMode.NORMAL) {
        LeagueHomeScreen(state, Fixtures.zone, refreshing = false, onRefresh = {}, onOpenLineup = {})
    }

    @Test fun screenPixel8Light() = screen("screen-pixel8", dark = false, device = PIXEL_8)

    @Test fun screenPixel8Dark() = screen("screen-pixel8", dark = true, device = PIXEL_8)

    @Test fun screenSmallLight() = screen("screen-small", dark = false)

    @Test fun screenSmallDark() = screen("screen-small", dark = true)

    @Test fun scoreboardLight() = snap("scoreboard", dark = false) { ScoreBoard(model.week, model.games) }

    @Test fun scoreboardDark() = snap("scoreboard", dark = true) { ScoreBoard(model.week, model.games) }

    @Test fun standingsLight() = snap("standings", dark = false) { Standings(model.standings) }

    @Test fun standingsDark() = snap("standings", dark = true) { Standings(model.standings) }

    @Test fun standingsWideLight() = snap("standings-wide", dark = false, device = DeviceConfig.PIXEL_C) { Standings(model.standings) }

    @Test fun lineupLight() = snap("lineup", dark = false) { LineupSummary(model.lineup, onOpenLineup = {}) }

    @Test fun lineupDark() = snap("lineup", dark = true) { LineupSummary(model.lineup, onOpenLineup = {}) }

    @Test fun movesLight() = snap("moves", dark = false) { MovesFeed(firstMoves()) }

    @Test fun movesDark() = snap("moves", dark = true) { MovesFeed(firstMoves()) }

    @Test fun offlineSmallLight() =
        screen("offline-small", dark = false, state = fresh.copy(stamp = Instant.parse("2026-10-18T17:00:00Z"), stale = true))

    @Test fun failedSmallLight() = screen("failed-small", dark = false, state = LeagueHomeState.Failed(LeagueHomeWords.cannotLoad))

    @Test fun failedSmallDark() = screen("failed-small", dark = true, state = LeagueHomeState.Failed(LeagueHomeWords.cannotLoad))

    /** The feed's first eight moves, a trade among them, so the image stays under Paparazzi's scale. */
    private fun firstMoves() =
        requireNotNull(model.moves).let { feed ->
            val trade = feed.rows.first { it.kind == LeagueHomeWords.trade }
            feed.copy(rows = (feed.rows.take(MOVES_SHOWN - 1) + trade).distinct())
        }

    private companion object {
        const val MOVES_SHOWN = 8

        /** A Pixel 8: 1080 by 2400 at 420 dpi, the Pixel 6's screen. */
        val PIXEL_8 = DeviceConfig.PIXEL_6
        val SMALL = DeviceConfig.NEXUS_5
    }
}
