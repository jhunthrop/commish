package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
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
import app.trycommish.core.trades.BuilderBox
import app.trycommish.core.trades.BuilderPinWords
import app.trycommish.core.trades.CopiedLine
import app.trycommish.core.trades.PickSide
import app.trycommish.core.trades.Tone
import app.trycommish.core.trades.TradeBugSide
import app.trycommish.core.trades.TradeBuilderModel
import app.trycommish.core.trades.TradeRest
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
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.HeadRow
import app.trycommish.feature.boxscore.PickRow
import app.trycommish.feature.boxscore.RowActions
import app.trycommish.feature.boxscore.TableFrame
import app.trycommish.feature.boxscore.edgeRule

private val EDGE = 4.dp
private val PIN_SHADOW = 8.dp
private const val CHECKING_ALPHA = 0.6f

/** The builder as a phone draws it (TradeBuilder.svelte at 390): Build a trade with the team chosen by
 * name and record and Not now; the scoreboard of each side before and after; the answer line, quiet while
 * it is the prompt, with the close call's chip; the builder's own line; then the member's roster and
 * theirs as box scores with a tick on every row, two a side at most. The gains and the verb are pinned
 * above the bar by the screen (BuilderPin), as the web pins them. */
@Composable
internal fun TradeBuilderView(
    builder: TradeBuilderModel,
    checking: Boolean,
    actions: TradeActions,
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
            .semantics { contentDescription = Words.Builder.open }
            .padding(Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        BuilderBoard(builder, checking, actions)
        BuilderBoxView(builder.yours, PickSide.Give, actions)
        builder.theirs?.let { BuilderBoxView(it, PickSide.Get, actions) }
    }
}

/** The builder's head (Build a trade, Not now, the team), its scoreboard, the answer line with the close
 * call's chip, and its own line. */
@Composable
internal fun BuilderBoard(
    builder: TradeBuilderModel,
    checking: Boolean,
    actions: TradeActions,
) {
    val c = CommishTheme.colors
    val fade = Modifier.alpha(if (checking) CHECKING_ALPHA else 1f)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(Words.Builder.open.uppercase(), style = Faces.figure, color = c.ink, modifier = Modifier.semantics { heading() })
                Spacer(Modifier.weight(1f))
                QuietButton(Words.Builder.notNow, onClick = actions.builder.close)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                Text(Words.Builder.team, style = Faces.small, color = c.ink2)
                val chosen = builder.teams.firstOrNull { it.id == builder.team }
                ChoiceField(
                    label = Words.Builder.team,
                    value = chosen?.choice.orEmpty(),
                    chosen = chosen?.id?.toString(),
                    groups = listOf(ChoiceGroup(null, builder.teams.map { Choice(it.id.toString(), it.choice) })),
                    modifier = Modifier.weight(1f),
                ) { key -> key.toIntOrNull()?.let(actions.builder.team) }
            }
        }
        TradeBugView(builder, fade)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(
                builder.sentence,
                style = Faces.small.copy(fontWeight = if (builder.quiet) FontWeight.Normal else FontWeight.SemiBold),
                color = if (builder.quiet) c.ink2 else c.ink,
                modifier = Modifier.weight(1f, fill = false).then(fade),
            )
            builder.close?.let { Pill(it) }
        }
        BasisText(builder.own)
    }
}

/** The builder's scoreboard on the lit board as a phone stacks it (TradeBug.svelte under 760 px): the
 * member's half over theirs, each with You or With and the team, this week's Proj and the rest-of-season
 * Gain each before, after and its change; the room and the verb left to the builder's line and its pin,
 * as the web's phone leaves them. */
@Composable
private fun TradeBugView(
    builder: TradeBuilderModel,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.scoreboard)
            .semantics(mergeDescendants = true) {},
    ) {
        BugHalf(builder.bug.yours)
        HorizontalDivider(color = c.scoreboardLine)
        BugHalf(builder.bug.theirs)
    }
}

@Composable
private fun BugHalf(side: TradeBugSide) {
    val c = CommishTheme.colors
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Avatar(side.initials, 26.dp, mine = side.mine, board = true)
            Column {
                BoardLabel(side.label)
                Text(
                    side.name,
                    style = Faces.small.copy(fontWeight = FontWeight.Bold),
                    color = c.scoreboardInk,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        val f = side.figures
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
            Swing(Words.Trades.weekHead, f.projBefore, f.projAfter, f.projChange, f.projTone)
            Swing(Words.Trades.gainHead, f.seasonBefore, f.seasonAfter, f.seasonChange, f.seasonTone)
            if (side.rest.text.isNotEmpty()) Rest(side.rest)
        }
    }
}

