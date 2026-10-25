package app.trycommish.feature.start

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role

/** Words that open a page: a link to TalkBack, its words its label. */
internal fun Modifier.clickableLink(
    words: String,
    open: () -> Unit,
): Modifier = clickable(onClickLabel = words, role = Role.Button, onClick = open)

/** Text centred in the height it is given (a chip's line). */
internal fun Modifier.wrapCenter(): Modifier = wrapContentHeight(Alignment.CenterVertically)
