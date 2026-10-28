package app.trycommish.feature.sheet

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
import app.trycommish.api.models.BoardFormat
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.sheet.RowSave
import app.trycommish.core.sheet.SheetClock
import app.trycommish.core.sheet.SheetDeps
import app.trycommish.core.sheet.SheetImport
import app.trycommish.core.sheet.SheetParity
import app.trycommish.core.sheet.SheetStub
import app.trycommish.core.sheet.SheetViewModel
import app.trycommish.core.sheet.SheetWords
import app.trycommish.core.sheet.importCsv
import app.trycommish.core.sheet.openImport
import app.trycommish.core.sheet.parityRows
import app.trycommish.core.sheet.paste
import app.trycommish.core.sheet.sheetDetail
import app.trycommish.design.CommishTheme
import app.trycommish.design.Words
import app.trycommish.feature.board.BoardPin
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.nio.file.Files
import java.time.ZoneId

/**
 * The Sheet's mock, the iOS Sheet's scenes (Lane 254) from the same fixture sheet
 * (shared/fixtures/parity/sheet.json) through the view model over a stub account at the fixture's clock:
 * the sheet with its rows and the mock verb pinned; a row open in its editor (his note, his tags pressed, his
 * own tag's field); a note edited with no signal, its row not saved with the reason and the retry, the head
 * saying the same; the empty sheet over the stand-in's PPR board; the import with a CSV pasted; and the
 * import refused on the phone, before any request, with the header's sentence. Both themes, a Pixel 9 and a
 * small phone (the Nexus 5's 360 by 640 dp). A face draws its initials.
 */
@RunWith(Parameterized::class)
class SheetSnapshotTest(
    private val scene: Scene,
    private val dark: Boolean,
    private val phone: Phone,
) {
    enum class Scene(
        val id: String,
    ) {
        Rows("rows"),
        Edited("edited"),
        Unsaved("unsaved"),
        Empty("empty"),
        Import("import"),
        Refused("refused"),
    }

    enum class Phone(
        val id: String,
        val config: DeviceConfig,
        /** The room a screen has between the status bar with the top bar and the bottom bar. */
        val room: Dp,
    ) {
        Pixel9("pixel9", twoX(DeviceConfig.PIXEL_6, 411, 923), 763.dp),
        Small("small", twoX(DeviceConfig.NEXUS_5, 360, 640), 480.dp),
    }

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = phone.config, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Before
    fun setUp() = setMainForScenes()

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun sheet() {
        val view = SheetScenes.view(scene)
        paparazzi.unsafeUpdateConfig(deviceConfig = phone.config, renderingMode = RenderingMode.SHRINK)
        paparazzi.snapshot(name = "sheet-${scene.id}-${phone.id}-${if (dark) "dark" else "light"}") {
            CommishTheme(dark = dark) { Mock(view, phone) }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{2}-dark={1}")
        fun cases(): List<Array<Any>> =
            Scene.entries.flatMap { scene ->
                listOf(false, true).flatMap { dark -> Phone.entries.map { arrayOf(scene, dark, it) } }
            }
    }
}

/** The scenes are the states they name, so a fixture that moves fails here, not in a picture. */
class SheetScenesTest {
    @Before
    fun setUp() = setMainForScenes()

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun `the scenes are the states they name`() {
        val unsaved = SheetScenes.view(SheetSnapshotTest.Scene.Unsaved)
        assertEquals(
            RowSave.Unsaved(SheetWords.offline),
            unsaved.model
                ?.lines
                ?.get(2)
                ?.save,
        )
        val refused = SheetScenes.view(SheetSnapshotTest.Scene.Refused)
        assertEquals(SheetImport.Open("The first row must name rank, player_id, name and position"), refused.ui.importing)
        val empty = SheetScenes.view(SheetSnapshotTest.Scene.Empty)
        assertEquals(5, empty.ui.preview.size)
        assertNull(empty.model)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
private fun setMainForScenes() = Dispatchers.setMain(UnconfinedTestDispatcher())

/** Each scene's state, made by the view model over the stub as a member would make it. */
private object SheetScenes {
    private val zone: ZoneId = ZoneId.of("America/Chicago")

    /** The first rows of the fixture's CSV, as pasted. */
    private fun pasted(): String =
        SheetParity
            .load()
            .csv
            .split("\n")
            .take(4)
            .joinToString("\n")

    fun view(scene: SheetSnapshotTest.Scene): SheetView {
        val stub = SheetStub(if (scene == SheetSnapshotTest.Scene.Empty) null else sheetDetail(parityRows()))
        val vm =
            SheetViewModel(
                SheetDeps(
                    stub,
                    StubRunReads(RunFixture.StandIn),
                    MemoryCache(),
                    FixedClock(SheetClock.now),
                    zone,
                    Files.createTempDirectory("sheet-snapshots").toFile(),
                    Dispatchers.Main,
                ),
                BoardFormat.ppr,
            ) {}
        vm.load()
        when (scene) {
            SheetSnapshotTest.Scene.Rows, SheetSnapshotTest.Scene.Empty -> Unit
            SheetSnapshotTest.Scene.Edited -> vm.toggle("4430807")
            SheetSnapshotTest.Scene.Unsaved -> {
                stub.offline = true
                vm.setNote("4431299", "Two lines.\nTarget in round three")
            }
            SheetSnapshotTest.Scene.Import -> {
                vm.openImport()
                vm.paste(pasted())
            }
            SheetSnapshotTest.Scene.Refused -> {
                vm.openImport()
                vm.paste("name,team\nJa'Marr Chase,CIN")
                vm.importCsv(vm.ui.value.pasted)
            }
        }
        val ui = vm.ui.value
        return SheetView(ui, vm.model(ui), ui.formatLabel, ui.stampWords(zone))
    }
}

/** Rows enough to fill the first screen of the tallest phone. */
private const val FIRST_ROWS = 10

private val PIN = 64.dp

/** The screen as the phone's first screen draws it: the room between the top bar and the bar, the sheet's
 * top with the verb pinned over its foot where the sheet has rows and no panel is open. */
@Composable
private fun Mock(
    view: SheetView,
    phone: SheetSnapshotTest.Phone,
) {
    val pinned = (view.model?.players ?: 0) > 0 && view.ui.importing == SheetImport.Closed
    Column(Modifier.background(CommishTheme.colors.bg).fillMaxWidth().height(phone.room)) {
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) {
            SheetPage(view, FIRST_ROWS, Modifier.wrapContentHeight(Alignment.Top, unbounded = true))
        }
        if (pinned) Box(Modifier.height(PIN)) { BoardPin(Words.PageVerb.mock) {} }
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