/** "THIS WEEK, PROJ" over "98.9 to 109.0 +10.1": before quiet, after strong, the change in its ink. */
@Composable
private fun Swing(
    head: String,
    before: String,
    after: String,
    change: String,
    tone: Tone,
) {
    val c = CommishTheme.colors
    val ink =
        if (tone == Tone.Gain) {
            c.scoreboardNum
        } else if (tone == Tone.Loss) {
            c.lossInk
        } else {
            c.scoreboardInk
        }
    Column {
        BoardLabel(head)
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = c.scoreboardInk2)) { append(before) }
                withStyle(
                    Faces.label
                        .copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp)
                        .toSpanStyle()
                        .copy(color = c.scoreboardInk2),
                ) {
                    append(" ${Words.Trades.to} ")
                }
                withStyle(Faces.number(NumWeight.Bold).toSpanStyle().copy(color = c.scoreboardInk)) { append(after) }
                withStyle(Faces.number(NumWeight.Bold).toSpanStyle().copy(color = ink)) { append(" $change") }
            },
            style = Faces.number(NumWeight.Medium),
            maxLines = 1,
        )
    }
}

/** "REST OF SEASON" over "−14.4" in its ink (TradeBug.svelte's phone cell, Lane 277); who would not
 * take it is the builder's line and its pin, as the web's phone says it. */
@Composable
private fun Rest(rest: TradeRest) {
    val c = CommishTheme.colors
    val ink =
        when (rest.tone) {
            Tone.Gain -> c.scoreboardNum
            Tone.Loss -> c.lossInk
            Tone.Even -> c.scoreboardInk
        }
    Column {
        BoardLabel(Words.Trades.restHead)
        Text(rest.text, style = Faces.number(NumWeight.Bold), color = ink, maxLines = 1)
    }
}

@Composable
private fun BoardLabel(words: String) {
    Text(
        words.uppercase(),
        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
        color = CommishTheme.colors.scoreboardInk2,
        maxLines = 1,
    )
}

/** One roster of the builder (TradeBox.svelte at 390): the team with its face, You on the member's, its
 * record, what the side holds, the heads, and its rows with their ticks. */
@Composable
internal fun BuilderBoxView(
    box: BuilderBox,
    side: PickSide,
    actions: TradeActions,
) {
    val c = CommishTheme.colors
    val rule = if (box.mine) c.accent else c.lineStrong
    TableFrame {
        Column(
            Modifier
                .fillMaxWidth()
                .background(c.bg)
                .drawBehind {
                    val width = 2.dp.toPx()
                    drawLine(rule, Offset(0f, size.height - width / 2), Offset(size.width, size.height - width / 2), width)
                }.padding(Tokens.Space.s3.dp)
                .semantics(mergeDescendants = true) { contentDescription = box.team },
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                Avatar(box.initials, 30.dp, mine = box.mine)
                Text(
                    box.team,
                    style = Faces.body.copy(fontWeight = FontWeight.Bold),
                    color = c.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (box.mine) {
                    Text(Words.Box.you.uppercase(), style = Faces.label.copy(fontWeight = FontWeight.Bold), color = c.accentText)
                }
                if (box.aside.isNotEmpty()) {
                    Text(box.aside, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink3, maxLines = 1)
                }
            }
            Text(box.holds, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink2)
        }
        HeadRow(BoxStyle.Trade)
        box.rows.forEach { row ->
            PickRow(row.cells, row.line, row.tick, RowActions(actions.open)) { actions.builder.tap(side, row.id) }
        }
    }
}

/** The builder's pin above the bar (TradeBuilder's .pin under 760 px), on the lit board: the two gains,
 * or the answer line before an answer; the verb; the line under it once pressed. */
@Composable
internal fun BuilderPin(
    builder: TradeBuilderModel,
    verb: String,
    page: String?,
    copied: CopiedLine?,
    press: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Surface(color = c.scoreboard, shadowElevation = PIN_SHADOW, modifier = modifier.fillMaxWidth()) {
        Column(
            Modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                PinGains(builder.pin, Modifier.weight(1f))
                Button(
                    onClick = press,
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
            copied?.let { CopiedText(it, page, onBoard = true) }
        }
    }
}

@Composable
private fun PinGains(
    pin: BuilderPinWords,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    when (pin) {
        is BuilderPinWords.Gains ->
            Text(
                buildAnnotatedString {
                    withStyle(Faces.number(NumWeight.Bold).toSpanStyle().copy(color = c.scoreboardNum)) { append(pin.mine) }
                    append(" ${pin.rest}")
                },
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                color = c.scoreboardInk,
                modifier = modifier,
            )
        is BuilderPinWords.Said ->
            Text(
                pin.words,
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                color = c.scoreboardInk,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = modifier,
            )
    }
}
