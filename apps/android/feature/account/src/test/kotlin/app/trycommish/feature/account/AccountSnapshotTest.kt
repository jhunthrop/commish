package app.trycommish.feature.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.api.ApiFailure
import app.trycommish.api.models.NotificationKinds
import app.trycommish.api.models.NotificationSettings
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.account.AccountFixtures
import app.trycommish.core.account.AccountHooks
import app.trycommish.core.account.AccountState
import app.trycommish.core.account.AccountViewModel
import app.trycommish.core.account.DeletionUi
import app.trycommish.core.account.PushKind
import app.trycommish.core.account.StubAccountScreen
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.push.PushPermission
import app.trycommish.core.push.StaticPush
import app.trycommish.design.CommishTheme
import app.trycommish.design.Words
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The Account's mock, the iOS screen's states (Lane 198 after its fix round), each the view model's over
 * the shared fixtures (GET /me, three of the fixture's leagues, GET /devices) through a stub at the week
 * clock: the account's head with its leagues and the free season's plan; the plan card gone when the API
 * says the free season is over; a league detached, its Undo in place; the account saved and read again
 * with no signal (stale with its stamp); the switches with a starter's status turned off; the two devices
 * with this phone marked and the foot; and the signed-out return, the sign-in screen sign out lands on.
 * Both themes, a Pixel 9 and a small phone.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class AccountSnapshotTest(
    private val scene: Scene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        val part: AccountPart?,
    ) {
        Head("head", AccountPart.Top),
        NotFree("notfree", AccountPart.Top),
        Detached("detached", AccountPart.Top),
        Stale("stale", AccountPart.Top),
        Switches("switches", AccountPart.Switches),
        Devices("devices", AccountPart.Devices),
        SignedOut("signedout", null),
        Deleted("deleted", null),
        DeleteEmpty("delete-empty", null),
        DeleteMatched("delete-matched", null),
        DeleteRefused("delete-refused", null),
        ;

        /** The delete dialog's scenes: as it opens, the email typed, and a renewing membership's refusal. */
        val isDeletion: Boolean get() = id.startsWith("delete-")
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        val room: Dp,
    ) {
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun account() {
        paparazzi.unsafeUpdateConfig(renderingMode = RenderingMode.SHRINK)
        val name = "account-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}"
        val part = scene.part
        if (scene.isDeletion) {
            // The panel is taller than the small phone: it is drawn whole, as the scroll in its dialog would show it.
            paparazzi.unsafeUpdateConfig(renderingMode = RenderingMode.V_SCROLL)
            val shown = deletionAt(scene, scheduler)
            paparazzi.snapshot(name = name) {
                CommishTheme(dark = dark) {
                    Box(Modifier.background(CommishTheme.colors.bg).fillMaxWidth()) {
                        DeleteAccountPanel(
                            shown,
                            type = {},
                            delete = {},
                            modifier = Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                            still = true,
                        )
                    }
                }
            }
            return
        }
        if (part == null) {
            val notice = if (scene == Scene.Deleted) Words.DeleteAccount.doneTitle else null
            paparazzi.snapshot(name = name) {
                CommishTheme(dark = dark) {
                    Box(Modifier.fillMaxWidth().height(phone.room)) { SignInScreen(message = null, onSignIn = {}, notice = notice) }
                }
            }
            return
        }
        val vm = viewModelAt(scene, scheduler)
        val ui = vm.ui.value
        val model = (ui.state as AccountState.Loaded).model
        val stamp = vm.stampWords(ui)
        paparazzi.snapshot(name = name) {
            CommishTheme(dark = dark) {
                Box(Modifier.background(CommishTheme.colors.bg).fillMaxWidth()) {
                    AccountPage(
                        model,
                        ui,
                        stamp,
                        AccountActions(),
                        listOf(part),
                        modifier = Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                    )
                }
            }
        }
    }

    /** The scenes show the states they name. */
    @Test
    fun mockShowsTheStatesItNames() {
        if (dark || phone != Phone.Pixel9) return
        if (scene.isDeletion) {
            val shown = deletionAt(scene, scheduler)
            assertEquals(scene != Scene.DeleteEmpty, shown.canDelete)
            assertEquals(if (scene == Scene.DeleteRefused) RENEWING else null, shown.problem)
            return
        }
        if (scene.part == null) return
        val vm = viewModelAt(scene, scheduler)
        val loaded = vm.ui.value.state as AccountState.Loaded
        val model = loaded.model
        when (scene) {
            Scene.NotFree -> assertEquals(null, model.plan)
            Scene.Detached -> assertEquals(listOf(false, true, false), model.leagues?.map { it.detached })
            Scene.Stale -> {
                assertEquals(true, loaded.stale)
                assertEquals("Last read Sat 12:00 pm", vm.stampWords())
            }
            Scene.Switches ->
                assertEquals(
                    false,
                    vm.ui.value.push
                        .on(PushKind.Status),
                )
            else -> assertEquals(listOf(true, false), model.devices.map { it.thisPhone })
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene -> listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } } }
    }
}

