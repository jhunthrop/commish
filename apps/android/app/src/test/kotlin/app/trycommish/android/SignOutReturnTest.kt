package app.trycommish.android

import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.MemorySession
import app.trycommish.core.SignInState
import app.trycommish.core.SignOut
import app.trycommish.core.account.AccountFixtures
import app.trycommish.core.account.AccountHooks
import app.trycommish.core.account.AccountViewModel
import app.trycommish.core.account.StubAccountScreen
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.push.StaticPush
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

/**
 * Sign out with a detach in its undo window, through the app's own pieces (Lane 201 review H1 and M2):
 * the Account pushed on the Matchup tab with its view model on the back stack entry, the real SignOut and
 * SignInState over a session and a cache, and the shell's own startOver(). The phone ends on the League tab
 * signed out with nothing said, the Account's entry cleared, no tab's saved stack bringing it back, nothing
 * written into the cleared cache, and the league switch never asked to read an account it no longer has.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SDK])
class SignOutReturnTest {
    @get:Rule
    val compose = createComposeRule()

    private val pages = listOf(LEAGUE, MATCHUP)

    @Test
    fun signingOutInsideAnUndoWindowReturnsToSignInAndKeepsNothing() {
        val stub = StubAccountScreen()
        val session = MemorySession("token", AccountFixtures.PHONE)
        val cache = MemoryCache().apply { write("/me", Cached("{}", Fixtures.week)) }
        val state =
            SignInState(
                session,
                cache,
                SignOut(session, cache, {
                    stub.revokeDevice(it)
                    null
                }),
            )
        var shellReads = 0
        var account: AccountViewModel? = null
        lateinit var nav: NavHostController
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = LEAGUE) {
                composable(LEAGUE) { Text(LEAGUE) }
                composable(MATCHUP) { Text(MATCHUP) }
                composable(ACCOUNT) {
                    account =
                        viewModel {
                            AccountViewModel(
                                stub,
                                cache,
                                FixedClock(Fixtures.week),
                                Fixtures.zone,
                                StaticPush(),
                                { session.deviceId },
                                AccountHooks(
                                    signOut = { runBlocking { state.signOut() } },
                                    sessionEnd = state.sessionEnd,
                                    leaguesChanged = { shellReads++ },
                                    signedIn = state::holdsToken,
                                    deleted = {},
                                ),
                            )
                        }
                }
            }
        }
        compose.runOnIdle {
            nav.openTab(MATCHUP)
            nav.navigate(ACCOUNT)
        }
        compose.waitForIdle()
        val vm = requireNotNull(account)
        compose.runOnIdle { vm.load() }
        compose.waitForIdle()
        compose.runOnIdle { vm.detach(AccountFixtures.SHOWN[1]) }
        compose.waitForIdle()
        assertEquals(listOf(AccountFixtures.SHOWN[1]), stub.detached)

        // The member goes back to the League tab: the Matchup tab's stack, the Account in it, is saved.
        compose.runOnIdle { nav.openTab(LEAGUE) }
        compose.waitForIdle()
        // Sign out inside the window, then the shell's reaction to signedIn turning false.
        compose.runOnIdle { vm.signOut() }
        assertFalse(state.signedIn.value)
        compose.runOnIdle { nav.startOver(pages) }
        compose.waitForIdle()

        assertEquals(listOf(AccountFixtures.PHONE), stub.revoked)
        assertNull(session.token)
        assertNull(state.message.value)
        assertEquals(LEAGUE, nav.currentDestination?.route)
        assertNull(cache.read(AccountViewModel.ROUTE))
        assertNull(cache.read("/me"))
        assertEquals(0, shellReads)
        // The Matchup tab opens on its own page: the saved stack with the Account in it was let go.
        compose.runOnIdle { nav.openTab(MATCHUP) }
        compose.waitForIdle()
        assertEquals(MATCHUP, nav.currentDestination?.route)
        assertTrue(runCatching { nav.getBackStackEntry(ACCOUNT) }.isFailure)
    }

    /** A screen's state on an entry, cleared with it. */
    class Held : ViewModel() {
        var cleared = false

        override fun onCleared() {
            cleared = true
        }
    }

    @Test
    fun `starting over for the next account clears every entry's view model, the start tab's too`() {
        val held = mutableMapOf<String, Held>()
        lateinit var nav: NavHostController
        compose.setContent {
            nav = rememberNavController()
            NavHost(nav, startDestination = LEAGUE) {
                pages.forEach { page ->
                    composable(page) {
                        held[page] = viewModel(key = page) { Held() }
                        Text(page)
                    }
                }
            }
        }
        compose.waitForIdle()
        val league = requireNotNull(held[LEAGUE])
        compose.runOnIdle { nav.openTab(MATCHUP) }
        compose.waitForIdle()
        val matchup = requireNotNull(held[MATCHUP])
        compose.runOnIdle { nav.startOver(pages) }
        compose.waitForIdle()
        assertEquals(LEAGUE, nav.currentDestination?.route)
        assertTrue(league.cleared)
        assertTrue(matchup.cleared)
        // The new League tab has a view model of its own, and nothing sits under it.
        assertTrue(held.getValue(LEAGUE) !== league)
        assertNull(nav.previousBackStackEntry)
    }
}

private const val SDK = 35
private const val LEAGUE = "league"
private const val MATCHUP = "matchup"
private const val ACCOUNT = "account"
