package app.trycommish.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.liveorder.OneValueFixture
import app.trycommish.core.liveorder.StubOneValueWeeks
import app.trycommish.core.player.PageState
import app.trycommish.core.player.PlayerPageModel
import app.trycommish.core.player.PlayerPageViewModel
import app.trycommish.core.player.PlayerReadsGraph
import app.trycommish.core.player.PlayerSheetViewModel
import app.trycommish.core.player.SavedReason
import app.trycommish.core.player.SheetRead
import app.trycommish.core.player.SheetState
import app.trycommish.core.player.ShownRead
import app.trycommish.core.player.StubPages
import app.trycommish.core.player.StubWeeks
import app.trycommish.core.player.WeekFixture
import app.trycommish.core.player.playerGraph
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.SheetOffer
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.SheetVerb
import app.trycommish.core.shell.playerSheetModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.shell.PlayerSheetFrame
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.time.Instant

/**
 * The player sheet's and the player page's mock, the same scenes as the iOS screens' (Lane 192), from the
 * same fixtures at the same clocks: the sheet half open and pulled up whole, with a written read on the
 * Sunday after kickoff (the Lineup's verb held as Kicked off), with no read written, with a read held for
 * his status (the Matchup's verb), and saved and read again with no signal; the page's first screen with
 * its verb pinned, its read before the season, a page the run held with no copy, its first screen in
 * season, his season's log, and the tier box with the every-format table and the basis. Both themes, a
 * Pixel 9 and a small phone (the Nexus 5's 360 by 640 dp). A face draws its initials.
 */
@RunWith(Parameterized::class)
class PlayerSnapshotTest(
    private val scene: Scene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
    ) {
        WrittenMedium("sheet-written-medium"),
        WrittenLarge("sheet-written-large"),
        UnwrittenMedium("sheet-unwritten-medium"),
        UnwrittenLarge("sheet-unwritten-large"),
        HeldMedium("sheet-held-medium"),
        HeldLarge("sheet-held-large"),
        StaleMedium("sheet-stale-medium"),
        PageHero("page-hero"),
        PageProse("page-prose"),
        PageHeld("page-held"),
        PageSeason("page-season"),
        PageLog("page-log"),
        PageTier("page-tier"),

        /** In season at the read's clock (Lane 226, the iOS player-page-formats): Swift on the one-value
         * stand-in at the Sunday clock, the every-format table on the week's figures with its footnote. */
        PageFormats("page-formats"),

        /** The same page with the week unread: every rank and figure the run's, the run's stamp. */
        PageFormatsUnread("page-formats-unread"),
        ;

        /** A scene on the one-value stand-in. */
        val oneValue: Boolean get() = this == PageFormats || this == PageFormatsUnread

        val sheet: SheetPlayer?
            get() =
                when (this) {
                    WrittenMedium, WrittenLarge, StaleMedium -> ODUNZE
                    UnwrittenMedium, UnwrittenLarge -> MAHOMES
                    HeldMedium, HeldLarge -> ETIENNE
                    else -> null
                }

        /** The screen's verb the sheet pins: the Lineup's way back (held once his game has kicked off), the
         * Matchup's way to the lineup; none on a saved sheet. */
        val offer: SheetOffer?
            get() =
                when (this) {
                    WrittenMedium, WrittenLarge, UnwrittenMedium, UnwrittenLarge ->
                        SheetOffer(
                            Words.Shelf.backToLineup,
                            null,
                            lineup = true,
                        ) {}
                    HeldMedium, HeldLarge -> SheetOffer(Words.Card.openLineup, null, lineup = true) {}
                    else -> null
                }

        val clock: Instant get() =
            if (this == WrittenMedium ||
                this == WrittenLarge ||
                this == StaleMedium
            ) {
                WeekFixture.sunday
            } else {
                WeekFixture.week
            }

        val large: Boolean get() = this == WrittenLarge || this == UnwrittenLarge || this == HeldLarge

        val inSeason: Boolean get() = this == PageSeason || this == PageTier
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        val height: Dp,
        /** The room a pushed screen has between the top bar and the bottom bar. */
        val room: Dp,
    ) {
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 923.dp, 763.dp),
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 640.dp, 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Test
    fun player() {
        val tall = scene in setOf(Scene.PageProse, Scene.PageLog, Scene.PageTier)
        if (tall) paparazzi.unsafeUpdateConfig(deviceConfig = phone.config, renderingMode = RenderingMode.SHRINK)
        val sheet = scene.sheet
        if (sheet != null) {
            val vm = sheetModel(scene, sheet)
            val state = vm.state.value
            val stamp = vm.stampWords(state)
            paparazzi.snapshot(name = name()) { CommishTheme(dark = dark) { SheetMock(sheet, state, stamp, scene, phone) } }
        } else {
            val model = pageModel(scene)
            paparazzi.snapshot(name = name()) { CommishTheme(dark = dark) { PageMock(model, scene, phone) } }
        }
    }

    private fun name(): String = "player-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}"

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene -> listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } } }
    }
}