private const val HALF_HOUR = 1800L
private const val CONFLICT = 409
private const val RENEWING = "Cancel your membership first, so your card is not charged again"

/** The delete dialog at the scene's state through the stub: opened, the account's email typed, or typed and
 * refused for a membership that still renews. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun deletionAt(
    scene: AccountSnapshotTest.Scene,
    scheduler: TestCoroutineScheduler,
): DeletionUi {
    val stub = StubAccountScreen()
    if (scene == AccountSnapshotTest.Scene.DeleteRefused) stub.deleteRefusal = ApiFailure(CONFLICT, "conflict", RENEWING)
    val vm =
        AccountViewModel(
            stub,
            MemoryCache(),
            FixedClock(Fixtures.week),
            Fixtures.zone,
            StaticPush(),
            { AccountFixtures.PHONE },
            AccountHooks({}, {}, {}, { true }, {}),
        )
    vm.load()
    scheduler.advanceUntilIdle()
    vm.openDeletion()
    if (scene != AccountSnapshotTest.Scene.DeleteEmpty) vm.deletion.type(AccountFixtures.me().email)
    if (scene == AccountSnapshotTest.Scene.DeleteRefused) {
        vm.deletion.delete()
        scheduler.advanceUntilIdle()
    }
    return checkNotNull(vm.deletion.ui.value)
}

private fun twoX(
    base: DeviceConfig,
    width: Int,
    height: Int,
): DeviceConfig =
    base.copy(
        screenWidth = width * 2,
        screenHeight = height * 2,
        xdpi = Density.XHIGH.dpiValue,
        ydpi = Density.XHIGH.dpiValue,
        density = Density.XHIGH,
    )

/** The view model at the scene's state through the stub: read fresh (the free season ended by the API's
 * flag for NotFree), a league detached a moment ago, or saved and read again with no signal half an hour
 * on. The account holds a starter's status switched off throughout and the phone allows push, as on iOS. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun viewModelAt(
    scene: AccountSnapshotTest.Scene,
    scheduler: TestCoroutineScheduler,
): AccountViewModel {
    val cache = MemoryCache()
    val me =
        AccountFixtures.me().copy(
            notifications =
                NotificationSettings(
                    timeZone = Fixtures.zone.id,
                    quietStart = "23:00",
                    quietEnd = "08:00",
                    kinds = NotificationKinds(starterStatus = false, weekReads = true, waiverClaims = true),
                ),
        )
    val stub = StubAccountScreen(account = me, flag = if (scene == AccountSnapshotTest.Scene.NotFree) false else null)
    val push = StaticPush(PushPermission.Allowed)
    val hooks = AccountHooks({}, {}, {}, { true }, {})

    fun at(seconds: Long) =
        AccountViewModel(
            stub,
            cache,
            FixedClock(Fixtures.week.plusSeconds(seconds)),
            Fixtures.zone,
            push,
            { AccountFixtures.PHONE },
            hooks,
        ) {
            // The undo's window never closes in a snapshot.
            kotlinx.coroutines.awaitCancellation()
        }
    if (scene == AccountSnapshotTest.Scene.Stale) {
        at(0).load()
        scheduler.advanceUntilIdle()
        stub.offline = true
    }
    val vm = at(if (scene == AccountSnapshotTest.Scene.Stale) HALF_HOUR else 0)
    vm.load()
    scheduler.advanceUntilIdle()
    if (scene == AccountSnapshotTest.Scene.Detached) {
        vm.detach(AccountFixtures.SHOWN[1])
        scheduler.advanceUntilIdle()
    }
    return vm
}
