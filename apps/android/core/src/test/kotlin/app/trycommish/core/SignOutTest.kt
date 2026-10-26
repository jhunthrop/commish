package app.trycommish.core

import app.trycommish.api.Unauthorized
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.io.IOException
import java.time.Instant

/** Sign out (B228): the phone always forgets its token and kept answers; the WorkOS logout URL the API
 * answers is opened once, after the phone has signed out, and nothing is opened for a null URL or a
 * failed call. The shell's generation moves at each sign-in and sign-out only (iOS's
 * theGenerationMovesAtSignInAndSignOutOnly). */
class SignOutTest {
    private val logout = "https://api.workos.test/user_management/sessions/logout?session_id=session_1"
    private val stamp = Instant.parse("2026-10-26T17:00:00Z")

    private class Opened {
        val urls = mutableListOf<String>()
        var signedInWhenOpened: Boolean? = null
    }

    private fun signOut(
        session: MemorySession,
        cache: MemoryCache,
        opened: Opened,
        revoke: suspend (String) -> String?,
    ) = SignOut(session, cache, revoke, openLogout = {
        opened.signedInWhenOpened = session.token != null
        opened.urls += it
    })

    private fun signedIn() = MemorySession("token", "device-1")

    private fun kept() = MemoryCache().apply { write("/me", Cached("{}", stamp)) }

    @Test
    fun `a logout URL is opened once the phone has signed out`() =
        runTest {
            val session = signedIn()
            val cache = kept()
            val opened = Opened()
            val revoked = mutableListOf<String>()
            signOut(session, cache, opened) {
                revoked += it
                logout
            }()
            assertEquals(listOf("device-1"), revoked)
            assertEquals(listOf(logout), opened.urls)
            assertEquals(false, opened.signedInWhenOpened)
            assertNull(session.token)
            assertNull(cache.read("/me"))
        }

    @Test
    fun `no URL, a refused token or no signal sign out locally and open nothing`() =
        runTest {
            val answers: List<suspend (String) -> String?> =
                listOf({ null }, { throw Unauthorized() }, { throw IOException("no signal") })
            answers.forEach { revoke ->
                val session = signedIn()
                val cache = kept()
                val opened = Opened()
                signOut(session, cache, opened, revoke)()
                assertEquals(emptyList<String>(), opened.urls)
                assertNull(session.token)
                assertNull(cache.read("/me"))
            }
        }

    @Test
    fun `a phone with no device id revokes nothing and still signs out`() =
        runTest {
            val session = MemorySession("token", null)
            val opened = Opened()
            signOut(session, kept(), opened) { error("not called") }()
            assertEquals(emptyList<String>(), opened.urls)
            assertNull(session.token)
        }

    @Test
    fun `the generation moves at sign-in and sign-out only`() =
        runTest {
            val session = MemorySession()
            val cache = MemoryCache()
            val state = SignInState(session, cache, SignOut(session, cache, { null }))
            assertEquals(0, state.generation.value)
            session.signIn("token", "device-1")
            state.signedInNow()
            assertEquals(1, state.generation.value)
            // A second finish of the same sign-in (a return link handled twice) is the same account.
            state.signedInNow()
            assertEquals(1, state.generation.value)
            state.signOut()
            assertEquals(2, state.generation.value)
            // A refused token while already signed out is no new account.
            state.sessionEnd.signedOut()
            assertEquals(2, state.generation.value)
            session.signIn("token-2", "device-2")
            state.signedInNow()
            assertEquals(3, state.generation.value)
            state.sessionEnd.signedOut()
            assertEquals(4, state.generation.value)
        }
}
