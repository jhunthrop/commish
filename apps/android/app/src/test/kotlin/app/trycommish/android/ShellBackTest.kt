package app.trycommish.android

import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The system back in the shell, through PagesWithBack and the shell's own openTab over a NavHost that starts
 * at the League page as the app's does: an open league switch is closed first, even over a page with its own
 * back; back from a tab's root opens the bar's first tab; back from the first tab's root leaves the app,
 * whatever page sits under it (a draft bar holds no League tab). Robolectric runs these at 35, its newest;
 * the dispatcher's order is the same at 36.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SDK])
class ShellBackTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var nav: NavHostController
    private lateinit var dispatcher: OnBackPressedDispatcher
    private var switchOpen by mutableStateOf(false)
    private var pageBacks by mutableIntStateOf(0)
    private var left = 0

    private fun shell(bar: List<String>) {
        compose.setContent {
            dispatcher = requireNotNull(LocalOnBackPressedDispatcherOwner.current).onBackPressedDispatcher
            nav = rememberNavController()
            PagesWithBack(
                nav,
                bar,
                BackVerbs(openTab = { nav.openTab(it) }, leave = { left++ }),
                switchOpen,
                closeSwitch = { switchOpen = false },
            ) {
                NavHost(nav, startDestination = LEAGUE) {
                    composable(LEAGUE) { Text(LEAGUE) }
                    composable(MATCHUP) { Text(MATCHUP) }
                    composable(BOARD) { Text(BOARD) }
                    composable(PLAYERS) { Text(PLAYERS) }
                    // A page with its own back, as the mock room's ask before leaving will be.
                    composable(ROOM) {
                        BackHandler { pageBacks++ }
                        Text(ROOM)
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun act(block: () -> Unit) {
        compose.runOnIdle(block)
        compose.waitForIdle()
    }

    private fun back() = act { dispatcher.onBackPressed() }

    private val shown: String? get() = nav.currentDestination?.route

    @Test
    fun backClosesAnOpenSwitchBeforeItPopsTheTab() {
        shell(listOf(LEAGUE, MATCHUP))
        act {
            nav.openTab(MATCHUP)
            switchOpen = true
        }
        back()
        assertFalse(switchOpen)
        assertEquals(MATCHUP, shown)

        // With the switch closed, back leaves the tab for the bar's first, the League tab.
        back()
        assertEquals(LEAGUE, shown)
        assertEquals(LEAGUE, tabShown(shown, MATCHUP))
        // At the first tab's root with nothing under it the app has no back of its own: the system's leaves.
        assertFalse(dispatcher.hasEnabledCallbacks())
        assertEquals(0, left)
    }

    @Test
    fun anOpenSwitchClosesBeforeAPageThatHasItsOwnBack() {
        shell(listOf(LEAGUE, MATCHUP))
        // The page draws after the shell, so its back is newer than any the shell made at first draw.
        act { nav.navigate(ROOM) }
        act { switchOpen = true }
        back()
        assertFalse(switchOpen)
        assertEquals(0, pageBacks)
        assertEquals(ROOM, shown)

        // With the switch closed, the page's own back answers, ahead of the shell's.
        back()
        assertEquals(1, pageBacks)
        assertEquals(ROOM, shown)
    }

    @Test
    fun aDraftBarsFirstTabIsTheStartBackFromItsRootLeavesTheApp() {
        // pre_draft's bar: Board first, no League tab. The NavHost still starts at League under it.
        val bar = listOf(BOARD, PLAYERS)
        shell(bar)
        act { nav.openTab(BOARD) }

        back()
        assertEquals(1, left)
        assertEquals(BOARD, shown)
        assertEquals(BOARD, tabShown(shown, BOARD, bar))

        // Back from another tab's root opens the first tab, not the League page no tab of this bar holds.
        act { nav.openTab(PLAYERS) }
        back()
        assertEquals(BOARD, shown)
        assertEquals(1, left)
        assertTrue(shown in bar)
    }

    @Test
    fun theChosenTabIsThePageShownOrTheTabUnderAPushedScreen() {
        val pages = listOf(LEAGUE, MATCHUP)
        assertEquals(LEAGUE, tabShown(LEAGUE, MATCHUP, pages))
        assertEquals(MATCHUP, tabShown(MATCHUP, LEAGUE, pages))
        // A pushed screen (the Account) sits on the tab it was opened from.
        assertEquals(MATCHUP, tabShown(ROOM, MATCHUP, pages))
        assertEquals(MATCHUP, tabShown(null, MATCHUP, pages))
    }
}

private const val SDK = 35
private const val LEAGUE = "league"
private const val MATCHUP = "matchup"
private const val BOARD = "board"
private const val PLAYERS = "players"
private const val ROOM = "room"
