package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp

/** The letters' size as a share of the circle (web/src/lib/ui/initials.ts INITIALS_SCALE). */
private const val INITIALS_SCALE = 0.38f

/** A face with no headshot: the player's initials in a circle on the second surface, so someone is on
 * every row; the member's own team in the accent (web TeamAvatar.svelte); on the lit board, the board's.
 * A club (`club`, a defense's face, B245) is the same circle: its abbreviation on its colour from the
 * shared table (`Tokens.Club`), our own drawing, never a team logo; a club the table does not know keeps
 * the plain circle with its abbreviation. */
@Composable
fun Avatar(
    letters: String,
    side: Dp,
    modifier: Modifier = Modifier,
    mine: Boolean = false,
    /** On the lit board (a scoreboard), in the board's colours. */
    board: Boolean = false,
    /** A club, drawn in place of `letters` in its colours; null for a person or a team. */
    club: String? = null,
) {
    val c = CommishTheme.colors
    val chip = club?.let { Tokens.Club.colors[it] }
    val (fill, ink) =
        when {
            chip != null -> Color(chip.fill) to Color(chip.ink)
            mine && board -> c.scoreboardNum to Tokens.Color.scoreboardNumInk.resolve(c.dark)
            mine -> c.accent to c.accentInk
            board -> c.scoreboard2 to c.scoreboardInk
            else -> c.surface2 to c.ink2
        }
    val size = with(LocalDensity.current) { (side * INITIALS_SCALE).toSp() }
    Box(modifier.size(side).background(fill, CircleShape), contentAlignment = Alignment.Center) {
        Text(club ?: letters, style = Faces.body.copy(fontSize = size, fontWeight = FontWeight.SemiBold), color = ink)
    }
}
