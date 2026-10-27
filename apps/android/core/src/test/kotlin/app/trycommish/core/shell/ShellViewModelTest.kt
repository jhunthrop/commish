package app.trycommish.core.shell

import app.trycommish.api.Unauthorized
import app.trycommish.api.models.SiteSeason
import app.trycommish.core.AccountGeneration
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.MemorySession
import app.trycommish.core.SessionEnd
import app.trycommish.core.SignInState
import app.trycommish.core.SignOut
import app.trycommish.core.leaguehome.Fixtures
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import java.time.Instant

/** The shell's account: GET /me's leagues in its order, the site's selection leading when read fresh,
 * the phone's last choice from the kept copy, the bar by the site's season with no league, and a
 * choice shown at once and written to the site with no answer taking it back but a 401. */
@OptIn(ExperimentalCoroutinesApi::class)
class ShellViewModelTest {
    private val main = StandardTestDispatcher()
    private val clock = FixedClock(ShellFixtures.week)
    private val earlier = Instant.parse("2026-10-16T17:00:00Z")
    private val leagues = ShellFixtures.three()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    /** The fake API: GET /me answers `me` (or throws it), PUT /me/league records the id and answers
     * `taken`, or throws `write`. */
    private class FakeAccount(
        private val me: () -> String,
        private val write: Exception? = null,
        private val gate: CompletableDeferred<Unit>? = null,
        private val taken: Boolean = true,
    ) : AccountReads {
        val selected = mutableListOf<String>()

        override suspend fun me(): String {
            gate?.await()
            return me.invoke()
        }

        override suspend fun selectLeague(leagueId: String): Boolean {
            selected += leagueId
            write?.let { throw it }
            return taken
        }

        override suspend fun revokeDevice(deviceId: String): String? = null
    }

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private fun offline(): String = throw IOException("Unable to resolve host")

    /** The phone's account generation, moved by hand. */
    private class Accounts : AccountGeneration {
        override val generation = MutableStateFlow(1)
        private val hooks = mutableListOf<() -> Unit>()

        override fun onSignOut(hook: () -> Unit): AutoCloseable {
            hooks += hook
            return AutoCloseable { hooks -= hook }
        }

        fun signedOut() {
            generation.value++
            hooks.toList().forEach { it() }
        }

        fun signedIn() {
            generation.value++
        }
    }

    private fun viewModel(
        reads: AccountReads,
        cache: MemoryCache = MemoryCache(),
        ends: Ends = Ends(),
        accounts: AccountGeneration = Accounts(),
    ) = ShellViewModel(reads, cache, clock, Fixtures.zone, ends, accounts)

    private fun ShellViewModel.ready(): ShellState.Ready = assertInstanceOf(ShellState.Ready::class.java, state.value)

