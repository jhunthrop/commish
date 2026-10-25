package app.trycommish.feature.start

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.start.FootRun
import app.trycommish.core.start.MovePanel
import app.trycommish.core.start.StartPin
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words

private val PANEL_EDGE = 4.dp
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
                MovePanelView(panel, actions)
            } else {
                pin.verb?.let { Verb(it, enabled = pin.enabled, onClick = actions.press) }
                pin.foot.forEach { FootLine(it, actions.openPage) }
            }
        }
    }
}

/** A line under the verb: its words, a run that opens a page underlined in the ink. */
@Composable
private fun FootLine(
    runs: List<FootRun>,
    openPage: (String) -> Unit,
) {
    val c = CommishTheme.colors
    val said =
        buildAnnotatedString {
            runs.forEach { run ->
                val url = run.url
                if (url == null) {
                    withStyle(SpanStyle(color = c.ink2)) { append(run.text) }
                } else {
                    val style =
                        SpanStyle(
                            color = c.ink,
                            fontSize = Tokens.Type.sm.sp,
                            fontWeight = FontWeight.SemiBold,
                            textDecoration = TextDecoration.Underline,
                        )
                    withLink(LinkAnnotation.Clickable(url, TextLinkStyles(style)) { openPage(url) }) { append(run.text) }
                }
            }
        }
    Text(
        said,
        style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = Faces.small.letterSpacing),
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The move's confirmation (web MovePanel.svelte): the move in the API's words with the verb that makes
 * it and a way out; then what it came to, the platform's reason under a refusal in its own words, the
 * platform's page where the member should look; a failure on the loss's edge. */
@Composable
private fun MovePanelView(
    panel: MovePanel,
    actions: PinActions,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val ink =
        when (panel.tone) {
            MovePanel.Tone.Plain -> c.ink
            MovePanel.Tone.Quiet -> c.ink2
            MovePanel.Tone.Problem -> c.lossInk
        }
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.line, shape)
            .semantics { contentDescription = Words.Move.title },
    ) {
        Box(Modifier.width(PANEL_EDGE).fillMaxHeight().background(if (panel.tone == MovePanel.Tone.Problem) c.lossInk else c.accent))
        Column(Modifier.padding(Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            Text(
                panel.line,
                style = Faces.body.copy(fontWeight = if (panel.tone == MovePanel.Tone.Quiet) FontWeight.Normal else FontWeight.SemiBold),
                color = ink,
            )
            panel.said?.let { Text(it, style = Faces.small, color = c.ink2) }
            Controls(panel, actions)
        }
    }
}

@Composable
private fun Controls(
    panel: MovePanel,
    actions: PinActions,
) {
    panel.verb?.let { Verb(it, enabled = panel.verbEnabled, onClick = actions.confirm) }
    val page = panel.page
    val url = page?.url
    if (page != null && url != null && panel.pageSolid) Verb(page.text) { actions.openPage(url) }
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        if (page != null && url != null && !panel.pageSolid) QuietButton(page.text) { actions.openPage(url) }
        panel.close?.let { QuietButton(it, onClick = actions.close) }
    }
}
