package app.trycommish.core.account

import app.trycommish.api.models.NotificationKinds
import app.trycommish.api.models.NotificationKindsUpdate
import app.trycommish.api.models.NotificationSettings
import app.trycommish.api.models.NotificationSettingsUpdate
import app.trycommish.core.AppWords
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.MemorySession
import app.trycommish.core.SignInState
import app.trycommish.core.SignOut
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.push.PushControl
import app.trycommish.core.push.PushPermission
import app.trycommish.core.push.StaticPush
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant

/** The Account's view model over the fixture's account, three leagues and two devices at the week clock,
 * as the iOS one's tests (Lane 198 and its fix round). */
@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {
    private val main = StandardTestDispatcher()
    private val espn = AccountFixtures.SHOWN[1]

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    /** What the hooks were asked: sign-outs, refused sessions and the switch's re-reads. */
    private class Heard {
        var signOuts = 0
        var sessionEnds = 0
        var leaguesChanged = 0
        var deleted = 0
    }

    private fun account(
        stub: StubAccountScreen = StubAccountScreen(),
        cache: MemoryCache = MemoryCache(),
        store: PushControl = StaticPush(),
        heard: Heard = Heard(),
        now: Instant = Fixtures.week,
        signedIn: () -> Boolean = { true },
        sessionEnd: () -> Unit = { heard.sessionEnds++ },
        signOut: () -> Unit = { heard.signOuts++ },
    ) = AccountViewModel(
        stub,
        cache,
        FixedClock(now),
        Fixtures.zone,
        store,
        { AccountFixtures.PHONE },
        AccountHooks(signOut, { sessionEnd() }, { heard.leaguesChanged++ }, signedIn) { heard.deleted++ },
    )

    private fun AccountViewModel.loaded(): AccountState.Loaded = ui.value.state as AccountState.Loaded

    private fun TestScope.opened(vm: AccountViewModel): AccountViewModel {
        vm.load()
        advanceUntilIdle()
        return vm
    }

    @Test
    fun `the account reads with its leagues, this phone marked and the free season's plan`() =
        runTest(main) {
            val model = opened(account()).loaded().model
            assertEquals("fixture", model.name)
            assertEquals(3, model.leagues?.size)
            assertEquals("3, newest first", model.leaguesAside)
            assertEquals(listOf(true, false), model.devices.map { it.thisPhone })
            assertEquals(PlanCard.free, model.plan)
        }

    @Test
    fun `the API's free season flag decides before the date`() =
        runTest(main) {
            assertNull(opened(account(StubAccountScreen(flag = false))).loaded().model.plan)
            val after = PlanCard.freeSeasonEnds.plusSeconds(1)
            assertEquals(PlanCard.free, opened(account(StubAccountScreen(flag = true), now = after)).loaded().model.plan)
            assertNull(opened(account(now = after)).loaded().model.plan)
        }

    @Test
    fun `detach and restore round-trip against a stub`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val heard = Heard()
            val vm = opened(account(stub, heard = heard))
            vm.detach(espn)
            advanceTimeBy(1_000)
            assertEquals(
                listOf(false, true, false),
                vm
                    .loaded()
                    .model.leagues
                    ?.map { it.detached },
            )
            vm.restore(espn)
            advanceUntilIdle()
            assertEquals(listOf(espn), stub.detached)
            assertEquals(listOf(espn), stub.restored)
            assertEquals(
                listOf(false, false, false),
                vm
                    .loaded()
                    .model.leagues
                    ?.map { it.detached },
            )
            assertEquals(0, heard.leaguesChanged)
        }

    @Test
    fun `a detach keeps its row and Undo until the window closes, then tells the switch once`() =
        runTest(main) {
            val cache = MemoryCache()
            val heard = Heard()
            val vm = opened(account(cache = cache, heard = heard))
            vm.detach(espn)
            advanceTimeBy(AccountViewModel.UNDO_WINDOW.toMillis() - 1)
            assertTrue(
                vm
                    .loaded()
                    .model.leagues
                    .orEmpty()
                    .single { it.id == espn }
                    .detached,
            )
            assertEquals(0, heard.leaguesChanged)
            advanceUntilIdle()
            assertEquals(
                2,
                vm
                    .loaded()
                    .model.leagues
                    ?.size,
            )
            assertEquals(1, heard.leaguesChanged)
            val saved = requireNotNull(cache.read(AccountViewModel.ROUTE)).body
            assertFalse(espn in saved)
        }

    @Test
    fun `leaving the Account makes a pending detach final, exactly once`() =
        runTest(main) {
            val heard = Heard()
            val vm = opened(account(heard = heard))
            vm.detach(espn)
            advanceTimeBy(1_000)
            vm.leave()
            vm.leave()
            advanceUntilIdle()
            assertEquals(1, heard.leaguesChanged)
            assertEquals(
                2,
                vm
                    .loaded()
                    .model.leagues
                    ?.size,
            )
        }

    @Test
    fun `a refused restore keeps the row detached and says the API's sentence`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val vm = opened(account(stub))
            vm.detach(espn)
            advanceTimeBy(1_000)
            stub.restoreRefusal = "Following more than one league is part of Membership."
            vm.restore(espn)
            advanceTimeBy(1_000)
            assertTrue(
                vm
                    .loaded()
                    .model.leagues
                    .orEmpty()
                    .single { it.id == espn }
                    .detached,
            )
            assertEquals(AccountProblem(AccountSection.Leagues, requireNotNull(stub.restoreRefusal)), vm.ui.value.problem)
        }

    @Test
    fun `no signal on an action says the web's sentence`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val vm = opened(account(stub))
            stub.offline = true
            vm.unpair(AccountFixtures.OTHER)
            advanceUntilIdle()
            assertEquals(AccountProblem(AccountSection.Devices, Words.Account.failed), vm.ui.value.problem)
            assertEquals(
                2,
                vm
                    .loaded()
                    .model.devices.size,
            )
        }

    @Test
    fun `unpair removes the device from the list and a 401 afterwards signs out`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val heard = Heard()
            val vm = opened(account(stub, heard = heard))
            vm.unpair(AccountFixtures.OTHER)
            advanceUntilIdle()
            assertEquals(listOf(AccountFixtures.OTHER), stub.revoked)
            assertEquals(
                listOf(AccountFixtures.PHONE),
                vm
                    .loaded()
                    .model.devices
                    .map { it.id },
            )
            stub.refuse = true
            vm.load()
            advanceUntilIdle()
            assertEquals(AccountState.SignedOut, vm.ui.value.state)
            assertEquals(1, heard.sessionEnds)
        }

    @Test
    fun `this phone's row signs out through the session rather than unpairing it here`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val heard = Heard()
            val vm = opened(account(stub, heard = heard))
            vm.unpair(AccountFixtures.PHONE)
            advanceUntilIdle()
            assertEquals(1, heard.signOuts)
            assertTrue(stub.revoked.isEmpty())
        }

    @Test
    fun `sign out revokes and returns to sign-in`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val session = MemorySession("token", AccountFixtures.PHONE)
            val cache = MemoryCache()
            val state =
                SignInState(
                    session,
                    cache,
                    SignOut(session, cache, {
                        stub.revokeDevice(it)
                        null
                    }),
                )
            val vm = opened(account(stub, cache, signedIn = state::holdsToken) { launch { state.signOut() } })
            vm.signOut()
            advanceUntilIdle()
            assertEquals(listOf(AccountFixtures.PHONE), stub.revoked)
            assertNull(session.token)
            assertNull(cache.read(AccountViewModel.ROUTE))
            // The app's own state turned: signed out, and nothing said about a sign-in running out.
            assertFalse(state.signedIn.value)
            assertNull(state.message.value)
            assertEquals(Words.Account.signOut, vm.ui.value.busy)
        }

    @Test
    fun `signing out inside an undo window writes nothing back and asks the switch nothing`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val session = MemorySession("token", AccountFixtures.PHONE)
            val cache = MemoryCache()
            val state =
                SignInState(
                    session,
                    cache,
                    SignOut(session, cache, {
                        stub.revokeDevice(it)
                        null
                    }),
                )
            val heard = Heard()
            val vm =
                opened(account(stub, cache, heard = heard, signedIn = state::holdsToken) { launch { state.signOut() } })
            vm.detach(espn)
            advanceTimeBy(1_000)
            vm.signOut()
            advanceTimeBy(1_000)
            // The shell pops the Account: its entry's view model is cleared, which calls leave().
            vm.leave()
            advanceUntilIdle()
            assertNull(cache.read(AccountViewModel.ROUTE))
            assertEquals(0, heard.leaguesChanged)
            assertFalse(state.signedIn.value)
            assertNull(state.message.value)
        }

    @Test
    fun `a sign-out that starts elsewhere during the window leaves nothing to do`() =
        runTest(main) {
            val cache = MemoryCache()
            val heard = Heard()
            var token = true
            val vm = opened(account(cache = cache, heard = heard, signedIn = { token }))
            vm.detach(espn)
            advanceTimeBy(1_000)
            // Another screen's 401 ended the session: the session and the cache are gone.
            token = false
            cache.clear()
            // The shell pops the Account while the window is still open: leave()'s own guard decides.
            vm.leave()
            assertNull(cache.read(AccountViewModel.ROUTE))
            assertEquals(0, heard.leaguesChanged)
            advanceUntilIdle()
            assertNull(cache.read(AccountViewModel.ROUTE))
            assertEquals(0, heard.leaguesChanged)
        }

    @Test
    fun `a 401 inside the window ends the session and asks the switch nothing`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val heard = Heard()
            var token = true
            val vm =
                opened(
                    account(stub, heard = heard, signedIn = { token }, sessionEnd = {
                        token = false
                        heard.sessionEnds++
                    }),
                )
            vm.detach(espn)
            advanceTimeBy(1_000)
            stub.refuse = true
            vm.unpair(AccountFixtures.OTHER)
            advanceUntilIdle()
            vm.leave()
            assertEquals(1, heard.sessionEnds)
            assertEquals(0, heard.leaguesChanged)
        }

    @Test
    fun `an Undo tapped at the window's end wins over the window`() =
        runTest(main) {
            val stub = StubAccountScreen().apply { restoreDelay = 5_000 }
            val heard = Heard()
            val vm = opened(account(stub, heard = heard))
            vm.detach(espn)
            advanceTimeBy(AccountViewModel.UNDO_WINDOW.toMillis() - 500)
            vm.restore(espn)
            advanceUntilIdle()
            assertEquals(listOf(espn), stub.restored)
            assertEquals(
                listOf(false, false, false),
                vm
                    .loaded()
                    .model.leagues
                    ?.map { it.detached },
            )
            assertEquals(0, heard.leaguesChanged)
        }

    @Test
    fun `a late Undo that fails says so and opens the window again`() =
        runTest(main) {
            val stub = StubAccountScreen().apply { restoreDelay = 5_000 }
            val heard = Heard()
            val vm = opened(account(stub, heard = heard))
            vm.detach(espn)
            advanceTimeBy(AccountViewModel.UNDO_WINDOW.toMillis() - 500)
            stub.offline = true
            vm.restore(espn)
            advanceTimeBy(5_001)
            assertEquals(AccountProblem(AccountSection.Leagues, Words.Account.failed), vm.ui.value.problem)
            assertTrue(
                vm
                    .loaded()
                    .model.leagues
                    .orEmpty()
                    .single { it.id == espn }
                    .detached,
            )
            assertEquals(0, heard.leaguesChanged)
            advanceUntilIdle()
            assertEquals(
                2,
                vm
                    .loaded()
                    .model.leagues
                    ?.size,
            )
            assertEquals(1, heard.leaguesChanged)
        }

    /** The switches are the account's (PATCH /me `notifications`): each move writes the three kinds as drawn
     * with quiet hours in the phone's zone, a relaunch reads them back, and the last one off takes this
     * phone's token off. */
    @Test
    fun `the switches are written to the account and the last off unregisters`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val push = StaticPush(PushPermission.Allowed)
            val vm = opened(account(stub, store = push))
            assertEquals(PushSettings.standard, vm.ui.value.shownPush)
            vm.set(PushKind.Status, isOn = false)
            advanceUntilIdle()
            val first = stub.notificationChanges.first()
            assertEquals(Fixtures.zone.id, first.timeZone)
            assertEquals("23:00", first.quietStart)
            assertEquals("08:00", first.quietEnd)
            assertEquals(NotificationKindsUpdate(starterStatus = false, weekReads = true, waiverClaims = true), first.kinds)
            assertEquals(0, push.disabled)
            vm.set(PushKind.Thursday, isOn = false)
            vm.set(PushKind.Waivers, isOn = false)
            advanceUntilIdle()
            assertFalse(vm.ui.value.push.anyOn)
            assertEquals(1, push.disabled)
            vm.set(PushKind.Waivers, isOn = true)
            advanceUntilIdle()
            assertEquals(1, push.enabled)
            assertEquals(
                NotificationKindsUpdate(starterStatus = false, weekReads = false, waiverClaims = true),
                stub.notificationChanges.last().kinds,
            )
            val again = opened(account(stub, store = StaticPush())).ui.value.push
            assertTrue(again.on(PushKind.Waivers))
            assertFalse(again.on(PushKind.Status))
        }

    /** The fixture account holding the settings given (its zone the phone's unless named). */
    private fun holding(
        status: Boolean,
        thursday: Boolean,
        waivers: Boolean,
        zone: String = Fixtures.zone.id,
    ) = StubAccountScreen(
        account =
            AccountFixtures.me().copy(
                notifications =
                    NotificationSettings(
                        timeZone = zone,
                        quietStart = "23:00",
                        quietEnd = "08:00",
                        kinds = NotificationKinds(starterStatus = status, weekReads = thursday, waiverClaims = waivers),
                    ),
            ),
    )

    /** Never asked, every switch draws off and the line says a switch asks; turning one on shows the prompt
     * and, allowed, writes the account's stored switches with only that kind changed, so Status and Waivers
     * already on stay on (review M3). Refused, nothing is written. */
    @Test
    fun `a switch on asks the phone once and changes only its kind`() =
        runTest(main) {
            val stub = holding(status = true, thursday = false, waivers = true)
            val push = StaticPush(PushPermission.NotAsked, asked = PushPermission.Allowed)
            val vm = opened(account(stub, store = push))
            assertFalse(vm.ui.value.shownPush.anyOn)
            assertEquals("${Words.Push.kept} ${Words.Push.ask}", AccountWords.pushFoot(vm.ui.value.permission))
            vm.set(PushKind.Thursday, isOn = true)
            advanceUntilIdle()
            assertEquals(PushPermission.Allowed, vm.ui.value.permission)
            assertEquals(
                NotificationKindsUpdate(starterStatus = true, weekReads = true, waiverClaims = true),
                stub.notificationChanges.last().kinds,
            )
            val refusedStub = StubAccountScreen()
            val refused = opened(account(refusedStub, store = StaticPush(PushPermission.NotAsked, asked = PushPermission.Refused)))
            refused.set(PushKind.Status, isOn = true)
            advanceUntilIdle()
            assertEquals(PushPermission.Refused, refused.ui.value.permission)
            assertTrue(refusedStub.notificationChanges.isEmpty())
            assertEquals("${Words.Push.kept} ${Words.Push.blocked}", AccountWords.pushFoot(PushPermission.Refused))
        }

    /** The account's zone is not the phone's (the API's New York default): the phone's is written once on
     * load, nothing else with it, and a second load writes nothing (review M2). */
    @Test
    fun `the account takes the phone's zone once on load`() =
        runTest(main) {
            val stub = holding(status = true, thursday = true, waivers = true, zone = "America/New_York")
            val vm = opened(account(stub, store = StaticPush()))
            vm.load()
            advanceUntilIdle()
            assertEquals(listOf(NotificationSettingsUpdate(timeZone = Fixtures.zone.id)), stub.notificationChanges)
            val same = holding(status = true, thursday = true, waivers = true)
            opened(account(same, store = StaticPush()))
            assertTrue(same.notificationChanges.isEmpty())
        }

    /** A quiet hours write that fails puts the account's last confirmed hours back (review M4). */
    @Test
    fun `a failed quiet hours write puts the confirmed hours back`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val vm = opened(account(stub, store = StaticPush()))
            stub.offline = true
            vm.setQuiet(QuietEnd.From, 21 * 60)
            assertEquals(21 * 60, vm.ui.value.push.quietFrom)
            advanceUntilIdle()
            assertEquals(PushSettings.standard, vm.ui.value.push)
            assertEquals(AccountProblem(AccountSection.Notifications, Words.Account.failed), vm.ui.value.problem)
        }

    /** Quiet hours draw as the picker moves and are written once it rests, in one PATCH; a failed write puts
     * the account's back and says so beside the switches. */
    @Test
    fun `quiet hours are written once the picker rests, and a failed write keeps the account's`() =
        runTest(main) {
            val stub = StubAccountScreen()
            val vm = opened(account(stub, store = StaticPush()))
            vm.setQuiet(QuietEnd.From, 22 * 60 + 30)
            vm.setQuiet(QuietEnd.To, 7 * 60 + 30)
            assertEquals(22 * 60 + 30, vm.ui.value.push.quietFrom)
            advanceUntilIdle()
            assertEquals(1, stub.notificationChanges.size)
            assertEquals("22:30", stub.notificationChanges.first().quietStart)
            assertEquals("07:30", stub.notificationChanges.first().quietEnd)
            assertEquals("10:30 pm", AccountWords.clockTime(vm.ui.value.push.quietFrom))
            stub.offline = true
            vm.set(PushKind.Status, isOn = false)
            advanceUntilIdle()
            assertTrue(
                vm.ui.value.push
                    .on(PushKind.Status),
            )
            assertEquals(AccountProblem(AccountSection.Notifications, Words.Account.failed), vm.ui.value.problem)
        }

    @Test
    fun `with no signal the saved account shows stale with its stamp`() =
        runTest(main) {
            val cache = MemoryCache()
            opened(account(cache = cache))
            val stub = StubAccountScreen().apply { offline = true }
            val later = Fixtures.week.plusSeconds(1800)
            val vm = opened(account(stub, cache, now = later))
            val loaded = vm.loaded()
            assertTrue(loaded.stale)
            assertEquals(Fixtures.week, loaded.stamp)
            assertEquals("${AppWords.lastRead} Sat 12:00 pm", vm.stampWords())
        }

    @Test
    fun `with nothing kept and no signal the screen says so, and unread leagues say theirs`() =
        runTest(main) {
            val offline = StubAccountScreen().apply { offline = true }
            assertEquals(AccountState.Failed(AppWords.cannotLoad), opened(account(offline)).ui.value.state)
            val leaguesFail =
                object : AccountScreenReads by StubAccountScreen() {
                    override suspend fun attached(): List<AttachedRead> = throw java.io.IOException("no signal")
                }
            val vm =
                AccountViewModel(
                    leaguesFail,
                    MemoryCache(),
                    FixedClock(Fixtures.week),
                    Fixtures.zone,
                    StaticPush(),
                    { AccountFixtures.PHONE },
                    AccountHooks({}, {}, {}, { true }, {}),
                )
            assertNull(opened(vm).loaded().model.leagues)
        }
}
