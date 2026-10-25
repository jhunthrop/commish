package app.trycommish.android

import androidx.compose.ui.test.junit4.createComposeRule
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.player.PlayerSheetViewModel
import app.trycommish.core.player.PlayerSheets
import app.trycommish.core.player.StubPages
import app.trycommish.core.player.StubWeeks
import app.trycommish.core.player.WeekFixture
import app.trycommish.core.player.playerGraph
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.feature.player.PlayerSheetContainer
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Review Focus 3 at the composable layer, as iOS's SheetContainerTests holds it: the sheet the shell draws
 * (PlayerSheetContainer over Lane 179's frame) is opened on a player, the list under it reads again with
 * a new order and his fresh facts, and the sheet keeps him with the one view model it made for his id and
 * the one read of his week; a sheet on another player makes his own.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SDK])
class PlayerSheetContainerTest {
    @get:Rule
    val compose = createComposeRule()

    private val odunze = SheetPlayer("host-4431299", "rome-odunze", "Rome Odunze", "WR", "25", "CHI", null, boardId = "4431299")
    private val mahomes = SheetPlayer("host-3139477", "patrick-mahomes", "Patrick Mahomes", "QB", "9", "KC", null, boardId = "3139477")

    private val league =
        FollowedLeague(
            WeekFixture.LEAGUE,
            "Sunday Standard",
            LeagueHost.espn,
            ScoringPreset.ppr,
            BoardFormat.ppr,
            LeaguePhase.in_season,
            null,
            true,
        )

    @Test
    fun theSheetKeepsItsPlayerAndItsOneViewModelAcrossAParentRefresh() {
        val weeks = StubWeeks()
        val graph =
            playerGraph(
                StubRunReads(RunFixture.StandIn),
                StubPages(RunFixture.StandIn),
                weeks,
                MemoryCache(),
                FixedClock(WeekFixture.week),
            )
        val made = mutableListOf<PlayerSheetViewModel>()
        val sheets = PlayerSheets { player -> PlayerSheetViewModel(player, graph, league).also { made += it } }
        val host = PlayerSheetHost()
        compose.setContent { CommishTheme { PlayerSheetContainer(host, sheets) {} } }

        compose.runOnIdle { host.open(odunze) }
        compose.waitForIdle()
        // The list under the sheet reads again: a new order, his fresh facts.
        compose.runOnIdle { host.parentRefreshed(listOf(mahomes, odunze.copy(rank = "24"))) }
        compose.waitForIdle()

        assertEquals(odunze.id, host.shown.value?.id)
        assertEquals("24", host.shown.value?.rank)
        assertEquals("one view model", 1, made.size)
        assertEquals("one week read", listOf("league:4431299"), weeks.reads)

        compose.runOnIdle { host.open(mahomes) }
        compose.waitForIdle()
        assertEquals(listOf(odunze.id, mahomes.id), made.map { it.player.id })
    }
}

/** The SDK the JVM tests draw on (Robolectric's newest for this compileSdk). */
private const val SDK = 35
