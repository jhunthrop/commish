package app.trycommish.storeshots

import app.trycommish.design.CommishTheme
import app.trycommish.storeshots.png.withAlpha
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.io.File

/**
 * The eight phone screenshots for Play, each the app's own screen over the shared fixtures under its
 * caption, dark theme, 1080 by 1920 with no alpha. Skipped unless -PstoreGraphics names the folder.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class StoreShotsTest(
    private val shot: StoreShot,
) {
    private val paparazzi = StoreGraphics.paparazzi(StoreGraphics.phone)

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(StoreGate()).around(paparazzi)

    private val scheduler = TestCoroutineScheduler()

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher(scheduler))

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun shot() {
        val screen = screenOf(shot, scheduler)
        val chrome = chromeOf(shot)
        paparazzi.snapshot(name = shot.file) {
            CommishTheme(dark = true) { StoreShotFrame(shot.caption, chrome) { screen() } }
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun shots(): List<StoreShot> = StoreShot.entries
    }
}

/** The 1024 by 500 feature graphic: the whistle and the name on the dark page, no alpha. */
class FeatureGraphicTest {
    private val paparazzi = StoreGraphics.paparazzi(StoreGraphics.feature)

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(StoreGate()).around(paparazzi)

    @Test
    fun feature() {
        paparazzi.snapshot(name = "feature-graphic") { CommishTheme(dark = true) { FeatureGraphic() } }
    }
}

/** The 512 by 512 store icon: the web's icon, pixel for pixel, re-saved as 32-bit PNG with an alpha channel. */
class StoreIconTest {
    @get:Rule
    val gate = StoreGate()

    @Test
    fun icon() {
        val source = File(requireNotNull(System.getProperty("webIcon")) { "webIcon names no file" })
        withAlpha(source, File(StoreGraphics.folder, "icon-512.png"), StoreGraphics.ICON_SIDE)
    }
}
