package app.trycommish.feature.start

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp

/** Words that open a page: a link to TalkBack, its words its label. */
internal fun Modifier.clickableLink(
    words: String,
    open: () -> Unit,
): Modifier = clickable(onClickLabel = words, role = Role.Button, onClick = open)

/** A rule down the leading edge (the strip's accent, a moved row's, the move panel's), drawn behind the
 * content rather than laid out beside it, so the card needs no intrinsic height (an intrinsic pass drops
 * a wrapped chip line, Lane 181 review H1). */
internal fun Modifier.edgeRule(
    color: Color,
    width: Dp,
): Modifier = drawBehind { drawRect(color, size = Size(width.toPx(), size.height)) }

/** Text centred in the height it is given (a chip's line). */
internal fun Modifier.wrapCenter(): Modifier = wrapContentHeight(Alignment.CenterVertically)
