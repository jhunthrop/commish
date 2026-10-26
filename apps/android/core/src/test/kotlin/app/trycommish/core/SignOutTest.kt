package app.trycommish.core

import app.trycommish.api.Unauthorized
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.io.IOException
import java.time.Instant

/** Sign out (B228): the phone always forgets its token and kept answers; the WorkOS logout URL the API
 * answers opens once, only after the phone is signed out, the generation has moved and every sign-out hook
 * has run, and nothing opens for a null URL or a failed call. The generation moves at each sign-in and
 * sign-out only (iOS's theGenerationMovesAtSignInAndSignOutOnly). */
class SignOutTest {
    private val logout = "https://api.workos.com/user_management/sessions/logout?session_id=session_1"
    private val stamp = Instant.parse("2026-10-26T17:00:00Z")

    /** What the phone looked like the moment the logout URL opened. */
    private data class AtOpen(
        val url: String,
        val token: String?,
        val kept: Cached?,
        val signedIn: Boolean,
        val generation: Int,
        val hooksRun: Int,
    )

    private class Phone(
        revoke: suspend (String) -> String?,
    ) {
        val session = MemorySession("token", "device-1")
        val cache = MemoryCache().apply { write("/me", Cached("{}", Instant.parse("2026-10-26T17:00:00Z"))) }
        val opened = mutableListOf<AtOpen>()
        var hooksRun = 0
        val revoked = mutableListOf<String>()
        val state: SignInState =
            SignInState(
                session,
                cache,
                SignOut(session, cache, {
                    revoked += it
                    revoke(it)
                }),
            ) { url ->
                opened += AtOpen(url, session.token, cache.read("/me"), state.signedIn.value, state.generation.value, hooksRun)
            }

        init {
            state.onSignOut { hooksRun++ }
        }
    }

    @Test
    fun `the logout URL opens once, after the account is let go`() =
        runTest {
            val phone = Phone { logout }
            phone.state.signOut()
            assertEquals(listOf("device-1"), phone.revoked)
            assertEquals(listOf(AtOpen(logout, null, null, false, 1, 1)), phone.opened)
            assertNull(phone.state.message.value)
        }

    @Test
    fun `no URL, a refused token or no signal sign out locally and open nothing`() =
        runTest {
            val answers: List<suspend (String) -> String?> =
                listOf({ null }, { throw Unauthorized() }, { throw IOException("no signal") })
            answers.forEach { revoke ->
                val phone = Phone(revoke)
                phone.state.signOut()
                assertEquals(emptyList<AtOpen>(), phone.opened)
                assertNull(phone.session.token)
                assertNull(phone.cache.read("/me"))
                assertFalse(phone.state.signedIn.value)
                assertEquals(1, phone.hooksRun)
            }
        }

    @Test
    fun `a phone with no device id revokes nothing and still signs out`() =
        runTest {
            val session = MemorySession("token", null)
            val cache = MemoryCache().apply { write("/me", Cached("{}", stamp)) }
            val url = SignOut(session, cache, { error("not called") })()
            assertNull(url)
            assertNull(session.token)
            assertNull(cache.read("/me"))
        }

    @Test
    fun `a 401 that answers after a deliberate sign-out says nothing and moves nothing`() =
        runTest {
            val phone = Phone { null }
            phone.state.signOut()
            phone.state.sessionEnd.signedOut()
            assertNull(phone.state.message.value)
            assertEquals(1, phone.state.generation.value)
            assertEquals(1, phone.hooksRun)
        }

    @Test
    fun `the generation moves at sign-in and sign-out only, and a closed hook runs no more`() =
        runTest {
            val session = MemorySession()
            val cache = MemoryCache()
            val state = SignInState(session, cache, SignOut(session, cache, { null }))
            var heard = 0
            val hook = state.onSignOut { heard++ }
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
            assertEquals(AppWords.signedOut, state.message.value)
            assertEquals(2, heard)
            hook.close()
            state.signedInNow()
            state.signOut()
            assertEquals(2, heard)
        }
}
