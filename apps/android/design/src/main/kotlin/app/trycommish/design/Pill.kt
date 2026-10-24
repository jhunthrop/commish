package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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

@Composable
private fun PillText(
    text: String,
    ground: Color,
    ink: Color,
    modifier: Modifier,
) {
    Text(
        text = text,
        style = Faces.label,
        color = ink,
        maxLines = 1,
        modifier =
            modifier
                .background(ground, RoundedCornerShape(Tokens.Radius.sm.dp))
                .padding(horizontal = Tokens.Space.s1.dp + 2.dp, vertical = 1.dp),
    )
}
