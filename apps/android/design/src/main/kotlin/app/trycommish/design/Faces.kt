package app.trycommish.design

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * A weight of the display face by role: the CSS number the web asks for and iOS draws (CommishDesign
 * FaceWeight), and the `wght` the bundled variable font is set to on Android so a figure's strokes match
 * iOS's at the same size. CoreText draws the same font file heavier than Android does, by more where
 * the face's weight axis is flat (500 to 600). Measured as the "0"'s side stroke over its height,
 * iOS's references against this module's ladder (FaceSpecimenSnapshotTest, Lane 195): iOS's 500, 600
 * and 700 draw as Android's 625, 675 and 750. This is the one place a cut is chosen; screens name a
 * role and never a FontWeight of this face.
 */
enum class NumWeight(
    val css: Int,
    val drawn: Int,
) {
    Medium(css = 500, drawn = 625),
    SemiBold(css = 600, drawn = 675),
    Bold(css = 700, drawn = 750),
}

/**
 * The interface face's weights: the CSS numbers screens and Material ask for (FontWeight.Normal to
 * Bold, as the web and iOS do) and the `wght` Outfit is set to for each, measured as NumWeight's are
 * (FaceSpecimenSnapshotTest's interface ladder against iOS's renders, Lane 195 fix round 1): CoreText
 * draws Outfit about 75 heavier at every weight, so 400, 500, 600 and 700 draw at 475, 575, 675 and
 * 775. Screens keep naming FontWeight for this face; the cut it draws is decided here.
 */
enum class UiWeight(
    val css: Int,
    val drawn: Int,
) {
    Regular(css = 400, drawn = 475),
    Medium(css = 500, drawn = 575),
    SemiBold(css = 600, drawn = 675),
    Bold(css = 700, drawn = 775),
}

/**
 * The three faces (Tokens.Font): Outfit for the interface, Big Shoulders Display for numbers, Newsreader
 * for prose, bundled as their variable fonts (OFL, design/fonts-licences). Numbers take tabular figures
 * so a column of them lines up.
 */
object Faces {
    /** The font file at `wght`, matched by a style asking for `asked` (its own `wght` unless said). */
    @OptIn(ExperimentalTextApi::class)
    private fun font(
        res: Int,
        wght: Int,
        asked: Int = wght,
    ): Font = Font(res, FontWeight(asked), variationSettings = FontVariation.Settings(FontVariation.weight(wght)))

    private fun family(
        res: Int,
        vararg weights: FontWeight,
    ): FontFamily = FontFamily(weights.map { font(res, it.weight) })

    /** Outfit at each CSS weight, each drawn at its measured cut (UiWeight). */
    val ui: FontFamily = FontFamily(UiWeight.entries.map { font(R.font.outfit, wght = it.drawn, asked = it.css) })

    /** The display face at each role's drawn weight, so a style's weight matches one of its fonts exactly. */
    private val numFamily: FontFamily = FontFamily(NumWeight.entries.map { font(R.font.big_shoulders_display, it.drawn) })
    val read: FontFamily = family(R.font.newsreader, FontWeight.Normal, FontWeight.Medium)

    private const val TABULAR = "tnum"
    private const val LABEL_TRACKING = 0.06

    /** The display face at a `wght` of its own, for the weight measurement only (FaceSpecimenSnapshotTest). */
    internal fun numAt(
        wght: Int,
        size: TextUnit,
    ): TextStyle =
        TextStyle(
            fontFamily = FontFamily(font(R.font.big_shoulders_display, wght)),
            fontWeight = FontWeight(wght),
            fontSize = size,
            fontFeatureSettings = TABULAR,
        )

    /** The interface face at a `wght` of its own, for the weight measurement only. */
    internal fun uiAt(
        wght: Int,
        size: TextUnit,
    ): TextStyle = TextStyle(fontFamily = FontFamily(font(R.font.outfit, wght)), fontWeight = FontWeight(wght), fontSize = size)

    /** A figure in the display face at a role's weight and a size, tabular. */
    fun number(
        weight: NumWeight,
        size: TextUnit = Tokens.Type.lg.sp,
    ): TextStyle = TextStyle(fontFamily = numFamily, fontWeight = FontWeight(weight.drawn), fontSize = size, fontFeatureSettings = TABULAR)

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
    val cell = number(NumWeight.SemiBold)

    /** A score's big figure, tabular. */
    val figure = number(NumWeight.Bold, Tokens.Type.xl.sp)

    /** A panel title in the display face. */
    val head = number(NumWeight.Bold, Tokens.Type.head.sp).copy(fontFeatureSettings = null)

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
