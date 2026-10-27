package app.trycommish.feature.board

import androidx.compose.foundation.background
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
import app.trycommish.core.board.BoardModel
import app.trycommish.core.board.BoardPosition
import app.trycommish.core.board.BoardSection
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.RunWords
import app.trycommish.core.liveorder.OneValueFixture
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The Board's mock, the same scenes as the iOS screen's (Lane 190), from the same fixture runs at the
 * same clocks. Before the draft, the stand-in's PPR board (shared/fixtures/standin-run): the top of the
 * All view, a position's view (WR) at its first tier and its cliff, a tier's cliff mid-list, a kicker's
 * view in the drafts' order, the defenses' (each face its club's chip, B245), and the WR view's foot
 * with the complete basis under its last rows. In
 * season, the contract run (shared/fixtures/run): the rest of the season's head with its weeks and the
 * verb to follow a league, and the same board saved and read with no signal, stale with its reason.
 * Both themes, a Pixel 9 and a small phone (the Nexus 5's 360 by 640 dp). A face draws its initials.
 */
@RunWith(Parameterized::class)
class BoardSnapshotTest(
    private val scene: Scene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
        val position: BoardPosition?,
        val inSeason: Boolean,
    ) {
        Top("top", null, false),
        Position("position", BoardPosition.Receiver, false),

        /** A tier's cliff mid-list: the last rows of one tier, the next tier's band and its first rows. */
        Cliff("cliff", BoardPosition.Receiver, false),
        Kicker("kicker", BoardPosition.Kicker, false),

        /** The defenses in the drafts' order, each face its club's chip (B245). */
        Defense("defense", BoardPosition.Defense, false),

        /** The foot: the WR view's last rows and the basis under them. */
        Foot("foot", BoardPosition.Receiver, false),

        /** In season: the rest of the season's head. */
        Rest("rest", null, true),

        /** In season, saved and read with no signal. */
        Stale("stale", null, true),

        /** In season at the order's clock (Lane 226, the iOS board-clock): the one-value stand-in at the
         * Sunday clock, its top rows the order's with the order's lead under the heading and in the basis. */
        Clock("clock", null, true),

        /** The same board while the order is unread: the run's rows with the run's stamp in the basis. */
        ClockUnread("clock-unread", null, true),

        /** At the order's clock with a player put on IR after the nightly the run's capture does not list,
         * as the API answers him (Lane 243, B251, fix round 1): his points and value kept, his row after
         * every available player with the list's word in his pill, and no count line under the All view's
         * foot. */
        ClockMissing("clock-missing", null, true),
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        /** The room a screen has between the status bar with the top bar and the bottom bar. */
        val room: Dp,
    ) {
        /** A Pixel 9's 411 by 923 dp, drawn at 2x as the other screens' references are. */
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),

        /** The Nexus 5's 360 by 640 dp. */
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Test
    fun board() {
        // Each scene drawn at its own height: the first screen's room, or the table's run mid-list.
        // The clock scenes grow to their basis, so the order's lead and the run's stamp are both drawn.
        val clock = scene == Scene.Clock || scene == Scene.ClockUnread
        paparazzi.unsafeUpdateConfig(
            deviceConfig = phone.config,
            renderingMode = if (clock) RenderingMode.V_SCROLL else RenderingMode.SHRINK,
        )
        paparazzi.snapshot(name = "board-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Mock(scene, phone) }
        }
    }

    companion object {
        /** The scenes drawn on the one-value stand-in at the Sunday clock. */
        val CLOCK_SCENES = setOf(Scene.Clock, Scene.ClockUnread, Scene.ClockMissing)

        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene ->
                listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } }
            }
    }
}

/** The scenes' facts the mock's choices rest on, so a fixture that moves fails here, not in a picture. */
class BoardSceneTest {
    @Test
    fun `the cliff scene shows a drop between two tiers`() {
        val shown = aroundCliff(modelOf(BoardSnapshotTest.Scene.Cliff).sections)
        assertEquals(2, shown.size)
        assertNotNull("the tier above says its drop", shown.first().band?.drop)
    }

    @Test
    fun `the clock scenes say the order's lead and the run's stamp`() {
        val read = modelOf(BoardSnapshotTest.Scene.Clock)
        assertTrue(read.atClock)
        assertEquals(read.restLine, read.basis.first())
        val unread = modelOf(BoardSnapshotTest.Scene.ClockUnread)
        assertFalse(unread.atClock)
        assertTrue(unread.basis.last().startsWith("Projected updated"))
        val missing = modelOf(BoardSnapshotTest.Scene.ClockMissing)
        assertTrue(missing.atClock)
        val row = missing.rows.single { it.id == MISSING }
        assertTrue("the foot draws him", row in missing.rows.takeLast(AROUND))
        assertTrue(row.pill.endsWith(" IR"))
        assertFalse(missing.basis.any { it.startsWith("The first") })
    }

