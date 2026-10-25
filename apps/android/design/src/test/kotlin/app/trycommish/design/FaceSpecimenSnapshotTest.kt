package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.ide.common.rendering.api.SessionParams.RenderingMode
import com.android.resources.Density
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.io.File

/**
 * The display face as CI draws it, at 2x as the screens' references are. The ladder is the weight
 * measurement's Android side: a "0" at each `wght` from 500 to 850 at the sizes the figures use, its
 * stroke over its height read against iOS's references to choose NumWeight's drawn weights (Lane 195).
 * The roles are what the screens draw: each NumWeight at the figure sizes, in both themes.
 */
class FaceSpecimenSnapshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = TWO_X, maxPercentDifference = 0.0, useDeviceResolution = true)

    @Test
    fun ladder() {
        paparazzi.unsafeUpdateConfig(deviceConfig = TWO_X, renderingMode = RenderingMode.SHRINK)
        paparazzi.snapshot(name = "faces-ladder") {
            CommishTheme(dark = false) { Ladder(WEIGHTS, SIZES) { wght, size -> Faces.numAt(wght, size) } }
        }
    }

    /** The interface face's ladder, the same "0" from Regular to past ExtraBold at its sizes. */
    @Test
    fun uiLadder() {
        paparazzi.unsafeUpdateConfig(deviceConfig = TWO_X, renderingMode = RenderingMode.SHRINK)
        paparazzi.snapshot(name = "faces-ladder-ui") {
            CommishTheme(dark = false) { Ladder(UI_WEIGHTS, UI_SIZES) { wght, size -> Faces.uiAt(wght, size) } }
        }
    }

    @Test
    fun rolesLight() = roles(dark = false)

    @Test
    fun rolesDark() = roles(dark = true)

    private fun roles(dark: Boolean) {
        paparazzi.unsafeUpdateConfig(deviceConfig = TWO_X, renderingMode = RenderingMode.SHRINK)
        paparazzi.snapshot(name = "faces-roles-${if (dark) "dark" else "light"}") { CommishTheme(dark = dark) { Roles() } }
    }

    companion object {
        /** The ladder's weights: Medium's CSS number to past ExtraBold, a step of 25. */
        val WEIGHTS = (500..850 step 25).toList()

        /** The interface face's ladder: Regular's CSS number to past Bold. */
        val UI_WEIGHTS = (400..800 step 25).toList()

        /** The interface sizes: xs, sm, md, lg, xl. */
        val UI_SIZES = listOf(Tokens.Type.xs, Tokens.Type.sm, Tokens.Type.md, Tokens.Type.lg, Tokens.Type.xl)

        /** The figure sizes: md, lg, xl, head, display. */
        val SIZES = listOf(Tokens.Type.md, Tokens.Type.lg, Tokens.Type.xl, Tokens.Type.head, Tokens.Type.display)

        private val TWO_X =
            DeviceConfig.PIXEL_6.copy(
                screenWidth = 411 * 2,
                screenHeight = 923 * 2,
                xdpi = Density.XHIGH.dpiValue,
                ydpi = Density.XHIGH.dpiValue,
                density = Density.XHIGH,
            )
    }
}

/** A grid of "0": a row per weight, a column per size, nothing else drawn, so each glyph is found alone. */
@Composable
private fun <S : Number> Ladder(
    weights: List<Int>,
    sizes: List<S>,
    style: (Int, TextUnit) -> TextStyle,
) {
    Column(Modifier.background(CommishTheme.colors.bg).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        weights.forEach { wght ->
            Row(verticalAlignment = Alignment.Bottom) {
                sizes.forEach { size ->
                    Text("0", style = style(wght, size.toFloat().sp), color = CommishTheme.colors.ink, modifier = Modifier.width(48.dp))
                }
            }
        }
    }
}

/** Each role at each figure size, as a screen draws it. */
@Composable
private fun Roles() {
    Column(Modifier.background(CommishTheme.colors.bg).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        NumWeight.entries.forEach { weight ->
            Text(weight.name, style = Faces.label, color = CommishTheme.colors.ink3)
            FaceSpecimenSnapshotTest.SIZES.forEach { size ->
                Text("2026 818.2 +30.6", style = Faces.number(weight, size.sp), color = CommishTheme.colors.ink)
            }
        }
    }
}

/** Every committed reference is small enough to keep in the repository. */
class DesignReferencesTest {
    @Test
    fun everyReferenceIsSmallEnoughToKeep() {
        val images = File("src/test/snapshots/images").listFiles().orEmpty()
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        const val MAX_BYTES = 300 * 1024
    }
}
