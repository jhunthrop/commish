package app.trycommish.feature.trades

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.trades.CopiedLine
import app.trycommish.core.trades.StripCard
import app.trycommish.core.trades.Tone
import app.trycommish.core.trades.TradesStrip
import app.trycommish.core.trades.TradesWords
import app.trycommish.design.Avatar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.edgeRule

private val EDGE = 4.dp
private const val TRACKING = 0.08
private const val DISABLED_ALPHA = 0.4f

/** The Trades' decision as a strip (TradeStrip.svelte at 390): the week and how many trades are worth
 * proposing (the platform's reason left to the desk, as TradeStrip hides it under 760 px), then each card
 * with the other team, both sides, both gains, the need it fills, its week, the drop, and its verb: the
 * first card's solid and marked Best, every other card's the same words quiet. The stamp of a saved read
 * under the title. */
@Composable
internal fun TradeStripView(
    strip: TradesStrip,
    verb: String,
    enabled: Boolean,
    stamp: String?,
    copied: Map<String, CopiedLine>,
    page: String?,
    press: (String) -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .edgeRule(c.accent, EDGE)
            .border(1.dp, c.line, shape)
            .padding(Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                strip.week.uppercase(),
                style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = TRACKING.em),
                color = c.accentText,
            )
            Text(strip.title.uppercase(), style = Faces.figure, color = c.ink, modifier = Modifier.semantics { heading() })
            stamp?.let { StampText(it) }
        }
        strip.cards.forEach { card -> TradeCard(card, verb, enabled, copied[card.key], page) { press(card.key) } }
    }
}

/** One card: "Best", the team's face and "with Max_Jensen10", "Rodgers for Skattebo and Strong", "+5.7 a
 * week for your lineup, +0.7 for theirs", the need, the week, the drop, the verb and its line. */
@Composable
private fun TradeCard(
    card: StripCard,
    verb: String,
    enabled: Boolean,
    copied: CopiedLine?,
    page: String?,
    press: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.bg)
            .border(1.dp, c.line, shape)
            .padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            card.mark?.let {
                Text(
                    it.uppercase(),
                    style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = TRACKING.em),
                    color = c.accentText,
                )
            }
            Avatar(card.initials, 24.dp)
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = c.ink2)) { append("${TradesWords.WITH} ") }
                    withStyle(SpanStyle(color = c.ink, fontWeight = FontWeight.Bold)) { append(card.team) }
                },
                style = Faces.small,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(card.give) }
                append(" ${TradesWords.FOR} ")
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(card.get) }
            },
            style = Faces.body,
            color = c.ink,
        )
        Text(
            buildAnnotatedString {
                val figure = Faces.number(NumWeight.Bold).toSpanStyle()
                withStyle(figure.copy(color = c.gainInk)) { append(card.mine) }
                append(" ${Words.Trades.aWeekForYou}, ")
                withStyle(figure.copy(color = c.ink)) { append(card.theirs) }
                append(" ${Words.Trades.forTheirs}")
            },
            style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
            color = c.ink,
        )
        card.lines.forEach { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2) }
        Column(Modifier.padding(top = Tokens.Space.s1.dp)) {
            if (card.lead) {
                Verb(verb, enabled = enabled, onClick = press)
            } else {
                OutlinedQuiet(verb, press, Modifier.fillMaxWidth(), enabled)
            }
        }
        copied?.let { CopiedText(it, page) }
    }
}

/** A quiet verb in a box of the strong line, the web's quiet button on a surface. */
@Composable
internal fun OutlinedQuiet(
    title: String,
    press: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    fill: Color = Color.Transparent,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    QuietButton(
        title,
        modifier
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .clip(shape)
            .background(fill)
            .border(1.dp, c.lineStrong, shape)
            .padding(horizontal = Tokens.Space.s2.dp),
        onClick = { if (enabled) press() },
    )
}

/** A figure's ink by its tone: a gain's, a loss's, or the plain ink. */
@Composable
internal fun toneInk(
    tone: Tone,
    gain: Color = CommishTheme.colors.gainInk,
    even: Color = CommishTheme.colors.ink,
): Color =
    when (tone) {
        Tone.Gain -> gain
        Tone.Loss -> CommishTheme.colors.lossInk
        Tone.Even -> even
    }
