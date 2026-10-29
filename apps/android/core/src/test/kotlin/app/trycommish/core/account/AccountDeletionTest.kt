package app.trycommish.core.account

import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.core.AppWords
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.MemorySession
import app.trycommish.core.SignInState
import app.trycommish.core.SignOut
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.push.StaticPush
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.File
import java.io.IOException
import java.time.Instant

/** The Account's Delete account dialog, as the iOS sheet's tests: the verb held until the typed email is the
 * account's (the web's rule, held to shared/fixtures/parity/account-delete.json), the line naming who is signed
 * in, a 204 that forgets the phone as a sign-out does (the token, the kept answers, signed out, nothing
 * revoked) and says the account is deleted, and the refusals in the API's words. */
@OptIn(ExperimentalCoroutinesApi::class)
class AccountDeletionTest {
    private val main = StandardTestDispatcher()
    private val parity =
        CommishJson
            .parseToJsonElement(File(System.getProperty("fixtures"), "parity/account-delete.json").readText())
            .jsonObject

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private class Heard {
        var deleted = 0
        var sessionEnds = 0
    }

    private fun TestScope.opened(
        stub: StubAccountScreen = StubAccountScreen(),
        cache: MemoryCache = MemoryCache(),
        heard: Heard = Heard(),
        sessionEnd: () -> Unit = { heard.sessionEnds++ },
        deleted: () -> Unit = { heard.deleted++ },
    ): AccountViewModel {
        val vm =
            AccountViewModel(
                stub,
                cache,
                FixedClock(Fixtures.week),
                Fixtures.zone,
                StaticPush(),
                { AccountFixtures.PHONE },
                AccountHooks({}, { sessionEnd() }, {}, { true }, deleted),
            )
        vm.load()
        advanceUntilIdle()
        vm.openDeletion()
        return vm
    }

    private fun AccountViewModel.shown(): DeletionUi = checkNotNull(deletion.ui.value) { "the dialog is closed" }

    @Test
    fun `the dialog waits for an account to be read`() =
        runTest(main) {
            val vm =
                AccountViewModel(
                    StubAccountScreen(),
                    MemoryCache(),
                    FixedClock(Fixtures.week),
                    Fixtures.zone,
                    StaticPush(),
                    { null },
                    AccountHooks({}, {}, {}, { true }, {}),
                )
            vm.openDeletion()
            assertNull(vm.deletion.ui.value)
        }

    @Test
    fun `the verb waits for the account's email as the web's rule says`() =
        runTest(main) {
            val vm = opened()
            val email = parity.getValue("email").jsonPrimitive.content
            assertEquals(email, vm.shown().email)
            assertEquals(parity.getValue("signedIn").jsonPrimitive.content, vm.shown().signedIn)
            assertFalse(vm.shown().canDelete)
            val cases = parity.getValue("confirm").jsonArray.map { it.jsonObject }
            assertEquals(7, cases.size)
            cases.forEach { case ->
                val typed = case.getValue("typed").jsonPrimitive.content
                val confirmed =
                    case
                        .getValue("confirmed")
                        .jsonPrimitive.content
                        .toBoolean()
                vm.deletion.type(typed)
                assertEquals(confirmed, vm.shown().canDelete, typed)
                assertEquals(confirmed, AccountDeletion.confirmed(typed, email), typed)
            }
        }

