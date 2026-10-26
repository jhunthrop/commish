package app.trycommish.android

import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.MemorySession
import app.trycommish.core.SignInState
import app.trycommish.core.SignOut
import app.trycommish.core.shell.AccountReads
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.ShellFixtures
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.ShellState
import app.trycommish.core.shell.ShellViewModel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId

/**
 * The shell's rebuild per account and its held link (Lane 236 review M3), through the shell's own pieces:
 * the real SignInState and SignOut, the shell's view model and chrome, and a NavHost with the Account pushed.
 * A sign-out forgets the account at once (Restoring); the next pass lets the room, the sheet, the switch,
 * the search and the Account go; a Companion link held signed out opens only after the sign-in and the
 * rebuild, and a shared mock opens signed out.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ShellRebuildTest {
    @get:Rule
    val compose = createComposeRule()

    private val leagues = ShellFixtures.three()
    private val pages = listOf(LEAGUE, MATCHUP)

    private val reads =
        object : AccountReads {
            override suspend fun me(): String = ShellFixtures.meBody(leagues, leagues[0].id)

            override suspend fun selectLeague(leagueId: String): Boolean = true

            override suspend fun revokeDevice(deviceId: String): String? = null
        }

    private fun chrome() =
        ShellChrome(mutableStateOf(MATCHUP), mutableStateOf(true), mutableStateOf("puka"), mutableStateOf("room-1"), PlayerSheetHost())

    private val player = SheetPlayer("p1", "puka-nacua", "Puka Nacua", "WR", "WR1", "LAR", null)

    @Test
    fun `a sign-out lets every screen go and a held companion link waits for the next sign-in`() {
        val session = MemorySession("token", "device-1")
        val cache = MemoryCache()
        val state = SignInState(session, cache, SignOut(session, cache, { null }))
        val shell = ShellViewModel(reads, cache, FixedClock(ShellFixtures.week), ZoneId.of("America/Chicago"), state.sessionEnd, state)
        val chrome = chrome().apply { sheet.open(player) }
        lateinit var nav: NavHostController
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = LEAGUE) {
                (pages + ACCOUNT).forEach { page -> composable(page) { Text(page) } }
            }
        }
        compose.runOnIdle {
            shell.open()
            nav.openTab(MATCHUP)
            nav.navigate(ACCOUNT)
        }
        compose.waitForIdle()
        compose.runOnIdle { assertTrue(shell.state.value is ShellState.Ready) }

        // Built for this account: nothing to rebuild, nothing held.
        compose.runOnIdle { assertNull(chrome.follow(shell, nav, signedIn = true, asked = null, pages = pages)) }
        assertEquals(ACCOUNT, nav.currentDestination?.route)

        // Sign out: the account is forgotten at once, before any pass of the shell.
        runBlocking { state.signOut() }
        assertEquals(ShellState.Restoring, shell.state.value)
        val companion = ShellRoute.Companion("draft")
        compose.runOnIdle { assertNull(chrome.follow(shell, nav, signedIn = false, asked = companion, pages = pages)) }
        compose.waitForIdle()
        assertEquals(LEAGUE, nav.currentDestination?.route)
        assertNull(nav.previousBackStackEntry)
        assertTrue(runCatching { nav.getBackStackEntry(ACCOUNT) }.isFailure)
        assertEquals(LEAGUE, chrome.tab)
        assertFalse(chrome.switchOpen)
        assertEquals("", chrome.query)
        assertNull(chrome.mockRoom)
        assertNull(chrome.sheet.shown.value)

        // Still signed out: the companion waits, a shared mock opens.
        compose.runOnIdle {
            assertNull(chrome.follow(shell, nav, signedIn = false, asked = companion, pages = pages))
            val shared = ShellRoute.SharedMock("abc123")
            assertEquals(shared, chrome.follow(shell, nav, signedIn = false, asked = shared, pages = pages))
        }

        // The next sign-in: the shell is rebuilt for it, and only then is the companion pushed.
        session.signIn("token-2", "device-2")
        state.signedInNow()
        chrome.mockRoom = "room-of-the-last-pass"
        compose.runOnIdle { assertEquals(companion, chrome.follow(shell, nav, signedIn = true, asked = companion, pages = pages)) }
        assertNull(chrome.mockRoom)
    }
}

private const val LEAGUE = "league"
private const val MATCHUP = "matchup"
private const val ACCOUNT = "account"
