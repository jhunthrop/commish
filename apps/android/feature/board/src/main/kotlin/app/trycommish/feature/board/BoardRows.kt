package app.trycommish.feature.board

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.trycommish.core.board.BoardColumns
import app.trycommish.core.board.BoardRow
import app.trycommish.core.board.GapTone
import app.trycommish.core.board.Heat
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.Avatar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.PositionPill
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.design.resolve

/** The phone's column widths (board-columns.ts, the phone band): his face, the player taking the rest,
 * then the view's figures. */
private object Widths {
    val face = 32.dp
    val projected = 62.dp
    val overReplacement = 58.dp
    val gap = 44.dp
    val draftOrder = 64.dp
    val adp = 56.dp

    fun of(columns: BoardColumns): List<Dp> =
        when (columns) {
            is BoardColumns.Ranked -> listOfNotNull(projected, overReplacement, gap.takeIf { columns.gap })
            BoardColumns.DraftOrder -> listOf(draftOrder, adp)
        }
}

private val GAP = 6.dp
private val ROW_HEIGHT = 52.dp
private val HEAD_HEIGHT = 34.dp
private val SECTION_HEAD_HEIGHT = 32.dp
private val TINT_HEIGHT = 26.dp

/** The column heads, said once over the rows: Player, then the view's figures. */
@Composable
internal fun BoardHeadRow(columns: BoardColumns) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth().background(c.bg)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = HEAD_HEIGHT).padding(horizontal = Tokens.Space.s2.dp),
            horizontalArrangement = Arrangement.spacedBy(GAP),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Head(Words.Box.player, Modifier.weight(1f), TextAlign.Start)
            columns.heads.zip(Widths.of(columns)).forEach { (words, width) -> Head(words, Modifier.width(width), TextAlign.End) }
        }
        HorizontalDivider(color = c.line)
    }
}

@Composable
private fun Head(
    words: String,
    modifier: Modifier,
    align: TextAlign,
) {
    // A one-word head ("Projected") keeps its line, reaching left past its column as the iOS head scales
    // to fit; two words ("Over repl") take two lines in it.
    val oneWord = ' ' !in words
    val reach = if (oneWord) Modifier.wrapContentWidth(Alignment.End, unbounded = true) else Modifier
    Box(modifier, contentAlignment = Alignment.CenterEnd) {
        Text(
            words.uppercase(),
            style = Faces.label,
            color = CommishTheme.colors.ink3,
            maxLines = if (oneWord) 1 else 2,
            softWrap = !oneWord,
            textAlign = align,
            modifier = if (align == TextAlign.Start) Modifier.fillMaxWidth() else reach,
        )
    }
}

/** A head inside the table over a run of rows: a position's players on a season-long list. */
@Composable
internal fun BoardSectionHead(title: String) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth().background(c.bg).semantics { heading() }) {
        Text(
            title.uppercase(),
            style = Faces.label.copy(fontWeight = FontWeight.Bold),
            color = c.ink3,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = SECTION_HEAD_HEIGHT)
                    .padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        )
        HorizontalDivider(color = c.line)
    }
}

/**
 * One player's row (web Row.svelte at 390, the iOS BoardRowView's twin): his face, his name the biggest
 * thing, his position pill with his number there, his club and bye, his status chip; then Projected,
 * the row's one big figure, Over repl on its round's tint and the Gap in its tone, or a kicker's or a
 * defense's draft order and ADP. The whole row opens the player sheet where the site has a page for him.
 */
@Composable
internal fun BoardRowView(
    row: BoardRow,
    columns: BoardColumns,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    val tap = row.sheetPlayer?.let { player -> Modifier.clickable { open(player) } } ?: Modifier
    Column(Modifier.fillMaxWidth().background(c.surface).then(tap)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = ROW_HEIGHT).padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(GAP),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(row.initials, Widths.face)
            Who(row, Modifier.weight(1f))
            Figures(row, columns)
        }
        HorizontalDivider(color = c.line)
    }
}

@Composable
private fun Who(
    row: BoardRow,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(row.name, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = c.ink, maxLines = 2)
        Row(horizontalArrangement = Arrangement.spacedBy(GAP), verticalAlignment = Alignment.CenterVertically) {
            PositionPill(row.pill)
            Small(row.club)
            row.bye?.let { Small(it) }
        }
        row.status?.let { Pill(it.mark, if (it.sits) PillTone.Loss else PillTone.Plain) }
    }
}

@Composable
private fun Small(text: String) {
    Text(text.uppercase(), style = Faces.label, color = CommishTheme.colors.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun Figures(
    row: BoardRow,
    columns: BoardColumns,
) {
    val c = CommishTheme.colors
    when (columns) {
        is BoardColumns.Ranked -> {
            Figure(row.projected, Widths.projected, c.ink, BIG_NUMBER)
            // The round's tint, reaching a gap's width past the cell's left edge (Row.svelte .heat-*).
            val tile = tint(row.heat)
            Figure(row.overReplacement, Widths.overReplacement, c.ink2, modifier = tile?.let { Modifier.tile(it) } ?: Modifier)
            if (columns.gap) Figure(row.gap, Widths.gap, gapInk(row.gapTone))
        }
        BoardColumns.DraftOrder -> {
            Figure(row.draftOrder, Widths.draftOrder, c.ink)
            Figure(row.adp, Widths.adp, c.ink2)
        }
    }
}

@Composable
private fun Figure(
    text: String,
    width: Dp,
    ink: Color,
    style: TextStyle = Faces.cell,
    modifier: Modifier = Modifier,
) {
    val color = if (text == Words.Box.none) CommishTheme.colors.ink3 else ink
    Text(text, style = style, color = color, maxLines = 1, textAlign = TextAlign.End, modifier = modifier.width(width))
}

/** The tint's tile behind a figure: the row's tint height, from a gap left of the cell to its end. */
private fun Modifier.tile(color: Color): Modifier =
    drawBehind {
        val reach = GAP.toPx()
        val height = TINT_HEIGHT.toPx()
        drawRoundRect(
            color = color,
            topLeft = Offset(-reach, (size.height - height) / 2),
            size = Size(size.width + reach, height),
            cornerRadius =
                CornerRadius(
                    Tokens.Radius.sm.dp
                        .toPx(),
                ),
        )
    }

/** The tile under Over repl (Row.svelte .heat-1 to .heat-4, .heat-neg), none past the fourth round. */
@Composable
private fun tint(heat: Heat): Color? {
    val dark = CommishTheme.colors.dark
    val token =
        when (heat) {
            Heat.Below -> Tokens.Color.heatNeg
            is Heat.Round ->
                when (heat.round) {
                    1 -> Tokens.Color.heat1
                    2 -> Tokens.Color.heat2
                    3 -> Tokens.Color.heat3
                    4 -> Tokens.Color.heat4
                    else -> null
                }
            Heat.None -> null
        }
    return token?.resolve(dark)
}

/** The Gap's tone (gap-picks.ts): plus green, minus rose, zero neither. */
@Composable
private fun gapInk(tone: GapTone?): Color =
    when (tone) {
        GapTone.Gain -> CommishTheme.colors.gainInk
        GapTone.Loss -> CommishTheme.colors.lossInk
        GapTone.Even, null -> CommishTheme.colors.ink2
    }

/** The row's one big number in the display face's heaviest cut: the bundled variable face draws its Bold
 * instance as its thinnest on Android, and ExtraBold heavy, as the iOS row's bold figure. */
private val BIG_NUMBER = Faces.figure.copy(fontWeight = FontWeight.ExtraBold)
