package app.trycommish.feature.player

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints

/** The sizes a text steps down through to fit its cell, as iOS's minimum scale factor shrinks it. */
private val SCALES = listOf(1f, 0.9f, 0.8f, 0.7f)

/**
 * A text that fits its cell: drawn at its size where it fits in `maxLines` with no word broken across
 * lines, else at the first smaller step that does (down to 70%), as a cell's head or figure is shrunk
 * on iOS rather than cut or broken mid-word.
 */
@Composable
internal fun FitText(
    text: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    maxLines: Int = 1,
    textAlign: TextAlign? = null,
) {
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(modifier) {
        val width = constraints.maxWidth
        val fitted =
            SCALES.map { style.copy(fontSize = style.fontSize * it) }.firstOrNull { scaled ->
                val words = text.split(' ').all { word -> measurer.measure(word, scaled, softWrap = false).size.width <= width }
                val whole = measurer.measure(text, scaled, maxLines = maxLines, constraints = Constraints(maxWidth = width))
                words && !whole.hasVisualOverflow
            } ?: style.copy(fontSize = style.fontSize * SCALES.last())
        Text(
            text,
            style = fitted,
            color = color,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis,
            textAlign = textAlign,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
