package app.trycommish.design

import androidx.compose.ui.graphics.Color
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The theme reads the generated tokens: each colour its light value in the light scheme and its dark
 * value in the dark one, and Material's roles carry the same tokens. */
class ThemeTest {
    @Test
    fun `a token resolves to its light value in light and its dark value in dark`() {
        assertEquals(Color(0xFF15120F), Tokens.Color.ink.resolve(dark = false))
        assertEquals(Color(0xFFF5F0EA), Tokens.Color.ink.resolve(dark = true))
    }

    @Test
    fun `the palette carries the tokens for each theme`() {
        val light = CommishColors.of(dark = false)
        val dark = CommishColors.of(dark = true)
        assertEquals(Color(0xFFFFFFFF), light.bg)
        assertEquals(Color(0xFF090807), dark.bg)
        assertEquals(Color(0xFFC2470A), light.accent)
        assertEquals(Color(0xFFFF7130), dark.accent)
        assertEquals(Color(0xFFFDEBE0), light.accentWash)
    }

    @Test
    fun `Material's roles are the tokens in both schemes`() {
        for (dark in listOf(false, true)) {
            val scheme = commishColorScheme(dark)
            val colors = CommishColors.of(dark)
            assertEquals(colors.accent, scheme.primary)
            assertEquals(colors.accentInk, scheme.onPrimary)
            assertEquals(colors.bg, scheme.background)
            assertEquals(colors.ink, scheme.onBackground)
            assertEquals(colors.line, scheme.outlineVariant)
        }
    }

    @Test
    fun `the mark takes the heavier weight at small sizes, as the web's does`() {
        assertEquals(MarkShape.SMALL_STROKE, markStroke(24f))
        assertEquals(MarkShape.SMALL_STROKE, markStroke(40f))
        assertEquals(MarkShape.STROKE, markStroke(96f))
    }
}
