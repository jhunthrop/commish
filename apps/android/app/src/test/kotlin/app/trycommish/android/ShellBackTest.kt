package app.trycommish.android

import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The system back in the shell (Lane 218 device pass on Android 16, where back reaches the app only through
 * the dispatcher): an open league switch is closed by back before any page is popped, and the bar's chosen
 * tab follows the page back lands on.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SDK])
class ShellBackTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun backClosesAnOpenSwitchBeforeItPopsTheTab() {
        var switchOpen by mutableStateOf(false)
        lateinit var nav: NavHostController
        lateinit var dispatcher: OnBackPressedDispatcher
        compose.setContent {
            dispatcher = requireNotNull(LocalOnBackPressedDispatcherOwner.current).onBackPressedDispatcher
            PagesUnderSwitch(switchOpen, closeSwitch = { switchOpen = false }) {
                nav = rememberNavController()
                NavHost(nav, startDestination = LEAGUE) {
                    composable(LEAGUE) { Text(LEAGUE) }
                    composable(MATCHUP) { Text(MATCHUP) }
                }
            }
        }
        compose.runOnIdle {
            nav.openTab(MATCHUP)
            switchOpen = true
        }
        compose.waitForIdle()

        compose.runOnIdle { dispatcher.onBackPressed() }
        compose.waitForIdle()
        assertFalse(switchOpen)
        assertEquals(MATCHUP, nav.currentDestination?.route)

        // With the switch closed, back leaves the tab for the League tab, as before.
        compose.runOnIdle { dispatcher.onBackPressed() }
        compose.waitForIdle()
        assertEquals(LEAGUE, nav.currentDestination?.route)
    }

    @Test
    fun theChosenTabIsThePageShownOrTheTabUnderAPushedScreen() {
        val pages = listOf(LEAGUE, MATCHUP)
        // Back from the Matchup tab's root landed on the League tab: the bar chooses League.
        assertEquals(LEAGUE, tabShown(LEAGUE, MATCHUP, pages))
        assertEquals(MATCHUP, tabShown(MATCHUP, LEAGUE, pages))
        // A pushed screen (the Account) sits on the tab it was opened from.
        assertEquals(MATCHUP, tabShown(ACCOUNT_ROUTE, MATCHUP, pages))
        assertEquals(MATCHUP, tabShown(null, MATCHUP, pages))
    }
}

private const val SDK = 35
private const val LEAGUE = "league"
private const val MATCHUP = "matchup"
private const val ACCOUNT_ROUTE = "account"
