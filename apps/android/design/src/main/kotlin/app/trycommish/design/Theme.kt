package app.trycommish.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** A token's colour in a theme. */
fun ThemedColor.resolve(dark: Boolean): Color = Color(if (dark) this.dark else light)

/** The tokens the screens draw with, resolved for one theme. */
@Immutable
data class CommishColors(
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val line: Color,
    val lineStrong: Color,
    val ink: Color,
    val ink2: Color,
    val ink3: Color,
    val shell: Color,
    val shellLine: Color,
    val accent: Color,
    val accentInk: Color,
    val accentText: Color,
    val accentWash: Color,
    val focus: Color,
    val gainBg: Color,
    val gainInk: Color,
    val lossBg: Color,
    val lossInk: Color,
    /** The lit board (the Team row, a score bug): its ground, its ink, its labels, its figure. */
    val scoreboard: Color,
    val scoreboardInk: Color,
    val scoreboardInk2: Color,
    val scoreboardNum: Color,
) {
    companion object {
        fun of(dark: Boolean): CommishColors {
            val c = Tokens.Color
            return CommishColors(
                bg = c.bg.resolve(dark),
                surface = c.surface.resolve(dark),
                surface2 = c.surface2.resolve(dark),
                line = c.line.resolve(dark),
                lineStrong = c.lineStrong.resolve(dark),
                ink = c.ink.resolve(dark),
                ink2 = c.ink2.resolve(dark),
                ink3 = c.ink3.resolve(dark),
                shell = c.shell.resolve(dark),
                shellLine = c.shellLine.resolve(dark),
                accent = c.accent.resolve(dark),
                accentInk = c.accentInk.resolve(dark),
                accentText = c.accentText.resolve(dark),
                accentWash = c.accentWash.resolve(dark),
                focus = c.focus.resolve(dark),
                gainBg = c.gainBg.resolve(dark),
                gainInk = c.gainInk.resolve(dark),
                lossBg = c.lossBg.resolve(dark),
                lossInk = c.lossInk.resolve(dark),
                scoreboard = c.scoreboard.resolve(dark),
                scoreboardInk = c.scoreboardInk.resolve(dark),
                scoreboardInk2 = c.scoreboardInk2.resolve(dark),
                scoreboardNum = c.scoreboardNum.resolve(dark),
            )
        }
    }
}

/** Material 3's roles from the tokens, so Material's own components (the bottom bar, buttons, the
 * progress indicator) draw in the Commish colours. */
fun commishColorScheme(dark: Boolean): ColorScheme {
    val c = CommishColors.of(dark)
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.accent,
        onPrimary = c.accentInk,
        primaryContainer = c.accentWash,
        onPrimaryContainer = c.ink,
        inversePrimary = c.accent,
        secondary = c.ink2,
        onSecondary = c.bg,
        secondaryContainer = c.surface2,
        onSecondaryContainer = c.ink,
        tertiary = c.ink3,
        onTertiary = c.bg,
        tertiaryContainer = c.surface,
        onTertiaryContainer = c.ink,
        background = c.bg,
        onBackground = c.ink,
        surface = c.bg,
        onSurface = c.ink,
        surfaceVariant = c.surface,
        onSurfaceVariant = c.ink2,
        surfaceTint = c.accent,
        inverseSurface = c.ink,
        inverseOnSurface = c.bg,
        error = c.lossInk,
        onError = c.bg,
        errorContainer = c.lossBg,
        onErrorContainer = c.lossInk,
        outline = c.lineStrong,
        outlineVariant = c.line,
        scrim = c.ink,
        surfaceBright = c.bg,
        surfaceDim = c.surface,
        surfaceContainer = c.surface,
        surfaceContainerHigh = c.surface2,
        surfaceContainerHighest = c.surface2,
        surfaceContainerLow = c.bg,
        surfaceContainerLowest = c.bg,
    )
}

private val LocalCommishColors = staticCompositionLocalOf { CommishColors.of(dark = false) }

/** The Commish theme: the tokens for the system's appearance (or the one given), Material's roles from
 * them, and the three faces. */
@Composable
fun CommishTheme(
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalCommishColors provides CommishColors.of(dark)) {
        MaterialTheme(colorScheme = commishColorScheme(dark), typography = commishTypography, content = content)
    }
}

/** The theme's tokens where a screen draws. */
object CommishTheme {
    val colors: CommishColors
        @Composable get() = LocalCommishColors.current
}
