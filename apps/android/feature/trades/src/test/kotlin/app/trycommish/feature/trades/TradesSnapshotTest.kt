package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.TradeAcceptable
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeCheckInput
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.trades.PickSide
import app.trycommish.core.trades.TradeFixtures
import app.trycommish.core.trades.TradeMe
import app.trycommish.core.trades.TradeReads
import app.trycommish.core.trades.TradesState
import app.trycommish.core.trades.TradesUi
import app.trycommish.core.trades.TradesViewModel
import app.trycommish.core.trades.envelopeOf
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.io.IOException

/**
 * The Trades screen's mock, builder-first (Lane 289 after the web's Lanes 260, 268 and 277), the same states
 * as the iOS screen's, each the view model's over the shared fixtures through a stub of the API. The screen
 * as it opens on Saturday noon (the phone's first screen between the top bar and the bottom bar with the
 * pin over it, and the verdict before a tick); the Best idea loaded (the first screen with its ticks, the
 * verdict and the pin, their roster from the switch); every idea shown; an idea they would not take (the
 * refusal in the answer line and the pin); a saved read whose check found no signal (the stamp, the web's
 * line); and Sunday afternoon, the trade's players in play (no week, "--" in the Proj cells, the member's
 * roster with its drop). Both themes, a Pixel 9 and a small phone (the Nexus 5's 360 by 640 dp). The
 * persona panel reads these.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class TradesSnapshotTest(
    private val scene: Scene,
    private val part: Part,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        val clock: String,
        val parts: List<Part>,
    ) {
        Open("open", TradeFixtures.WEEK, listOf(Part.Screen, Part.Verdict)),
        Idea("idea", TradeFixtures.WEEK, listOf(Part.Screen, Part.Verdict, Part.Theirs)),
        Ideas("ideas", TradeFixtures.WEEK, listOf(Part.Ideas)),
        Refused("refused", TradeFixtures.WEEK, listOf(Part.Verdict)),
        Stale("stale", TradeFixtures.WEEK, listOf(Part.Verdict)),
        Sunday("sunday", TradeFixtures.SUNDAY, listOf(Part.Verdict, Part.Yours)),

        /** Long team names on both sides (review M2): every name drawn whole. */
        Long("long", TradeFixtures.WEEK, listOf(Part.Screen, Part.Verdict, Part.Theirs)),
    }

    enum class Part(
        val id: String,
        /** Drawn at 1x so the long runs stay under 300 KB, the rest at 2x as the Start screen's. */
        val long: Boolean = false,
    ) {
        /** The phone's first screen: the ideas, the switch and the roster shown, the pin over its foot. */
        Screen("screen"),

        /** Every idea in place. */
        Ideas("ideas", long = true),

        /** The verdict and its lines, the pin under them. */
        Verdict("verdict"),

        /** Each roster whole, with its ticks. */
        Yours("yours", long = true),
        Theirs("theirs", long = true),
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        /** The room a screen has between the status bar with the top bar and the bottom bar. */
        val room: Dp,
    ) {
        /** A Pixel 9's 411 by 923 dp, drawn at 2x as the Start screen's references are. */
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),

        /** The Nexus 5's 360 by 640 dp. */
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun trades() {
        val mode = if (part == Part.Screen) RenderingMode.SHRINK else RenderingMode.V_SCROLL
        paparazzi.unsafeUpdateConfig(deviceConfig = if (part.long) oneX(phone.config) else phone.config, renderingMode = mode)
        val vm = viewModelAt(scene)
        val ui = vm.ui.value
        val stamp = vm.stampWords(ui)
        paparazzi.snapshot(name = "trades-${scene.id}-${part.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Mock(ui, stamp, part, phone) }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{1}-{3}-dark={2}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene ->
                scene.parts.flatMap { part ->
                    listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, part, dark, it) } }
                }
            }
    }
}

/** A phone of `width` by `height` dp at 2x (320 dpi), Paparazzi's own resolution kept, as the Start
 * screen's mock draws it. */
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

/** The same phone at 1x (160 dpi). */
private fun oneX(twoX: DeviceConfig): DeviceConfig =
    twoX.copy(
        screenWidth = twoX.screenWidth / 2,
        screenHeight = twoX.screenHeight / 2,
        xdpi = Density.MEDIUM.dpiValue,
        ydpi = Density.MEDIUM.dpiValue,
        density = Density.MEDIUM,
    )

/** The member's side as the iOS mock names it. */
internal val ME = TradeMe("McConkey Kong Country", "1-4, 11th of 12")

/** The long scene's names, each past what one line of its place holds on a phone. */
private val LONG_ME = TradeMe("McConkey Kong Country Club and Grill", "1-4, 11th of 12")
private const val LONG_TEAM = "Max_Jensen10 and the Sunday Afternoon Regulars"

