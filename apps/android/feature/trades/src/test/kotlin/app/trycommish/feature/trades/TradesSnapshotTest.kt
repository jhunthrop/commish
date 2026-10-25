package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.api.models.LeagueHost
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
import app.trycommish.feature.boxscore.TableFrame
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
 * The Trades screen's mock, the same states as the iOS screen's (Lane 189 after its fix round), each the
 * view model's over the shared fixtures through a stub of the API. The finder on Saturday noon (the
 * phone's first screen, the strip, the picker with the chips and the finder, the basis); the best trade
 * opened into its players with Build from this; the same trade's verb pressed (the offer copied, the line
 * under it); the trades holding Aaron Rodgers; the builder opened from the best trade with its check (the
 * scoreboard, the answer line, the pin, then each roster with its ticks); the builder opened new (the
 * prompt, the board at "--"); a saved finder whose read and check found no signal (the stamp, the web's
 * line in the builder); and Sunday afternoon, the trade's players in play (no week, "--" on the board).
 * Both themes, a Pixel 9 and a small phone (the Nexus 5's 360 by 640 dp). The persona panel reads these.
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
        Finder("finder", TradeFixtures.WEEK, listOf(Part.Phone, Part.Strip, Part.Finder, Part.Basis)),
        Opened("opened", TradeFixtures.WEEK, listOf(Part.Opened)),
        Copied("copied", TradeFixtures.WEEK, listOf(Part.Opened)),
        Holding("holding", TradeFixtures.WEEK, listOf(Part.Finder)),
        Builder("builder", TradeFixtures.WEEK, listOf(Part.Board, Part.Yours, Part.Theirs)),
        New("new", TradeFixtures.WEEK, listOf(Part.Board)),
        Stale("stale", TradeFixtures.WEEK, listOf(Part.Phone, Part.Board)),
        Sunday("sunday", TradeFixtures.SUNDAY, listOf(Part.Opened, Part.Board)),
    }

    enum class Part(
        val id: String,
        /** Drawn at 1x so the long runs stay under 300 KB, the rest at 2x as the Start screen's. */
        val long: Boolean = false,
    ) {
        /** The phone's first screen: the strip and what fits under it. */
        Phone("phone"),
        Strip("strip"),
        Finder("finder", long = true),
        Basis("basis"),

        /** The best trade's row opened: its players, Build from this, its verb. */
        Opened("opened", long = true),

        /** The builder's head, its scoreboard and answer line, and the pin above the bar. */
        Board("board"),

        /** The builder's rosters, each with its ticks. */
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
        val mode = if (part == Part.Phone) RenderingMode.SHRINK else RenderingMode.V_SCROLL
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

/** The view model at the scene's state, through the stub: loaded, a trade opened and its verb pressed,
 * the picker on Aaron Rodgers, the builder from the best trade or new, a saved finder with no signal, and
 * Sunday's builder. */
internal fun viewModelAt(scene: TradesSnapshotTest.Scene): TradesViewModel {
    val clock = scene.clock
    val stub =
        StubTrades(
            advice = TradeFixtures.trades(clock),
            holding = TradeFixtures.holding(),
            check = TradeFixtures.check(clock, 1),
        )
    val vm =
        TradesViewModel(stub, MemoryCache(), FixedClock(StartFixtures.instant(clock)), Fixtures.zone, LeagueHost.ffpc, ME, { true }, {}, {})
    val league = TradeFixtures.LEAGUE
    val best = TradeFixtures.BEST
    vm.load(league)
    if (scene == TradesSnapshotTest.Scene.Stale) {
        stub.offline = true
        vm.load(league)
    }
    when (scene) {
        TradesSnapshotTest.Scene.Opened -> vm.toggle(best)
        TradesSnapshotTest.Scene.Copied -> {
            vm.toggle(best)
            vm.press(best)
        }
        TradesSnapshotTest.Scene.Sunday -> {
            vm.toggle(best)
            vm.buildFrom(best, league)
        }
        TradesSnapshotTest.Scene.Holding -> vm.pick(TradeFixtures.RODGERS, league)
        TradesSnapshotTest.Scene.Builder, TradesSnapshotTest.Scene.Stale -> vm.buildFrom(best, league)
        TradesSnapshotTest.Scene.New -> vm.buildNew()
        TradesSnapshotTest.Scene.Finder -> Unit
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
    val actions = TradeActions()
    val bg = Modifier.background(CommishTheme.colors.bg)
    val pad = bg.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp)
    val gap = Arrangement.spacedBy(Tokens.Space.s3.dp)
    when (part) {
        TradesSnapshotTest.Part.Phone ->
            Box(bg.fillMaxWidth().height(phone.room).clipToBounds()) {
                TradesPage(
                    model,
                    ui,
                    stamp,
                    actions,
                    listOf(TradesPart.Strip, TradesPart.Finder),
                    Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                )
            }
        TradesSnapshotTest.Part.Strip -> TradesPage(model, ui, stamp, actions, listOf(TradesPart.Strip), bg)
        TradesSnapshotTest.Part.Finder -> TradesPage(model, ui, stamp, actions, listOf(TradesPart.Finder), bg)
        TradesSnapshotTest.Part.Basis -> TradesPage(model, ui, stamp, actions, listOf(TradesPart.Basis), bg)
        TradesSnapshotTest.Part.Opened -> {
            val line = model.rows.first { it.key in ui.opened }
            Column(pad, verticalArrangement = gap) {
                stamp?.let { StampText(it) }
                TableFrame {
                    FinderRow(line, open = true, sort = ui.sort) {}
                    OpenedTrade(line, model, ui.copied[line.key], actions)
                }
            }
        }
        TradesSnapshotTest.Part.Board -> {
            val builder = requireNotNull(ui.builder)
            Column(pad, verticalArrangement = gap) {
                stamp?.let { StampText(it) }
                BuilderBoard(builder, ui.checking, actions)
                BuilderPin(
                    builder,
                    model.verb,
                    model.page,
                    ui.builderCopied,
                    {},
                    Modifier.clip(RoundedCornerShape(Tokens.Radius.md.dp)),
                )
            }
        }
        TradesSnapshotTest.Part.Yours -> Column(pad) { BuilderBoxView(requireNotNull(ui.builder).yours, PickSide.Give, actions) }
        TradesSnapshotTest.Part.Theirs ->
            Column(pad) { requireNotNull(ui.builder).theirs?.let { BuilderBoxView(it, PickSide.Get, actions) } }
    }
}

/** The finder, the trades holding a player and the check as the fixture answers them at a clock, or no
 * signal. */
internal class StubTrades(
    private val advice: TradeAdvice,
    private val holding: TradeAdvice,
    private val check: TradeCheck,
) : TradeReads {
    var offline = false

    override suspend fun trades(
        leagueId: String,
        player: String?,
    ): String {
        if (offline) throw IOException("no signal")
        return envelopeOf(if (player == null) advice else holding)
    }

    override suspend fun checkTrade(
        leagueId: String,
        trade: TradeCheckInput,
    ): TradeCheck {
        if (offline) throw IOException("no signal")
        return check
    }
}
