package app.trycommish.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** A section of a screen: its head and an aside on one line, then its body. */
@Composable
fun Section(
    title: String,
    aside: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxWidth().padding(top = Tokens.Space.s5.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s2.dp),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(title, style = Faces.section, color = c.ink)
            if (aside != null) Text(aside, style = Faces.small, color = c.ink3, modifier = Modifier.weight(1f))
        }
        content()
    }
}

/** What the numbers above are, said once, in the reading face. */
@Composable
fun Basis(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        style = Faces.basis,
        color = CommishTheme.colors.ink3,
        modifier = modifier.padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s2.dp),
    )
}

/** A player in or out of a move: a small chevron, up in the gain colour, down in the loss colour. */
@Composable
fun MoveMark(
    into: Boolean,
    size: Dp = 12.dp,
    modifier: Modifier = Modifier,
) {
    val color = if (into) CommishTheme.colors.gainInk else CommishTheme.colors.lossInk
    Canvas(modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val path =
            Path().apply {
                if (into) {
                    moveTo(w / 2, h * 0.15f)
                    lineTo(w * 0.95f, h * 0.85f)
                    lineTo(w * 0.05f, h * 0.85f)
                } else {
                    moveTo(w * 0.05f, h * 0.15f)
                    lineTo(w * 0.95f, h * 0.15f)
                    lineTo(w / 2, h * 0.85f)
                }
                close()
            }
        drawPath(path, color)
    }
}
