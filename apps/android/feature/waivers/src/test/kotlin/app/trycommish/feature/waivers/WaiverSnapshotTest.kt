package app.trycommish.feature.waivers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverRow
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.waivers.PanelMode
import app.trycommish.core.waivers.WaiverFixtures
import app.trycommish.core.waivers.WaiverKeys
import app.trycommish.core.waivers.WaiverPin
import app.trycommish.core.waivers.WaiverPosition
import app.trycommish.core.waivers.WaiverReads
import app.trycommish.core.waivers.WaiverSortKey
import app.trycommish.core.waivers.WaiverState
import app.trycommish.core.waivers.WaiverUi
import app.trycommish.core.waivers.WaiverViewModel
import app.trycommish.core.waivers.envelopeOf
import app.trycommish.design.CommishTheme
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
 * The Waivers screen's mock, the same states as the iOS screen's (Lane 186 after its fix round), each the
 * view model's over the shared fixtures through a stub of the API. The table before the wire clears (the
 * FFPC stand-in at Saturday noon, its verb the platform's page): the phone's first screen with the verb
 * pinned, then the strip, the chips, the search and the rows that gain, then the rest with the basis. The
 * D/ST chip's own read; the table sorted by name; a wide receiver past the page's rows reached by the WR
 * chip's read and his name searched. An add's drop panel open on ESPN with the pair pinned. The claim on
 * the ESPN stand-ins: confirmed with its bid in waiver dollars (FAAB), pending with the time ESPN runs it,
 * refused in ESPN's own words, done. And a saved read with no signal, the verb disabled with its stamp.
 * The position panel (Lane 304): a card open on the rest of the season, on This week, with no free agent
 * and with no figure.
 * Both themes, a Pixel 9 and a small phone (the Nexus 5's 360 by 640 dp). The persona panel reads these.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class WaiverSnapshotTest(
    private val scene: Scene,
    private val part: Part,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        val league: String,
        val parts: List<Part>,
    ) {
        Before("before", WaiverFixtures.FFPC, listOf(Part.Phone, Part.Top, Part.Foot)),
        Drops("drops", WaiverFixtures.PENDING, listOf(Part.Panel, Part.Pin)),
        Faab("faab", WaiverFixtures.PENDING, listOf(Part.Pin)),
        Pending("pending", WaiverFixtures.PENDING, listOf(Part.Pin)),
        Refused("refused", WaiverFixtures.REFUSED, listOf(Part.Pin)),
        Done("done", WaiverFixtures.DONE, listOf(Part.Pin)),
        Stale("stale", WaiverFixtures.PENDING, listOf(Part.Phone)),

        /** The D/ST chip chosen: the defenses' own read under the page's strip. */
        Narrowed("narrowed", WaiverFixtures.FFPC, listOf(Part.Top)),

        /** The table sorted by name, A to Z, its head lit with the caret. */
        Sorted("sorted", WaiverFixtures.FFPC, listOf(Part.Top)),

        /** A wide receiver past the page's rows reached: the WR chip's read, his name searched. */
        Reach("reach", WaiverFixtures.FFPC, listOf(Part.Top, Part.Foot)),

        /** The position panel's QB card open on the rest of the season: Need, his three, five free agents. */
        Positions("positions", WaiverFixtures.FFPC, listOf(Part.Positions)),

        /** The toggle on This week, the TE card open: the week's own free agents by Proj. */
        PositionsWeek("positionsWeek", WaiverFixtures.FFPC, listOf(Part.Positions)),

        /** The RB card open: no free agent we list plays there. */
        PositionsEmpty("positionsEmpty", WaiverFixtures.FFPC, listOf(Part.Positions)),

        /** The D/ST card open: no rest-of-season figure, so no rank and no median. */
        PositionsDefense("positionsDefense", WaiverFixtures.FFPC, listOf(Part.Positions)),
        ;

        val espn: Boolean get() = league != WaiverFixtures.FFPC
    }

    enum class Part(
        val id: String,
    ) {
        /** The phone's first screen: the strip and the top of the table with the verb pinned above the bar. */
        Phone("phone"),
        Top("top"),

        /** The open row and its drop panel under the heads. */
        Panel("panel"),
        Foot("foot"),
        Pin("pin"),

        /** The position panel alone, its card open on its list. */
        Positions("positions"),
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
    fun waivers() {
        val mode = if (part == Part.Phone || part == Part.Pin) RenderingMode.SHRINK else RenderingMode.V_SCROLL
        // The long runs (every row past the gaining ones, every drop of the panel, an open position's
        // list) are drawn at 1x, as
        // iOS records, so each reference stays under 300 KB; the rest at 2x as the Start screen's.
        val long = part == Part.Foot || part == Part.Panel || part == Part.Positions
        paparazzi.unsafeUpdateConfig(deviceConfig = if (long) oneX(phone.config) else phone.config, renderingMode = mode)
        val vm = viewModelAt(scene)
        val ui = vm.ui.value
        val stamp = vm.stampWords(ui)
        val pin = vm.pin(ui)
        paparazzi.snapshot(name = "waivers-${scene.id}-${part.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Mock(ui, stamp, pin, part, phone) }
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

private val saturday = StartFixtures.instant(WaiverFixtures.WEEK)

/** The FFPC stand-in's page as the API's first rows leave a deep pool: one wide receiver of the eleven;
 * and the WR chip's own read with every one. */
internal fun pagedReceivers(): Pair<WaiverAdvice, WaiverAdvice> {
    val full = WaiverFixtures.waivers(WaiverFixtures.FFPC)
    val receiver = { row: WaiverRow -> row.add.player.position == "WR" }
    val first = full.rows.first(receiver)
    return full.copy(rows = full.rows.filter { !receiver(it) || it == first }) to
        full.copy(rows = full.rows.filter(receiver), pickups = full.pickups.filter(receiver))
}

/** The view model at the scene's state, through the stub: loaded, saved with no signal, a row's drop
 * panel open, the claim pressed, planned and made, a position chosen, a head chosen, a name searched. */
internal fun viewModelAt(scene: WaiverSnapshotTest.Scene): WaiverViewModel {
    val league = scene.league
    val full = WaiverFixtures.waivers(league)
    val (page, receivers) = pagedReceivers()
    val cache = MemoryCache()
    val stale = scene == WaiverSnapshotTest.Scene.Stale
    if (stale) cache.write(WaiverKeys.waivers(league), Cached(WaiverFixtures.body(league), saturday))
    val reads =
        StubWaivers(
            advice =
                if (stale) {
                    null
                } else if (scene == WaiverSnapshotTest.Scene.Reach) {
                    page
                } else {
                    full
                },
            plan = if (scene.espn) WaiverFixtures.plan(league) else null,
            result = if (scene.espn) WaiverFixtures.made(league) else null,
            positions =
                if (scene.espn) {
                    emptyMap()
                } else {
                    mapOf(WaiverPosition.DEF to WaiverFixtures.defBody(), WaiverPosition.WR to envelopeOf(receivers))
                },
        )
    val host = if (scene.espn) LeagueHost.espn else LeagueHost.ffpc
    val clock = FixedClock(if (stale) saturday.plusSeconds(HALF_HOUR) else saturday)
    val vm = WaiverViewModel(reads, cache, clock, Fixtures.zone, host, { true }, {}, {})
    vm.load(league)
    when (scene) {
        WaiverSnapshotTest.Scene.Drops -> {
            val model = (vm.ui.value.state as WaiverState.Loaded).model
            vm.tapRow(
                model
                    .table()
                    .gaining
                    .first { !it.named }
                    .key,
            )
        }
        WaiverSnapshotTest.Scene.Faab -> vm.press(league)
        WaiverSnapshotTest.Scene.Pending, WaiverSnapshotTest.Scene.Refused, WaiverSnapshotTest.Scene.Done -> {
            vm.press(league)
            vm.confirm(league)
        }
        WaiverSnapshotTest.Scene.Narrowed -> vm.choosePosition(WaiverPosition.DEF, league)
        WaiverSnapshotTest.Scene.Sorted -> vm.sortBy(WaiverSortKey.Name)
        WaiverSnapshotTest.Scene.Reach -> {
            vm.choosePosition(WaiverPosition.WR, league)
            vm.find("dotson")
        }
        WaiverSnapshotTest.Scene.PositionsWeek -> {
            vm.choosePanelMode(PanelMode.Week)
            vm.toggleCard("TE")
        }
        WaiverSnapshotTest.Scene.Positions -> vm.toggleCard("QB")
        WaiverSnapshotTest.Scene.PositionsEmpty -> vm.toggleCard("RB")
        WaiverSnapshotTest.Scene.PositionsDefense -> vm.toggleCard("DEF")
        WaiverSnapshotTest.Scene.Before, WaiverSnapshotTest.Scene.Stale -> Unit
    }
    return vm
}

private const val HALF_HOUR = 1800L

@Composable
private fun Mock(
    ui: WaiverUi,
    stamp: String?,
    pin: WaiverPin,
    part: WaiverSnapshotTest.Part,
    phone: WaiverSnapshotTest.Phone,
) {
    val model = (ui.state as WaiverState.Loaded).model
    val actions = WaiverActions()
    val bg = Modifier.background(CommishTheme.colors.bg)
    when (part) {
        WaiverSnapshotTest.Part.Phone ->
            Column(bg.fillMaxWidth().height(phone.room)) {
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) {
                    WaiverPage(
                        model,
                        ui,
                        stamp,
                        actions,
                        listOf(WaiverPart.Top),
                        Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                        still = true,
                    )
                }
                if (!pin.isEmpty) WaiverPinView(pin, WaiverPinActions(), still = true)
            }
        WaiverSnapshotTest.Part.Top -> WaiverPage(model, ui, stamp, actions, listOf(WaiverPart.Top), bg, still = true)
        WaiverSnapshotTest.Part.Foot -> WaiverPage(model, ui, stamp, actions, listOf(WaiverPart.Foot), bg)
        WaiverSnapshotTest.Part.Panel -> WaiverOpenRow(model, ui, actions, bg)
        WaiverSnapshotTest.Part.Pin -> WaiverPinView(pin, WaiverPinActions(), still = true)
        WaiverSnapshotTest.Part.Positions -> WaiverPositions(ui, actions, bg)
    }
}

/** The Waivers routes as the fixture answers them: the page's advice (or no signal), each position's own
 * read, the plan with the bid asked for, the make answering the fixture's outcome. */
internal class StubWaivers(
    private val advice: WaiverAdvice?,
    private val plan: HostMovePlan?,
    private val result: HostMoveResult?,
    private val positions: Map<WaiverPosition, String>,
) : WaiverReads {
    override suspend fun waivers(
        leagueId: String,
        position: WaiverPosition?,
    ): String {
        position?.let { positions[it] }?.let { return it }
        return advice?.let(::envelopeOf) ?: throw IOException("no signal")
    }

    override suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan {
        val answer = plan ?: throw IOException("no plan")
        val asked = move.claim?.bid ?: return answer
        return answer.copy(bid = answer.bid?.copy(amount = asked))
    }

    override suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult = result ?: throw IOException("no answer")
}
