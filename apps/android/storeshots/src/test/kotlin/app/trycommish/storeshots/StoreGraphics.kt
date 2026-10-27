package app.trycommish.storeshots

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.trycommish.storeshots.png.OpaquePng
import com.android.resources.Density
import com.android.resources.ScreenOrientation
import org.junit.AssumptionViolatedException
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement
import java.io.File

/** Where the store graphics go and the sizes Play takes (docs/store/2026-10-26-play-listing.md §1, §6). */
object StoreGraphics {
    /** The system property naming the folder to write; unset, every store graphic test is skipped. */
    const val PROPERTY = "storeGraphics"

    const val ICON_SIDE = 512

    /** 2.25 pixels a dp: the 1080 px width is 480 dp, room for the caption above a phone-wide screen. */
    private const val PHONE_DPI = 360

    /** The folder asked for, or null when this run draws no store graphics. */
    val out: File? get() = System.getProperty(PROPERTY)?.let(::File)

    /** The folder asked for; only a gated test reads it. */
    val folder: File get() = requireNotNull(out) { "-P$PROPERTY names no folder" }

    /** A 1080 by 1920 phone at 360 dpi (480 by 853 dp), drawn at its own resolution. */
    val phone: DeviceConfig = sized(1080, 1920, Density.create(PHONE_DPI))

    /** The 1024 by 500 feature graphic at 320 dpi (512 by 250 dp). */
    val feature: DeviceConfig = sized(1024, 500, Density.XHIGH)

    private fun sized(
        width: Int,
        height: Int,
        density: Density,
    ): DeviceConfig =
        DeviceConfig.PIXEL_6.copy(
            screenWidth = width,
            screenHeight = height,
            xdpi = density.dpiValue,
            ydpi = density.dpiValue,
            density = density,
            orientation = if (width > height) ScreenOrientation.LANDSCAPE else ScreenOrientation.PORTRAIT,
        )

    /** Paparazzi at `config`, each snapshot written to the store folder as an opaque PNG of that size;
     * with no folder asked for (the gate skips the test) it writes to the build's own. */
    fun paparazzi(config: DeviceConfig): Paparazzi =
        Paparazzi(
            deviceConfig = config,
            snapshotHandler = OpaquePng(out ?: File("build/store-graphics"), config.screenWidth, config.screenHeight),
            maxPercentDifference = 0.0,
            useDeviceResolution = true,
        )
}

/** Skips the test unless the run names a folder for the store graphics: CI draws none of them. */
class StoreGate : TestRule {
    override fun apply(
        base: Statement,
        description: Description,
    ): Statement =
        object : Statement() {
            override fun evaluate() {
                if (StoreGraphics.out == null) throw AssumptionViolatedException("-P${StoreGraphics.PROPERTY} not set")
                base.evaluate()
            }
        }
}