/** The scenes' facts the mock's choices rest on, so a fixture that moves fails here, not in a picture. */
class PlayerSceneTest {
    @Test
    fun `each sheet scene is the state it names`() {
        val written = loaded(PlayerSnapshotTest.Scene.WrittenMedium)
        assertEquals(
            Words.Box.pts,
            written.card.tiles
                .first()
                .label,
        )
        assertTrue((written.card.read as SheetRead.Shown).read is ShownRead.Written)
        assertEquals(SheetVerb.Held(Words.Card.kickedOff), SheetVerb.of(PlayerSnapshotTest.Scene.WrittenMedium.offer, written.card.game))
        assertEquals(SheetRead.None(Words.Card.readNotYet), loaded(PlayerSnapshotTest.Scene.UnwrittenMedium).card.read)
        // Lane 274: the status caption goes over the kept read, never instead of it.
        val held = (loaded(PlayerSnapshotTest.Scene.HeldMedium).card.read as SheetRead.Shown).read as ShownRead.Written
        assertEquals("His status changed since this read was written. A new read is due by Sat Oct 17, 1:00 pm CT.", held.caption)
        assertTrue(held.body.startsWith("Travis Etienne Jr."))
        val stale = sheetModel(PlayerSnapshotTest.Scene.StaleMedium, ODUNZE)
        assertEquals(SavedReason.Offline, (stale.state.value as SheetState.Loaded).freshness.saved)
        assertEquals("Last read Sat 12:00 pm", stale.stampWords())
    }

    @Test
    fun `each page scene is the page it names`() {
        assertTrue(pageModel(PlayerSnapshotTest.Scene.PageHero).facts != null)
        assertEquals(null, pageModel(PlayerSnapshotTest.Scene.PageSeason).facts)
        assertEquals(null, pageModel(PlayerSnapshotTest.Scene.PageHeld).read)
        assertTrue(pageModel(PlayerSnapshotTest.Scene.PageTier).tier != null)
        val read = requireNotNull(pageModel(PlayerSnapshotTest.Scene.PageFormats).formats)
        assertTrue(read.footnote != null)
        assertEquals(listOf("RB 15", Words.Box.none, Words.Box.none), read.rows.map { it.rank })
        val unread = pageModel(PlayerSnapshotTest.Scene.PageFormatsUnread)
        assertEquals(null, unread.formats?.footnote)
        assertTrue(unread.basis.any { it.startsWith("Projected updated") })
    }

    private fun loaded(scene: PlayerSnapshotTest.Scene): SheetState.Loaded =
        sheetModel(scene, requireNotNull(scene.sheet)).state.value as SheetState.Loaded
}

private val ODUNZE = SheetPlayer("4431299", "rome-odunze", "Rome Odunze", "WR", "25", "CHI", null, boardId = "4431299")
private val MAHOMES = SheetPlayer("3139477", "patrick-mahomes", "Patrick Mahomes", "QB", "9", "KC", null, boardId = "3139477")
private val ETIENNE = SheetPlayer("4239996", "travis-etienne-jr", "Travis Etienne Jr.", "RB", "14", "NO", null, boardId = "4239996")

/** The fixture league as the shell holds it. */
private val LEAGUE =
    FollowedLeague(
        WeekFixture.LEAGUE,
        "Sunday Standard",
        app.trycommish.api.models.LeagueHost.espn,
        app.trycommish.api.models.ScoringPreset.ppr,
        app.trycommish.api.models.BoardFormat.ppr,
        app.trycommish.api.models.LeaguePhase.in_season,
        null,
        true,
    )

/** The sheet's view model at the scene's state: read fresh, or saved and then read with no signal. */
private fun sheetModel(
    scene: PlayerSnapshotTest.Scene,
    player: SheetPlayer,
): PlayerSheetViewModel =
    runBlocking {
        val cache = MemoryCache()
        val stale = scene == PlayerSnapshotTest.Scene.StaleMedium
        if (stale) {
            val saved =
                playerGraph(
                    StubRunReads(RunFixture.StandIn),
                    StubPages(RunFixture.StandIn),
                    StubWeeks(WeekFixture.week),
                    cache,
                    FixedClock(WeekFixture.week),
                )
            PlayerSheetViewModel(player, saved, LEAGUE).load()
        }
        val graph =
            playerGraph(
                StubRunReads(RunFixture.StandIn, stale),
                StubPages(RunFixture.StandIn, offline = stale),
                StubWeeks(scene.clock, stale),
                cache,
                FixedClock(scene.clock),
            )
        PlayerSheetViewModel(player, graph, LEAGUE).also { it.load() }
    }

