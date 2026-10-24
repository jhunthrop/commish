package app.trycommish.design

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * The three faces (Tokens.Font): Outfit for the interface, Big Shoulders Display for numbers, Newsreader
 * for prose, bundled as their variable fonts (OFL, design/fonts-licences). Numbers take tabular figures
 * so a column of them lines up.
 */
object Faces {
    @OptIn(ExperimentalTextApi::class)
    private fun family(
        res: Int,
        vararg weights: FontWeight,
    ): FontFamily =
        FontFamily(
            weights.map { w -> Font(res, w, variationSettings = FontVariation.Settings(FontVariation.weight(w.weight))) },
        )

    val ui: FontFamily = family(R.font.outfit, FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold)
    val num: FontFamily =
        family(R.font.big_shoulders_display, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold, FontWeight.ExtraBold)
    val read: FontFamily = family(R.font.newsreader, FontWeight.Normal, FontWeight.Medium)

    private const val TABULAR = "tnum"
    private const val LABEL_TRACKING = 0.06

    /** Labels on cells: uppercase, tracked, the smallest size. */
    val label =
        TextStyle(fontFamily = ui, fontWeight = FontWeight.SemiBold, fontSize = Tokens.Type.xs.sp, letterSpacing = LABEL_TRACKING.em)

    /** Secondary text. */
    val small = TextStyle(fontFamily = ui, fontSize = Tokens.Type.sm.sp)

    /** Names and body in rows. */
    val body = TextStyle(fontFamily = ui, fontSize = Tokens.Type.md.sp)

    /** A section's head. */
    val section = TextStyle(fontFamily = ui, fontWeight = FontWeight.SemiBold, fontSize = Tokens.Type.lg.sp)

    /** A number in a row, the interface's size, tabular. */
    val cell = TextStyle(fontFamily = num, fontWeight = FontWeight.SemiBold, fontSize = Tokens.Type.lg.sp, fontFeatureSettings = TABULAR)

    /** A score's big figure, tabular. */
    val figure = TextStyle(fontFamily = num, fontWeight = FontWeight.Bold, fontSize = Tokens.Type.xl.sp, fontFeatureSettings = TABULAR)

    /** A panel title in the display face. */
    val head = TextStyle(fontFamily = num, fontWeight = FontWeight.ExtraBold, fontSize = Tokens.Type.head.sp)

    /** Prose under a table, said once. */
    val basis = TextStyle(fontFamily = read, fontSize = Tokens.Type.sm.sp)
}

/** Material's type roles in the faces, so its components read in them too. */
val commishTypography: Typography =
    Typography(
        displaySmall = Faces.head,
        headlineSmall = Faces.head,
        titleLarge = Faces.section,
        titleMedium = Faces.body.copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = Faces.body,
        bodyMedium = Faces.body,
        bodySmall = Faces.small,
        labelLarge = Faces.body.copy(fontWeight = FontWeight.SemiBold),
        labelMedium = Faces.small.copy(fontWeight = FontWeight.Medium),
        labelSmall = Faces.label,
    )