    @Test
    fun `a delete before the email matches sends nothing`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val heard = Heard()
            val vm = opened(stub, heard = heard)
            vm.deletion.type("fixture@example.co")
            assertNull(vm.deletion.delete())
            advanceUntilIdle()
            assertEquals(emptyList<String>(), stub.deletions)
            assertEquals(0, heard.deleted)
        }

    @Test
    fun `the verb is held while the delete runs`() =
        runTest(main) {
            val vm = opened()
            vm.deletion.type("fixture@example.com")
            vm.deletion.delete()
            assertTrue(vm.shown().busy)
            assertFalse(vm.shown().canDelete)
            vm.deletion.close()
            assertTrue(vm.deletion.ui.value != null)
            advanceUntilIdle()
        }

    @Test
    fun `a 204 forgets the phone and every kept answer and says the account is deleted`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val session = MemorySession("token", AccountFixtures.PHONE)
            val cache = MemoryCache()
            cache.write("/me", Cached("{}", Instant.EPOCH))
            var revoked = 0
            var logouts = 0
            val state =
                SignInState(
                    session,
                    cache,
                    SignOut(session, cache, {
                        revoked++
                        "https://auth.example/logout"
                    }),
                    openLogout = { logouts++ },
                )
            var forgotten = 0
            state.onSignOut { forgotten++ }
            val vm = opened(stub, cache, sessionEnd = { state.sessionEnd.signedOut() }, deleted = state::deleted)
            val before = state.generation.value
            assertTrue(state.signedIn.value)
            vm.deletion.type(" FIXTURE@example.com ")
            vm.deletion.delete()
            advanceUntilIdle()
            assertEquals(listOf(" FIXTURE@example.com "), stub.deletions)
            assertNull(session.token)
            assertNull(cache.read("/me"))
            assertNull(cache.read(AccountViewModel.ROUTE))
            assertFalse(state.signedIn.value)
            // A quiet notice, never the refusal slot the sign-in screen draws in red (review M1).
            assertEquals(Words.DeleteAccount.doneTitle, state.notice.value)
            assertNull(state.message.value)
            // The shell rebuilds for no account (the generation and the sign-out hooks), and no logout opens.
            assertEquals(before + 1, state.generation.value)
            assertEquals(1, forgotten)
            assertEquals(0, logouts)
            // The API deleted every device: nothing is revoked.
            assertEquals(0, revoked)
            assertNull(vm.deletion.ui.value)
            // The next sign-in says nothing of it.
            state.signedInNow()
            assertNull(state.message.value)
            assertNull(state.notice.value)
        }

    @Test
    fun `a wrong email says the API's sentence for it`() =
        runTest(main) {
            val stub = StubAccountScreen()
            stub.deleteRefusal = ApiFailure(BAD_REQUEST, "invalid", "Type the email you sign in with")
            val heard = Heard()
            val vm = opened(stub, heard = heard)
            vm.deletion.type("fixture@example.com")
            vm.deletion.delete()
            advanceUntilIdle()
            assertEquals("Type the email you sign in with", vm.shown().problem)
            assertTrue(vm.shown().canDelete)
            assertEquals(0, heard.deleted)
        }

    @Test
    fun `a renewing membership says the API's sentence and keeps the account`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val sentence = "Cancel your membership first, so your card is not charged again"
            stub.deleteRefusal = ApiFailure(CONFLICT, "conflict", sentence)
            val heard = Heard()
            val vm = opened(stub, heard = heard)
            vm.deletion.type("fixture@example.com")
            vm.deletion.delete()
            advanceUntilIdle()
            assertEquals(sentence, vm.shown().problem)
            assertEquals(0, heard.deleted)
            assertEquals(0, heard.sessionEnds)
        }

    @Test
    fun `a refused token signs out as today`() =
        runTest(main) {
            val stub = StubAccountScreen()
            stub.deleteRefusal = Unauthorized()
            val heard = Heard()
            val vm = opened(stub, heard = heard)
            vm.deletion.type("fixture@example.com")
            vm.deletion.delete()
            advanceUntilIdle()
            assertEquals(1, heard.sessionEnds)
            assertEquals(0, heard.deleted)
            assertEquals(AppWords.signedOut, vm.shown().problem)
        }

    @Test
    fun `no signal says the web's sentence`() =
        runTest(main) {
            val stub = StubAccountScreen()
            stub.deleteRefusal = IOException("no signal")
            val vm = opened(stub)
            vm.deletion.type("fixture@example.com")
            vm.deletion.delete()
            advanceUntilIdle()
            assertEquals(Words.DeleteAccount.failed, vm.shown().problem)
        }

    private companion object {
        const val BAD_REQUEST = 400
        const val CONFLICT = 409
    }
}