    @Test
    fun `GET me lists every league in its order with the site's selection shown, and is kept`() =
        runTest(main) {
            val cache = MemoryCache()
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, leagues[2].id) }), cache)
            vm.open()
            advanceUntilIdle()
            assertEquals(leagues, vm.ready().leagues)
            assertEquals(leagues[2].id, vm.ready().selected?.id)
            assertEquals(listOf(false, false, true), vm.leagueSwitch().rows.map { it.selected })
            assertEquals("Office Pool", vm.leagueSwitch().face)
            assertEquals(ShellFixtures.week, cache.read(ShellKeys.ACCOUNT)?.stamp)
        }

    @Test
    fun `read fresh, the site's selection leads the phone's last choice`() =
        runTest(main) {
            val cache = MemoryCache().apply { write(ShellKeys.LAST_LEAGUE, Cached(leagues[1].id, earlier)) }
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, leagues[0].id) }), cache)
            vm.open()
            advanceUntilIdle()
            assertEquals(leagues[0].id, vm.ready().selected?.id)
        }

    @Test
    fun `the kept account shows at once with the phone's last choice, then the API's`() =
        runTest(main) {
            val gate = CompletableDeferred<Unit>()
            val cache =
                MemoryCache().apply {
                    write(ShellKeys.ACCOUNT, Cached(ShellFixtures.meBody(leagues, leagues[0].id), earlier))
                    write(ShellKeys.LAST_LEAGUE, Cached(leagues[1].id, earlier))
                }
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, leagues[2].id) }, gate = gate), cache)
            vm.open()
            runCurrent()
            assertEquals(leagues[1].id, vm.ready().selected?.id)
            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(leagues[2].id, vm.ready().selected?.id)
        }

    @Test
    fun `with no signal the kept account stays, and with nothing kept the shell says so`() =
        runTest(main) {
            val cache = MemoryCache().apply { write(ShellKeys.ACCOUNT, Cached(ShellFixtures.meBody(leagues, leagues[0].id), earlier)) }
            val kept = viewModel(FakeAccount(::offline), cache)
            kept.open()
            advanceUntilIdle()
            assertEquals(leagues, kept.ready().leagues)
            val cold = viewModel(FakeAccount(::offline))
            cold.open()
            advanceUntilIdle()
            assertEquals(ShellState.Unreachable, cold.state.value)
        }

    @Test
    fun `a 401 on GET me signs the device out`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(FakeAccount({ throw Unauthorized() }), ends = ends)
            vm.open()
            advanceUntilIdle()
            assertEquals(ShellState.SignedOut, vm.state.value)
            assertEquals(1, ends.count)
        }

    @Test
    fun `a choice shows at once, is kept, and is written to the site`() =
        runTest(main) {
            val reads = FakeAccount({ ShellFixtures.meBody(leagues, leagues[0].id) })
            val cache = MemoryCache()
            val vm = viewModel(reads, cache)
            vm.open()
            advanceUntilIdle()
            vm.choose(leagues[1].id)
            assertEquals(leagues[1].id, vm.ready().selected?.id)
            assertEquals(leagues[1].id, cache.read(ShellKeys.LAST_LEAGUE)?.body)
            advanceUntilIdle()
            assertEquals(listOf(leagues[1].id), reads.selected)
        }

    @Test
    fun `a write the site refuses or cannot take keeps the choice`() =
        runTest(main) {
            listOf(IOException("no signal"), IllegalStateException("404")).forEach { failure ->
                val ends = Ends()
                val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, leagues[0].id) }, write = failure), ends = ends)
                vm.open()
                advanceUntilIdle()
                vm.choose(leagues[2].id)
                advanceUntilIdle()
                assertEquals(leagues[2].id, vm.ready().selected?.id)
                assertEquals(0, ends.count)
            }
        }

    @Test
    fun `a write answered 401 signs the device out`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, leagues[0].id) }, write = Unauthorized()), ends = ends)
            vm.open()
            advanceUntilIdle()
            vm.choose(leagues[1].id)
            advanceUntilIdle()
            assertEquals(ShellState.SignedOut, vm.state.value)
            assertEquals(1, ends.count)
        }

    @Test
    fun `a choice the site did not take holds against the next read, until a read agrees`() =
        runTest(main) {
            listOf(FakeAccount({ "" }, write = IOException("no signal")), FakeAccount({ "" }, taken = false)).forEach { failed ->
                var site = leagues[0].id
                val reads =
                    object : AccountReads by failed {
                        override suspend fun me(): String = ShellFixtures.meBody(leagues, site)
                    }
                val vm = viewModel(reads)
                vm.open()
                advanceUntilIdle()
                vm.choose(leagues[2].id)
                advanceUntilIdle()
                // The PUT failed; a read (a retry, the app back in front) still answers the old selection.
                vm.open()
                advanceUntilIdle()
                assertEquals(leagues[2].id, vm.ready().selected?.id)
                // A read that agrees releases the hold; the web's next choice then shows again.
                site = leagues[2].id
                vm.open()
                advanceUntilIdle()
                site = leagues[1].id
                vm.open()
                advanceUntilIdle()
                assertEquals(leagues[1].id, vm.ready().selected?.id)
            }
        }

    /** GET /me answers the site's selection as `site` says; PUT /me/league waits on `gate` the first
     * time and then fails with no signal, and every later PUT lands. */
    private class HeldThenFailed(
        var site: String,
        private val leagues: List<FollowedLeague>,
    ) : AccountReads {
        val gate = CompletableDeferred<Unit>()
        val selected = mutableListOf<String>()

        override suspend fun me(): String = ShellFixtures.meBody(leagues, site)

        override suspend fun selectLeague(leagueId: String): Boolean {
            selected += leagueId
            if (selected.size == 1) {
                gate.await()
                throw IOException("no signal")
            }
            site = leagueId
            return true
        }

        override suspend fun revokeDevice(deviceId: String): String? = null
    }

    @Test
    fun `a PUT held then failed is sent again on the next read, and once it lands the web's choice shows`() =
        runTest(main) {
            val reads = HeldThenFailed(leagues[0].id, leagues)
            val vm = viewModel(reads)
            vm.open()
            advanceUntilIdle()
            vm.choose(leagues[2].id)
            runCurrent()
            // The PUT is held: a read in between keeps the choice and sends nothing more.
            vm.open()
            advanceUntilIdle()
            assertEquals(leagues[2].id, vm.ready().selected?.id)
            assertEquals(listOf(leagues[2].id), reads.selected)
            // The PUT fails with no signal; the next read that goes through still disagrees, so it is sent again.
            reads.gate.complete(Unit)
            advanceUntilIdle()
            vm.open()
            advanceUntilIdle()
            assertEquals(listOf(leagues[2].id, leagues[2].id), reads.selected)
            assertEquals(leagues[2].id, vm.ready().selected?.id)
            // The site has it now: the web's next choice shows, with no relaunch.
            reads.site = leagues[1].id
            vm.open()
            advanceUntilIdle()
            assertEquals(leagues[1].id, vm.ready().selected?.id)
            assertEquals(2, reads.selected.size)
        }

    @Test
    fun `a held choice the account no longer follows is dropped, not sent again`() =
        runTest(main) {
            var shown = leagues
            val failed = FakeAccount({ "" }, write = IOException("no signal"))
            val reads =
                object : AccountReads by failed {
                    override suspend fun me(): String = ShellFixtures.meBody(shown, shown[0].id)
                }
            val vm = viewModel(reads)
            vm.open()
            advanceUntilIdle()
            vm.choose(leagues[2].id)
            advanceUntilIdle()
            shown = leagues.take(2)
            vm.open()
            advanceUntilIdle()
            assertEquals(leagues[0].id, vm.ready().selected?.id)
            assertEquals(listOf(leagues[2].id), failed.selected)
        }

    @Test
    fun `signing out forgets the account, the held choice and the write on its way`() =
        runTest(main) {
            val reads = HeldThenFailed(leagues[0].id, leagues)
            val vm = viewModel(reads)
            vm.open()
            advanceUntilIdle()
            vm.choose(leagues[2].id)
            runCurrent()
            vm.forget()
            assertEquals(ShellState.Restoring, vm.state.value)
            reads.gate.complete(Unit)
            advanceUntilIdle()
            // The next account's read shows its own selection, and nothing of the last is sent.
            vm.open()
            advanceUntilIdle()
            assertEquals(leagues[0].id, vm.ready().selected?.id)
            assertEquals(listOf(leagues[2].id), reads.selected)
        }

    @Test
    fun `a read in flight at sign-out keeps nothing of the last account`() =
        runTest(main) {
            val gate = CompletableDeferred<Unit>()
            val session = MemorySession("token", "device-1")
            val cache = MemoryCache()
            val state = SignInState(session, cache, SignOut(session, cache, { null }))
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, leagues[1].id) }, gate = gate), cache, accounts = state)
            vm.open()
            runCurrent()
            state.signOut()
            assertEquals(ShellState.Restoring, vm.state.value)
            gate.complete(Unit)
            advanceUntilIdle()
            assertNull(cache.read(ShellKeys.ACCOUNT))
            assertNull(cache.read(ShellKeys.LAST_LEAGUE))
            assertEquals(ShellState.Restoring, vm.state.value)
        }

    @Test
    fun `a 401 for an account already let go signs nothing out`() =
        runTest(main) {
            val gate = CompletableDeferred<Unit>()
            val ends = Ends()
            val accounts = Accounts()
            val reads =
                object : AccountReads by FakeAccount({ "" }) {
                    override suspend fun me(): String {
                        gate.await()
                        throw Unauthorized()
                    }
                }
            val vm = viewModel(reads, ends = ends, accounts = accounts)
            vm.open()
            runCurrent()
            // The generation moves with no hook (another account's sign-in); the read in flight answers 401.
            accounts.signedIn()
            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(0, ends.count)
            assertEquals(ShellState.Restoring, vm.state.value)
        }

    @Test
    fun `the shell rebuilds once per account, and a held link waits for the rebuild and its sign-in`() =
        runTest(main) {
            val accounts = Accounts()
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, leagues[0].id) }), accounts = accounts)
            val companion = ShellRoute.Companion("draft")
            val shared = ShellRoute.SharedMock("abc123")
            // Built for the account in hand at start: no rebuild, a public link opens signed out, the
            // companion waits.
            assertEquals(ShellStep(rebuild = false, push = shared), vm.step(signedIn = false, asked = shared))
            assertEquals(ShellStep(rebuild = false, push = null), vm.step(signedIn = false, asked = companion))
            // Signed in: the screens are owed a rebuild and nothing is pushed until it is done.
            accounts.signedIn()
            assertEquals(ShellStep(rebuild = true, push = null), vm.step(signedIn = true, asked = companion))
            vm.rebuilt()
            assertEquals(ShellStep(rebuild = false, push = companion), vm.step(signedIn = true, asked = companion))
            vm.open()
            advanceUntilIdle()
            // Signed out: the account is forgotten at once and the rebuild is owed again.
            accounts.signedOut()
            assertEquals(ShellState.Restoring, vm.state.value)
            assertEquals(ShellStep(rebuild = true, push = null), vm.step(signedIn = false, asked = shared))
            vm.rebuilt()
            assertEquals(ShellStep(rebuild = false, push = null), vm.step(signedIn = false, asked = null))
        }

    @Test
    fun `a read in flight when a choice is made does not take it back, even once the PUT lands`() =
        runTest(main) {
            val gate = CompletableDeferred<Unit>()
            val cache = MemoryCache().apply { write(ShellKeys.ACCOUNT, Cached(ShellFixtures.meBody(leagues, leagues[0].id), earlier)) }
            val reads = FakeAccount({ ShellFixtures.meBody(leagues, leagues[0].id) }, gate = gate)
            val vm = viewModel(reads, cache)
            vm.open()
            runCurrent()
            assertEquals(leagues[0].id, vm.ready().selected?.id)
            vm.choose(leagues[1].id)
            advanceUntilIdle()
            assertEquals(listOf(leagues[1].id), reads.selected)
            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(leagues[1].id, vm.ready().selected?.id)
        }

    @Test
    fun `once the site takes the choice, its later selection leads again`() =
        runTest(main) {
            var site = leagues[0].id
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(leagues, site) }))
            vm.open()
            advanceUntilIdle()
            vm.choose(leagues[1].id)
            advanceUntilIdle()
            site = leagues[2].id
            vm.open()
            advanceUntilIdle()
            assertEquals(leagues[2].id, vm.ready().selected?.id)
        }

    @Test
    fun `a league the account does not follow is no choice`() =
        runTest(main) {
            val reads = FakeAccount({ ShellFixtures.meBody(leagues, leagues[0].id) })
            val vm = viewModel(reads)
            vm.open()
            advanceUntilIdle()
            vm.choose("not-followed")
            advanceUntilIdle()
            assertEquals(leagues[0].id, vm.ready().selected?.id)
            assertEquals(emptyList<String>(), reads.selected)
        }

    @Test
    fun `with no league the bar is the site's season's, and an absent season reads as in season`() =
        runTest(main) {
            val preseason = viewModel(FakeAccount({ ShellFixtures.meBody(emptyList(), null, season = "preseason") }))
            preseason.open()
            advanceUntilIdle()
            assertNull(preseason.ready().selected)
            assertEquals(SiteSeason.Phase.preseason, preseason.ready().season)
            assertEquals(listOf("Board", "Players", "Mock draft", "Cheat sheet", "Advisor"), preseason.bar().map { it.label })
            val older = viewModel(FakeAccount({ ShellFixtures.meBody(emptyList(), null, season = null) }))
            older.open()
            advanceUntilIdle()
            assertNull(older.ready().season)
            assertEquals(listOf("League", "Rest of season", "Rankings", "Mock draft", "Our record"), older.bar().map { it.label })
        }

    @Test
    fun `a season this build does not know reads as in season`() =
        runTest(main) {
            val vm = viewModel(FakeAccount({ ShellFixtures.meBody(emptyList(), null, season = "postseason") }))
            vm.open()
            advanceUntilIdle()
            assertNull(vm.ready().season)
        }
}