    @Test
    fun `the stale scene says why its board shows`() {
        assertEquals(
            "You're offline, so this is the last board this device saved, updated Oct 21.",
            stampOf(BoardSnapshotTest.Scene.Stale),
        )
    }
}

/** Rows enough to fill the first screen of the tallest phone. */
private const val FIRST_ROWS = 12

/** The clock scenes' top rows, drawn above the basis so the lead and the stamp are both in the picture. */
private const val CLOCK_ROWS = 6

/** The one-value stand-in's first player (D'Andre Swift), the one the missing scene puts on IR. */
private val MISSING: String =
    OneValueFixture.parity
        .getValue("players")
        .jsonArray
        .first()
        .jsonObject
        .getValue("id")
        .jsonPrimitive
        .content

/** The rows drawn on each side of a tier's cliff, and above the basis. */
private const val AROUND = 4

/** The first tier from the fourth on whose band says its drop. */
private const val FIRST_MID_LIST = 3

private fun modelOf(scene: BoardSnapshotTest.Scene): BoardModel {
    if (scene in BoardSnapshotTest.CLOCK_SCENES) {
        val order =
            when (scene) {
                BoardSnapshotTest.Scene.Clock -> OneValueFixture.order()
                BoardSnapshotTest.Scene.ClockMissing -> OneValueFixture.listing(MISSING)
                else -> null
            }
        return BoardModel.of(
            RunFixture.OneValue.read(),
            null,
            inSeason = true,
            following = false,
            now = OneValueFixture.now,
            zone = RunFixture.zone,
            order = order,
        )
    }
    val fixture = if (scene.inSeason) RunFixture.Contract else RunFixture.StandIn
    val now = if (scene.inSeason) RunFixture.inSeason else RunFixture.preDraft
    return BoardModel.of(fixture.read(), scene.position, scene.inSeason, following = false, now = now, zone = RunFixture.zone)
}

/** The view model's stamp at the scene: the offline words over the saved board, none over a fresh read. */
private fun stampOf(scene: BoardSnapshotTest.Scene): String? =
    if (scene == BoardSnapshotTest.Scene.Stale) RunWords.offline(RunFixture.Contract.read().manifest) else null

/** The sections the first screen reaches, their rows up to the tallest phone's first screen. */
private fun firstScreen(
    sections: List<BoardSection>,
    rows: Int = FIRST_ROWS,
): List<BoardSection> {
    var left = rows
    return sections.mapNotNull { section ->
        if (left <= 0) return@mapNotNull null
        val kept = section.rows.take(left)
        left -= kept.size
        section.copy(rows = kept)
    }
}

/** The first tier from the fourth on whose band says its drop: its band and last rows, then the next
 * tier's band and its first rows. */
private fun aroundCliff(sections: List<BoardSection>): List<BoardSection> {
    val banded = sections.filter { it.band != null }
    val index =
        banded.indices.drop(FIRST_MID_LIST).firstOrNull { banded[it].band?.drop != null && it + 1 in banded.indices } ?: return emptyList()
    val above = banded[index]
    val below = banded[index + 1]
    return listOf(above.copy(rows = above.rows.takeLast(AROUND)), below.copy(rows = below.rows.take(AROUND)))
}

/** The screen as the mock draws it. The phone's first screen is the room between the top bar and the
 * bar (the app draws both), the board's top with the verb pinned over its foot; mid-list is the table
 * alone around a tier's cliff; the foot the last rows over the basis. */
@Composable
private fun Mock(
    scene: BoardSnapshotTest.Scene,
    phone: BoardSnapshotTest.Phone,
) {
    val model = modelOf(scene)
    val bg = Modifier.background(CommishTheme.colors.bg)
    when (scene) {
        BoardSnapshotTest.Scene.Clock, BoardSnapshotTest.Scene.ClockUnread ->
            Column(bg.fillMaxWidth()) { BoardPage(model, null, firstScreen(model.sections, CLOCK_ROWS)) }
        BoardSnapshotTest.Scene.Cliff ->
            Column(bg.fillMaxWidth().padding(vertical = Tokens.Space.s4.dp)) { BoardTable(model, aroundCliff(model.sections)) }
        BoardSnapshotTest.Scene.Foot, BoardSnapshotTest.Scene.ClockMissing ->
            Column(bg.fillMaxWidth().padding(top = Tokens.Space.s4.dp)) {
                BoardTable(model, model.sections.takeLast(1).map { it.copy(rows = it.rows.takeLast(AROUND)) })
                BoardBasis(model.basis, Modifier.padding(vertical = Tokens.Space.s4.dp))
            }
        else ->
            Column(bg.fillMaxWidth().height(phone.room)) {
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) {
                    BoardPage(
                        model,
                        stampOf(scene),
                        firstScreen(model.sections),
                        Modifier.wrapContentHeight(Alignment.Top, unbounded = true),
                    )
                }
                model.words.verb?.let { BoardPin(it) {} }
            }
    }
}

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