/** The page at the scene: before the season the stand-in's, in season the contract run's. */
private fun pageModel(scene: PlayerSnapshotTest.Scene): PlayerPageModel =
    runBlocking {
        if (scene.oneValue) {
            val clock = FixedClock(OneValueFixture.now)
            val weeks = StubOneValueWeeks(offline = scene == PlayerSnapshotTest.Scene.PageFormatsUnread)
            val graph =
                PlayerReadsGraph(
                    StubRunReads(RunFixture.OneValue),
                    StubPages(RunFixture.OneValue),
                    weeks,
                    MemoryCache(),
                    clock,
                    WeekFixture.zone,
                    SessionEnd {},
                )
            val vm = PlayerPageViewModel("d-andre-swift", graph, null)
            vm.read()
            return@runBlocking (vm.state.value as PageState.Loaded).model
        }
        val fixture = if (scene.inSeason) RunFixture.Contract else RunFixture.StandIn
        val held: Map<String, RunFixture?> = if (scene == PlayerSnapshotTest.Scene.PageHeld) mapOf("4431299" to null) else emptyMap()
        val graph =
            playerGraph(
                StubRunReads(fixture),
                StubPages(fixture, held),
                StubWeeks(WeekFixture.week),
                MemoryCache(),
                FixedClock(WeekFixture.week),
            )
        val vm = PlayerPageViewModel(if (scene.inSeason) "jahmyr-gibbs" else "rome-odunze", graph, LEAGUE)
        vm.read()
        (vm.state.value as PageState.Loaded).model
    }

/** The sheet over a dimmed screen at one of its two heights: half the phone's screen, or all of it under
 * the status bar; its body the sheet's state, the screen's verb at its foot. */
@Composable
private fun SheetMock(
    player: SheetPlayer,
    state: SheetState,
    stamp: String?,
    scene: PlayerSnapshotTest.Scene,
    phone: PlayerSnapshotTest.Phone,
) {
    val c = CommishTheme.colors
    val height = if (scene.large) phone.height - STATUS_BAR.dp else phone.height / 2
    Column(Modifier.fillMaxWidth().height(phone.height).background(Color.Black.copy(alpha = if (c.dark) DIM_DARK else DIM_LIGHT))) {
        Box(Modifier.weight(1f))
        Column(
            Modifier
                .fillMaxWidth()
                .height(height)
                .clip(RoundedCornerShape(topStart = SHEET_CORNER.dp, topEnd = SHEET_CORNER.dp))
                .background(c.bg),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.padding(top = Tokens.Space.s3.dp).size(HANDLE_WIDTH.dp, 4.dp).background(c.lineStrong, RoundedCornerShape(2.dp)))
            // The app's own frame at the sheet's visible height: the body scrolls, the verb pinned at its foot.
            PlayerSheetFrame(
                playerSheetModel(player),
                {},
                {},
                Modifier.weight(1f).padding(bottom = Tokens.Space.s3.dp),
                foot = { SheetVerb.of(scene.offer, gameOf(state))?.let { SheetVerbView(it) {} } },
            ) {
                PlayerSheetState(state, stamp)
            }
        }
    }
}

/** The page as the mock draws it: its first screen between the top bar and the bar with the verb pinned
 * over its foot; and further down, the read, the season block, and the tier box with the table. */
@Composable
private fun PageMock(
    model: PlayerPageModel,
    scene: PlayerSnapshotTest.Scene,
    phone: PlayerSnapshotTest.Phone,
) {
    val bg = Modifier.background(CommishTheme.colors.bg).fillMaxWidth()
    val pad = Modifier.padding(Tokens.Space.s4.dp)
    when (scene) {
        PlayerSnapshotTest.Scene.PageProse -> Box(bg.then(pad)) { model.read?.let { PageRead(it) } }
        PlayerSnapshotTest.Scene.PageLog -> Box(bg.then(pad)) { SeasonBlock(model.season) }
        PlayerSnapshotTest.Scene.PageFormats, PlayerSnapshotTest.Scene.PageFormatsUnread ->
            Column(bg.then(pad)) {
                model.formats?.let { FormatsTableView(it) }
                Box(Modifier.height(Tokens.Space.s5.dp))
                BasisLines(model.basis + model.stamp)
            }
        PlayerSnapshotTest.Scene.PageTier ->
            Column(bg.then(pad)) {
                model.tier?.let { TierBoxView(it) }
                Box(Modifier.height(Tokens.Space.s5.dp))
                model.formats?.let { FormatsTableView(it) }
                Box(Modifier.height(Tokens.Space.s5.dp))
                BasisLines(model.basis + model.stamp)
            }
        else ->
            Column(bg.height(phone.room)) {
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) {
                    PageSectionsView(model, null, Modifier.wrapContentHeight(Alignment.Top, unbounded = true))
                }
                model.verb?.let { PinnedVerb(it) {} }
            }
    }
}

private const val STATUS_BAR = 32
private const val SHEET_CORNER = 28
private const val HANDLE_WIDTH = 32
private const val DIM_DARK = 0.6f
private const val DIM_LIGHT = 0.3f

/** A phone of `width` by `height` dp at 2x (320 dpi), Paparazzi's own resolution kept. */
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
