package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp

/** The letters' size as a share of the circle (web/src/lib/ui/initials.ts INITIALS_SCALE). */
private const val INITIALS_SCALE = 0.38f

/** A face with no headshot: the player's initials in a circle on the second surface, so someone is on
 * every row. */
@Composable
fun Avatar(
    letters: String,
    side: Dp,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    val size = with(LocalDensity.current) { (side * INITIALS_SCALE).toSp() }
    Box(modifier.size(side).background(c.surface2, CircleShape), contentAlignment = Alignment.Center) {
        Text(letters, style = Faces.body.copy(fontSize = size, fontWeight = FontWeight.SemiBold), color = c.ink2)
    }
}
