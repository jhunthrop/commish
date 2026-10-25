package app.trycommish.feature.boxscore

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb

private val PANEL_EDGE = 4.dp

/** What a move panel's controls do: the verb that makes the move, the way out, a page opened. */
class MovePanelActions(
    val confirm: () -> Unit = {},
    val close: () -> Unit = {},
    val openPage: (String) -> Unit = {},
)

/** A line under the verb: its words, a run that opens a page underlined in the ink. */
@Composable
fun FootLine(
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
 * it and a way out (a claim's bid field between them, where the league bids); then what it came to, the
 * platform's reason under a refusal in its own words, the platform's page where the member should look;
 * a failure on the loss's edge. The Start screen's lineup move and the Waivers claim. */
@Composable
fun MovePanelView(
    panel: MovePanel,
    title: String,
    actions: MovePanelActions,
    field: @Composable () -> Unit = {},
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
            .clip(shape)
            .background(c.surface)
            .edgeRule(if (panel.tone == MovePanel.Tone.Problem) c.lossInk else c.accent, PANEL_EDGE)
            .border(1.dp, c.line, shape)
            .semantics { contentDescription = title },
    ) {
        Column(
            Modifier.padding(Tokens.Space.s4.dp).padding(start = PANEL_EDGE),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
        ) {
            Text(
                panel.line,
                style = Faces.body.copy(fontWeight = if (panel.tone == MovePanel.Tone.Quiet) FontWeight.Normal else FontWeight.SemiBold),
                color = ink,
            )
            panel.said?.let { Text(it, style = Faces.small, color = c.ink2) }
            field()
            Controls(panel, actions)
        }
    }
}

@Composable
private fun Controls(
    panel: MovePanel,
    actions: MovePanelActions,
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
