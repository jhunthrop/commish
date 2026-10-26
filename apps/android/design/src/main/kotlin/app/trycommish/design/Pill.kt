package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** What a pill says by its colour, always beside its word: plain, you, a gain, a loss. */
enum class PillTone { Plain, Accent, Gain, Loss }

/** A short label on a tinted ground: a position, a streak, a state. */
@Composable
fun Pill(
    text: String,
    tone: PillTone = PillTone.Plain,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    val (ground, ink) =
        when (tone) {
            PillTone.Plain -> c.surface2 to c.ink2
            PillTone.Accent -> c.accentWash to c.accentText
            PillTone.Gain -> c.gainBg to c.gainInk
            PillTone.Loss -> c.lossBg to c.lossInk
        }
    PillText(text, ground, ink, modifier)
}

/** A player's position (and his rank at it, "WR 4"), the web's monochrome pill: the ink on the second
 * surface, bold, never a colour per position. `minWidth` is the pill's least width where a list lines its
 * pills up as a column (the Rankings row's slot, the web's --line-pill), its words centred; unspecified,
 * the pill is as wide as its words. */
@Composable
fun PositionPill(
    text: String,
    modifier: Modifier = Modifier,
    minWidth: Dp = Dp.Unspecified,
) {
    val c = CommishTheme.colors
    PillText(
        text,
        c.surface2,
        c.ink,
        modifier.widthIn(min = minWidth),
        pillStyle,
        if (minWidth == Dp.Unspecified) null else TextAlign.Center,
    )
}

/** The position pill's face: the label's, bold. */
val pillStyle: TextStyle = Faces.label.copy(fontWeight = FontWeight.Bold)

/** The room a pill's words take beside them, each side. */
val PILL_PADDING: Dp = Tokens.Space.s1.dp + 2.dp

@Composable
private fun PillText(
    text: String,
    ground: Color,
    ink: Color,
    modifier: Modifier,
    style: TextStyle = Faces.label,
    align: TextAlign? = null,
) {
    Text(
        text = text,
        style = style,
        color = ink,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        textAlign = align,
        modifier =
            modifier
                .background(ground, RoundedCornerShape(Tokens.Radius.sm.dp))
                .padding(horizontal = PILL_PADDING, vertical = 1.dp),
    )
}