/** The best idea's team, renamed long in the long scene. */
private const val BEST_TEAM = 8

/** The fixture's trades, with the best idea's team renamed long in the long scene. */
private fun adviceAt(scene: TradesSnapshotTest.Scene): TradeAdvice {
    val advice = TradeFixtures.trades(scene.clock)
    if (scene != TradesSnapshotTest.Scene.Long) return advice
    return advice.copy(teams = advice.teams.map { if (it.rosterId == BEST_TEAM) it.copy(name = LONG_TEAM) else it })
}

/** The fixture's check, or one they would not take on their rest of season (Lane 277). */
private fun checkAt(scene: TradesSnapshotTest.Scene): TradeCheck {
    val check = TradeFixtures.check(scene.clock, 1)
    if (scene != TradesSnapshotTest.Scene.Refused) return check
    return check.copy(
        acceptable = TradeAcceptable(yours = true, theirs = false),
        trade = check.trade.copy(myRestOfSeason = REFUSED_REST, theirRestOfSeason = -REFUSED_REST),
    )
}

/** The refused idea's rest of season, as the web's word case writes it. */
private const val REFUSED_REST = 21.6

/** The view model at the scene's state, through the stub: loaded, the Best idea loaded, every idea shown, a
 * refused idea, a saved read with no signal, and Sunday's idea. */
internal fun viewModelAt(scene: TradesSnapshotTest.Scene): TradesViewModel {
    val clock = scene.clock
    val stub = StubTrades(advice = adviceAt(scene), check = checkAt(scene))
    val vm =
        TradesViewModel(
            stub,
            MemoryCache(),
            FixedClock(StartFixtures.instant(clock)),
            Fixtures.zone,
            LeagueHost.ffpc,
            if (scene ==
                TradesSnapshotTest.Scene.Long
            ) {
                LONG_ME
            } else {
                ME
            },
            { true },
            {},
            {},
        )
    val league = TradeFixtures.LEAGUE
    vm.load(league)
    if (scene == TradesSnapshotTest.Scene.Stale) {
        stub.offline = true
        vm.load(league)
    }
    when (scene) {
        TradesSnapshotTest.Scene.Open -> Unit
        TradesSnapshotTest.Scene.Ideas -> vm.showAllIdeas()
        else -> vm.loadIdea(TradeFixtures.BEST, league)
    }
    return vm
}

/** A part of the screen as the mock draws it. The phone's first screen is the room between the top bar
 * and the tab bar (the app draws both natively). */
@Composable
private fun Mock(
    ui: TradesUi,
    stamp: String?,
    part: TradesSnapshotTest.Part,
    phone: TradesSnapshotTest.Phone,
) {
    val model = (ui.state as TradesState.Loaded).model
    val builder = requireNotNull(ui.builder)
    val actions = TradeActions()
    val bg = Modifier.background(CommishTheme.colors.bg)
    val pad = bg.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp)
    val pin = @Composable { BuilderPin(builder, model.verb, model.page, ui.checking, null, null, actions) }
    when (part) {
        TradesSnapshotTest.Part.Screen ->
            Box(bg.fillMaxWidth().height(phone.room).clipToBounds()) {
                Column(
                    Modifier.wrapContentHeight(Alignment.Top, unbounded = true).padding(Tokens.Space.s3.dp),
                    verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                ) {
                    TradesTop(builder, PickSide.Give, stamp, actions)
                    BuilderBoxView(builder, PickSide.Give, actions)
                }
                Box(Modifier.align(Alignment.BottomCenter)) { pin() }
            }
        TradesSnapshotTest.Part.Ideas -> Column(pad) { TradesTop(builder, PickSide.Give, stamp, actions) }
        TradesSnapshotTest.Part.Verdict ->
            Column(pad, verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
                stamp?.let { StampText(it) }
                VerdictView(builder, ui.checking)
                pin()
            }
        TradesSnapshotTest.Part.Yours -> Column(pad) { BuilderBoxView(builder, PickSide.Give, actions) }
        TradesSnapshotTest.Part.Theirs -> Column(pad) { BuilderBoxView(builder, PickSide.Get, actions) }
    }
}

/** The trades and the check as the fixture answers them at a clock, or no signal. */
internal class StubTrades(
    private val advice: TradeAdvice,
    private val check: TradeCheck,
) : TradeReads {
    var offline = false

    override suspend fun trades(
        leagueId: String,
        player: String?,
    ): String {
        if (offline) throw IOException("no signal")
        return envelopeOf(advice)
    }

    override suspend fun checkTrade(
        leagueId: String,
        trade: TradeCheckInput,
    ): TradeCheck {
        if (offline) throw IOException("no signal")
        return check
    }
}
