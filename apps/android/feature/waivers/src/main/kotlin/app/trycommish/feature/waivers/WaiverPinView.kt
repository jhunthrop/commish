package app.trycommish.feature.waivers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.waivers.BidField
import app.trycommish.core.waivers.WaiverPin
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.FootLine
import app.trycommish.feature.boxscore.MovePanelActions
import app.trycommish.feature.boxscore.MovePanelView

private val PIN_SHADOW = 8.dp
private val BID_WIDTH = 112.dp
private val BID_HEIGHT = 40.dp

/** What the pin's controls do: the verb, the claim's confirmation, the way out, a page opened, a bid
 * typed. */
class WaiverPinActions(
    val press: () -> Unit = {},
    val confirm: () -> Unit = {},
    val close: () -> Unit = {},
    val openPage: (String) -> Unit = {},
    val bid: (String) -> Unit = {},
)

/** The screen's one verb pinned above the bar (Screen.svelte's pin): the pair an open row's verb makes in
 * bold over it, the verb full width, the line under it; while the claim is open its confirmation (with
 * the bid field where the league bids) stands in the verb's place, so one verb shows. */
@Composable
fun WaiverPinView(
    pin: WaiverPin,
    actions: WaiverPinActions,
    modifier: Modifier = Modifier,
    /** Draws the bid at rest, its number as text (a snapshot). */
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    // Above the keyboard while the bid is typed: edge to edge, the window is not resized for it (review M2).
    Surface(color = c.bg, shadowElevation = PIN_SHADOW, modifier = modifier.fillMaxWidth().imePadding()) {
        Column(
            Modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
        ) {
            val panel = pin.panel
            if (panel != null) {
                MovePanelView(panel, Words.Move.claimTitle, MovePanelActions(actions.confirm, actions.close, actions.openPage)) {
                    pin.bid?.let { BidFieldView(it, actions.bid, still) }
                }
            } else {
                pin.pair?.let {
                    Text(
                        it,
                        style = Faces.small.copy(fontWeight = FontWeight.Bold),
                        color = c.ink,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                pin.verb?.let { Verb(it, enabled = pin.enabled, onClick = actions.press) }
                pin.foot.forEach { FootLine(it, actions.openPage) }
            }
        }
    }
}

/** The claim's bid (MovePanel.svelte's bid field): its label naming the number's basis, the bid as typed
 * in waiver dollars on the number keyboard (Done puts it away), and what the league does not take in the
 * platform's terms. We never suggest a bid. */
@Composable
private fun BidFieldView(
    field: BidField,
    change: (String) -> Unit,
    still: Boolean,
) {
    val c = CommishTheme.colors
    val focus = LocalFocusManager.current
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    val number = Faces.cell.copy(fontSize = Tokens.Type.lg.sp, fontWeight = FontWeight.Medium, color = c.ink)
    val frame =
        Modifier
            .size(BID_WIDTH, BID_HEIGHT)
            .background(c.surface, shape)
            .border(1.dp, c.lineStrong, shape)
            .padding(horizontal = Tokens.Space.s2.dp, vertical = Tokens.Space.s2.dp)
            .semantics { contentDescription = field.label }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Text(field.label, style = Faces.small, color = c.ink2)
        if (still) Text(field.typed, style = number, modifier = frame)
        if (!still) {
            BasicTextField(
                value = field.typed,
                onValueChange = change,
                enabled = field.editable,
                singleLine = true,
                textStyle = number,
                cursorBrush = SolidColor(c.accent),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
                modifier = frame,
            )
        }
        field.problem?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.lossInk) }
    }
}
