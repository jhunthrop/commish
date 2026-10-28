package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.trades.CopiedLine
import app.trycommish.core.trades.GainCell
import app.trycommish.core.trades.NoIdeaLine
import app.trycommish.core.trades.TradeLine
import app.trycommish.core.trades.TradeSort
import app.trycommish.core.trades.TradesModel
import app.trycommish.core.trades.TradesUi
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.QuietButton
import app.trycommish.design.R
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.BoxRow
import app.trycommish.feature.boxscore.BoxStyle
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.Hairline
import app.trycommish.feature.boxscore.HeadRow
import app.trycommish.feature.boxscore.RowActions
import app.trycommish.feature.boxscore.SectionRow
import app.trycommish.feature.boxscore.TableFrame

private const val SORTED_TINT = 0.6f
private const val OPEN_TURN = 180f

/** The finder's phone columns: the chevron that opens a trade, and each gain. */
private object FinderColumn {
    val open = 36.dp
    val gain = 62.dp
}

/** The finder as a phone draws it (TradeFinder.svelte at 390): the heads, You give over the deal and the
 * two gains that sort it, the line under them saying what a Gain is, then one trade a row; a tap opens
 * the trade under its row. */
@Composable
internal fun TradeFinderView(
    model: TradesModel,
    ui: TradesUi,
    actions: TradeActions,
) {
    TableFrame {
        FinderHead(model.gainBasis, ui.sort, actions.sort)
        model.rows.forEach { line ->
            val open = line.key in ui.opened
            FinderRow(line, open, ui.sort) { actions.toggle(line.key) }
            if (open) OpenedTrade(line, model, ui.copied[line.key], actions)
        }
        model.noIdeas.forEach { NoIdeaRow(it) }
    }
}

/** A team the finder lists no trade with (B271): "With Carried by QJs", then "No idea they would
 * take.", quiet, nothing to open. */
@Composable
private fun NoIdeaRow(line: NoIdeaLine) {
    val c = CommishTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(start = FinderColumn.open + Tokens.Space.s2.dp, end = Tokens.Space.s2.dp, top = 6.dp, bottom = 6.dp)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(line.with, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2)
        Text(line.note, style = Faces.body.copy(fontSize = Tokens.Type.sm.sp), color = c.ink2)
    }
    Hairline()
}

/** The heads: You give, then Your gain and Their gain, each a button that sorts by it, the sorted one with
 * its chevron; the line under them saying what a Gain is. */
@Composable
private fun FinderHead(
    gainBasis: String?,
    sort: TradeSort,
    choose: (TradeSort) -> Unit,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth().background(c.bg)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(horizontal = Tokens.Space.s2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Head(Words.Trades.give, Modifier.weight(1f).padding(start = FinderColumn.open))
            TradeSort.entries.forEach { order ->
                val lit = sort == order
                Row(
                    Modifier
                        .width(FinderColumn.gain)
                        .heightIn(min = 40.dp)
                        .clickable(role = Role.Button) { choose(order) }
                        .semantics {
                            contentDescription = "${Words.Trades.sortBy} ${order.head}"
                            selected = lit
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.End),
                ) {
                    Head(order.head, Modifier.weight(1f, fill = false), TextAlign.End)
                    if (lit) {
                        Icon(
                            painterResource(R.drawable.icon_chevron),
                            contentDescription = null,
                            tint = c.ink2,
                            modifier = Modifier.size(10.dp),
                        )
                    }
                }
            }
        }
        gainBasis?.let {
            Text(
                it,
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                color = c.ink3,
                modifier = Modifier.padding(start = Tokens.Space.s2.dp, end = Tokens.Space.s2.dp, bottom = 6.dp),
            )
        }
        Hairline()
    }
}

@Composable
private fun Head(
    words: String,
    modifier: Modifier,
    align: TextAlign = TextAlign.Start,
) {
    Text(
        words.uppercase(),
        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em, lineHeight = 12.sp),
        color = CommishTheme.colors.ink3,
        textAlign = align,
        modifier = modifier,
    )
}

/** One trade: the chevron, "Rodgers > Skattebo and Strong", "with Max_Jensen10, you drop Dart" and the
 * need it fills under it, then both gains, each in its ink, the sorted column on its tint. */
@Composable
internal fun FinderRow(
    line: TradeLine,
    open: Boolean,
    sort: TradeSort,
    toggle: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .background(if (open) c.surface2 else c.surface)
            .clickable(role = Role.Button, onClick = toggle)
            .semantics(mergeDescendants = true) {
                contentDescription = line.offer
                stateDescription = "${line.mine.words}, ${line.theirs.words}"
                selected = open
            }.padding(start = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(FinderColumn.open)) {
            Box(
                Modifier.size(width = 26.dp, height = 30.dp).clip(shape).border(1.dp, c.lineStrong, shape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(R.drawable.icon_chevron),
                    contentDescription = null,
                    tint = c.ink2,
                    modifier = Modifier.size(14.dp).rotate(if (open) OPEN_TURN else 0f),
                )
            }
        }
        Column(Modifier.weight(1f).padding(vertical = Tokens.Space.s2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = c.ink)) { append(line.give) }
                    withStyle(SpanStyle(color = c.ink3, fontWeight = FontWeight.Bold)) { append(" › ") }
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = c.accentText)) { append(line.get) }
                },
                style = Faces.small,
            )
            Text(line.with, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2)
            line.need?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2) }
        }
        GainFigure(line.mine, sort == TradeSort.Mine)
        GainFigure(line.theirs, sort == TradeSort.Theirs)
    }
    Hairline()
}

@Composable
private fun GainFigure(
    cell: GainCell,
    sorted: Boolean,
) {
    val c = CommishTheme.colors
    val ground = if (sorted) c.gainBg.copy(alpha = SORTED_TINT).compositeOver(c.surface) else c.surface.copy(alpha = 0f)
    Box(
        Modifier
            .width(FinderColumn.gain)
            .fillMaxHeight()
            .background(ground)
            .padding(end = Tokens.Space.s2.dp),
        contentAlignment = Alignment.CenterEnd,
    ) {
        Text(cell.words, style = Faces.number(NumWeight.Bold), color = toneInk(cell.tone), maxLines = 1)
    }
}

/** A trade opened (TradeFinder's opened row at 390): its week in one line and the drop's sentence; both
 * sides' players as box-score rows (Give and Drop from the member's roster, Get from theirs), each name
 * opening the player sheet; Build from this, which opens the builder with the trade and its check; the
 * verb and the line under it. */
@Composable
internal fun OpenedTrade(
    line: TradeLine,
    model: TradesModel,
    copied: CopiedLine?,
    actions: TradeActions,
) {
    val c = CommishTheme.colors
    Column(
        Modifier.fillMaxWidth().background(c.surface2).padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        line.opened.lines.forEach { Text(it, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink) }
        TableFrame {
            HeadRow(BoxStyle.Trade)
            line.opened.groups.forEach { group ->
                SectionRow(group.head)
                group.rows.forEach { cells -> BoxRow(cells, bench = false, actions = RowActions(actions.open), style = BoxStyle.Trade) }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (line.built != null) {
                    QuietButton(Words.Trades.fromThis) { actions.builder.from(line.key) }
                }
                Spacer(Modifier.weight(1f))
                OutlinedQuiet(model.verb, { actions.press(line.key) }, enabled = model.page != null, fill = c.surface)
            }
            when {
                copied != null -> CopiedText(copied, model.page)
                model.reason != null -> BasisText(model.reason.orEmpty())
            }
        }
    }
    Hairline()
}
