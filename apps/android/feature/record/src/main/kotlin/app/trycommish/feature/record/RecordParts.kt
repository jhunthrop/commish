package app.trycommish.feature.record

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.record.FigurePair
import app.trycommish.core.record.RecordBug
import app.trycommish.core.record.RecordCell
import app.trycommish.core.record.RecordTile
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.FitText
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.Hairline

/** The record table's columns at 390: the week (or the position) takes the rest, each order a figure. */
internal val FIGURE_WIDTH = 64.dp
private val RULE = 2.dp

/** A record's head (record.css .rec-head): its name in the number face over what it grades, ruled off. */
@Composable
internal fun RecordHeadView(
    title: String,
    what: String,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        Text(title.uppercase(), style = Faces.head, color = c.ink, modifier = Modifier.semantics { heading() })
        Text(what, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink2)
        Spacer(Modifier.height(Tokens.Space.s1.dp))
        Spacer(Modifier.fillMaxWidth().height(RULE).background(c.ink))
    }
}

/** A card on the surface with the hairline and the corners (the bug, the draft's bug). */
@Composable
internal fun Card(content: @Composable ColumnScope.() -> Unit) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.line, shape)
            .padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
        content = content,
    )
}

/** One figure for ours and a yardstick at one size, the leader named under them (PairTile.svelte): ours
 * accented only where it leads. */
@Composable
internal fun PairTileView(
    label: String?,
    key: String?,
    pair: FigurePair,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        label?.let { TileLabel(it) }
        key?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3) }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
            PairFigure(Words.Pair.ours, pair.ours, pair.accented)
            PairFigure(pair.name, pair.theirs, lit = false)
            Spacer(Modifier.weight(1f))
            pair.lead?.let {
                Text(
                    it,
                    style = Faces.label.copy(letterSpacing = 0.sp),
                    color = c.ink2,
                    modifier = Modifier.padding(bottom = Tokens.Space.s1.dp),
                )
            }
        }
    }
}

@Composable
private fun PairFigure(
    name: String,
    value: String,
    lit: Boolean,
) {
    val c = CommishTheme.colors
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        Text(name, style = Faces.label.copy(letterSpacing = 0.sp), color = c.ink3, modifier = Modifier.padding(bottom = Tokens.Space.s1.dp))
        Text(value, style = Faces.figure, color = if (lit) c.accentText else c.ink, maxLines = 1)
    }
}

/** A tile's label: uppercase, tracked, the third ink. */
@Composable
internal fun TileLabel(text: String) {
    Text(
        text.uppercase(),
        style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = HEAD_TRACKING.em),
        color = CommishTheme.colors.ink3,
    )
}

/** The bug over the weeks (WeeklySection.svelte's .bug at 390): the standing and the order or span, each
 * figure's tile, the gaps and the honest sentence; before a week is graded the week and when it grades;
 * or the headline's one figure and its sentence. */
@Composable
internal fun RecordBugView(bug: RecordBug) {
    val c = CommishTheme.colors
    Card {
        when (bug) {
            is RecordBug.Tiles -> {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    bug.standing?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink2) }
                    Text(bug.head, style = Faces.number(NumWeight.Bold, Tokens.Type.lg.sp), color = c.ink)
                }
                bug.tiles.forEach { TileView(it) }
                Said(bug.gaps)
                Said(bug.honest)
            }
            is RecordBug.Pending -> {
                Text(bug.title, style = Faces.number(NumWeight.Bold, Tokens.Type.lg.sp), color = c.ink)
                Text(bug.whenSaid, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink2)
                Said(bug.gaps)
            }
            is RecordBug.Headline -> {
                Text(bug.value, style = Faces.number(NumWeight.Bold, Tokens.Type.display.sp), color = c.ink)
                Said(bug.caption)
                Said(bug.gaps)
            }
        }
    }
}

@Composable
private fun TileView(tile: RecordTile) {
    val c = CommishTheme.colors
    val pairs = tile.pairs
    if (pairs != null) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
            pairs.forEachIndexed { index, pair -> PairTileView(if (index == 0) tile.label else null, null, pair) }
        }
        return
    }
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        TileLabel(tile.label)
        Spacer(Modifier.weight(1f))
        Text(tile.ours.orEmpty(), style = Faces.figure, color = c.ink)
        tile.beside.forEach { beside ->
            Text(
                listOfNotNull(beside.head, beside.value, beside.ours).joinToString(" "),
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                color = c.ink2,
            )
        }
    }
}

/** A sentence in the bug, none when empty. */
@Composable
private fun Said(text: String?) {
    if (text.isNullOrEmpty()) return
    Text(text, style = Faces.small, color = CommishTheme.colors.ink2)
}

/** A table's head: the lead column's word and each order's. */
@Composable
internal fun RecordHeadRow(
    lead: String,
    heads: List<String>,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 32.dp)
            .background(CommishTheme.colors.bg)
            .padding(horizontal = Tokens.Space.s3.dp)
            .clearAndSetSemantics {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HeadText(lead, Modifier.weight(1f), TextAlign.Start)
        heads.forEach { HeadText(it, Modifier.width(FIGURE_WIDTH), TextAlign.End) }
    }
    Hairline()
}

@Composable
private fun HeadText(
    words: String,
    modifier: Modifier,
    align: TextAlign,
) {
    FitText(
        words.uppercase(),
        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
        color = CommishTheme.colors.ink3,
        textAlign = align,
        modifier = modifier,
    )
}

/** A figure cell: ours in the accent where it leads, ours over the same weeks beside a yardstick's. */
@Composable
internal fun RecordFigureView(
    cell: RecordCell,
    lit: Boolean,
) {
    val c = CommishTheme.colors
    Column(Modifier.width(FIGURE_WIDTH), horizontalAlignment = Alignment.End) {
        FitText(
            cell.value,
            style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp),
            color = if (lit) c.accentText else c.ink,
            textAlign = TextAlign.End,
        )
        cell.same?.let {
            FitText(
                it,
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                color = c.ink3,
                textAlign = TextAlign.End,
            )
        }
    }
}
