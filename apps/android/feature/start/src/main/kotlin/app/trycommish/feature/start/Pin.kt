package app.trycommish.feature.start

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.trycommish.core.start.StartPin
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.FootLine
import app.trycommish.feature.boxscore.MovePanelActions
import app.trycommish.feature.boxscore.MovePanelView

private val PIN_SHADOW = 8.dp

/** What the pin's controls do: the verb, the move's confirmation, the way out, a page opened. */
class PinActions(
    val press: () -> Unit = {},
    val confirm: () -> Unit = {},
    val close: () -> Unit = {},
    val openPage: (String) -> Unit = {},
)

/** The screen's one verb pinned above the bar (web PinnedVerb.svelte): full width, raised over the page,
 * the line under it; while the move is open its confirmation stands in the verb's place, so one verb
 * shows. */
@Composable
fun Pin(
    pin: StartPin,
    actions: PinActions,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Surface(color = c.bg, shadowElevation = PIN_SHADOW, modifier = modifier.fillMaxWidth()) {
        Column(
            Modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
        ) {
            val panel = pin.panel
            if (panel != null) {
                MovePanelView(panel, Words.Move.title, MovePanelActions(actions.confirm, actions.close, actions.openPage))
            } else {
                pin.verb?.let { Verb(it, enabled = pin.enabled, onClick = actions.press) }
                pin.foot.forEach { FootLine(it, actions.openPage) }
            }
        }
    }
}
