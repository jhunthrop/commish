package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.trades.BuilderPinWords
import app.trycommish.core.trades.CopiedLine
import app.trycommish.core.trades.PickSide
import app.trycommish.core.trades.TradeBuilderModel
import app.trycommish.design.Avatar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Pill
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.BoxStyle
import app.trycommish.feature.boxscore.HeadRow
import app.trycommish.feature.boxscore.PickRow
import app.trycommish.feature.boxscore.RowActions
import app.trycommish.feature.boxscore.TableFrame

private val PIN_SHADOW = 8.dp

/** What the side holds takes this, wrapping in it, so the team's name keeps the rest of the head. */
private val HOLDS_WIDTH = 84.dp
private const val CHECKING_ALPHA = 0.6f
private const val HELD_ALPHA = 0.5f

/** The roster the switch shows (TradeBox.svelte at 390): its head in one line (the member's team with its
 * face, You and what the side holds, or the team choice on theirs), the heads, and each row at the
 * Lineup's height with its tick, two a side at most. */
@Composable
internal fun BuilderBoxView(
    builder: TradeBuilderModel,
    side: PickSide,
    actions: TradeActions,
) {
    val c = CommishTheme.colors
    val box = if (side == PickSide.Give) builder.yours else builder.theirs
    val rule = if (box.mine) c.accent else c.lineStrong
    TableFrame {
        Row(
            Modifier
                .fillMaxWidth()
                .background(c.bg)
                .drawBehind {
                    val width = 2.dp.toPx()
                    drawLine(rule, Offset(0f, size.height - width / 2), Offset(size.width, size.height - width / 2), width)
                }.padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp)
                .semantics { contentDescription = box.team.ifEmpty { Words.Builder.team } },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            if (box.mine) {
                Avatar(box.initials, 22.dp, mine = true)
                // The team whole: a long name wraps to a second line, never cut; You follows it.
                Row(
                    Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                ) {
                    Text(
                        box.team,
                        style = Faces.small.copy(fontWeight = FontWeight.Bold),
                        color = c.ink,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Text(
                        Words.Box.you.uppercase(),
                        style = Faces.label.copy(fontWeight = FontWeight.Bold),
                        color = c.accentText,
                        softWrap = false,
                    )
                }
            } else {
                // The team takes the room what the side holds leaves it, which is two short lines at most.
                ChoiceField(
                    label = Words.Builder.team,
                    value = builder.teamLabel,
                    chosen = builder.team?.toString(),
                    groups = listOf(ChoiceGroup(null, builder.teams.map { Choice(it.id.toString(), it.choice) })),
                    modifier = Modifier.weight(1f),
                ) { key -> key.toIntOrNull()?.let(actions.team) }
            }
            Text(
                box.holds,
                style = Faces.label.copy(letterSpacing = 0.sp),
                color = c.ink2,
                textAlign = TextAlign.End,
                modifier = Modifier.width(HOLDS_WIDTH),
            )
        }
        if (box.rows.isNotEmpty()) HeadRow(BoxStyle.Trade)
        box.rows.forEach { row ->
            PickRow(row.cells, row.tick, RowActions(actions.open)) { actions.tap(side, row.id) }
        }
    }
}

/** The verdict under the rosters (TradeBuilder's .verdict at 390): one box-score row per side, read again
 * on every tick, the answer line under it with the close call's chip, then the platform's line and the
 * builder's own. */
@Composable
internal fun VerdictView(
    builder: TradeBuilderModel,
    checking: Boolean,
) {
    val c = CommishTheme.colors
    val fade = Modifier.alpha(if (checking) CHECKING_ALPHA else 1f)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        TradeBugView(builder.bug, fade)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(
                builder.sentence,
                style = Faces.small.copy(fontWeight = if (builder.quiet) FontWeight.Normal else FontWeight.Medium),
                color = if (builder.quiet) c.ink2 else c.ink,
                modifier = Modifier.weight(1f, fill = false).then(fade),
            )
            builder.close?.let { Pill(it) }
        }
        builder.hostLine?.let { BasisText(it) }
        BasisText(builder.own)
    }
}

/** The pin above the bar (TradeBuilder's .pin under 1180 px): why a side would not take it, or the two
 * gains, or the answer line; Share and the verb; the line under them once pressed. */
@Composable
internal fun BuilderPin(
    builder: TradeBuilderModel,
    verb: String,
    page: String?,
    checking: Boolean,
    copied: CopiedLine?,
    shared: String?,
    actions: TradeActions,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Surface(color = c.surface, shadowElevation = PIN_SHADOW, modifier = modifier.fillMaxWidth()) {
        Column {
            HorizontalDivider(color = c.lineStrong)
            Column(
                Modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                    PinGains(builder.pin, Modifier.weight(1f).alpha(if (checking) CHECKING_ALPHA else 1f))
                    QuietButton(
                        Words.Analyzer.share,
                        Modifier.alpha(if (builder.live) 1f else HELD_ALPHA),
                        enabled = builder.live,
                        onClick = actions.share,
                    )
                    Button(
                        onClick = actions.press,
                        enabled = builder.verbEnabled,
                        shape = RoundedCornerShape(Tokens.Radius.md.dp),
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor = c.accent,
                                contentColor = c.accentInk,
                                disabledContainerColor = c.surface2,
                                disabledContentColor = c.ink3,
                            ),
                        modifier = Modifier.heightIn(min = 40.dp),
                    ) { Text(verb, style = Faces.small.copy(fontWeight = FontWeight.Bold)) }
                }
                shared?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2) }
                copied?.let { CopiedText(it, page) }
            }
        }
    }
}

@Composable
private fun PinGains(
    pin: BuilderPinWords,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val words = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp)
    when (pin) {
        is BuilderPinWords.Gains ->
            Text(
                buildAnnotatedString {
                    withStyle(Faces.number(NumWeight.Bold, Tokens.Type.md.sp).toSpanStyle().copy(color = c.gainInk)) { append(pin.mine) }
                    append(" ${pin.rest}")
                },
                style = words,
                color = c.ink2,
                modifier = modifier,
            )
        is BuilderPinWords.Said -> Text(pin.words, style = words, color = c.ink2, modifier = modifier)
    }
}
