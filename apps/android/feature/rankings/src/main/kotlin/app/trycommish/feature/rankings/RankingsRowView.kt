package app.trycommish.feature.rankings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.rankings.RankingsHeads
import app.trycommish.core.rankings.RankingsPills
import app.trycommish.core.rankings.RankingsPlayer
import app.trycommish.core.rankings.RankingsRow
import app.trycommish.core.rankings.WeekRankingsRow
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.RowGame
import app.trycommish.core.start.StartWords
import app.trycommish.design.Avatar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.PILL_PADDING
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.PositionPill
import app.trycommish.design.StrokeGlyph
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.design.pillStyle
import app.trycommish.feature.boxscore.FigureStrip
import app.trycommish.feature.boxscore.FigureStripSize
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.Hairline
import app.trycommish.feature.boxscore.WeatherGlyphs
import app.trycommish.feature.boxscore.clickableLink

/** The phone's columns (OrderTable.svelte and WeekTable.svelte at 390, iOS's RankingsColumn): the # cell,
 * the face, the pill's least width and the club's column, and the week's Proj. The pill's slot and the big
 * Projected are measured, not fixed (RankingsWidths). */
internal object RankingsColumn {
    val rank = 30.dp
    val face = 28.dp

    /** The pill's least width (the web's --line-pill), so short pills ("K", "RB") are one size. */
    val pillLeast = 50.dp
    val club = 34.dp
    val proj = 52.dp

    /** A rest-of-season Projected under a thousand points, the most a season holds. */
    const val WIDEST_TOTAL = 999.9
}

/** The row's measured columns, the same for every row of a table: the pill's slot and the big Projected's
 * column. Measured once where the table is drawn (rememberRankingsWidths) and handed to each row, never in
 * a row: a lazy list composes rows as they scroll in, and the slot lays out every pill candidate. */
@Immutable
internal data class RankingsWidths(
    /** The pill's slot: as wide as the widest pill the order can print, at least the pill's least width, so
     * a three-digit rank or a list word is never cut and the club column starts at one x on every row (Lane
     * 215 review H1). */
    val pill: Dp,
    /** The big figure's column: the widest Projected the order prints at the name's size, bold (the number
     * face's tabular figures make every such figure one width), plus the strip's gap before it, so the rest of
     * the line is the name's (Lane 215 re-review M-A). */
    val total: Dp,
)

/** The widest of the candidates by a measure, with its width: the candidate the pill slot is sized to. */
internal fun widestPill(
    candidates: List<String>,
    measure: (String) -> Int,
): Pair<String, Int> = candidates.map { it to measure(it) }.maxBy { it.second }

/** The table's measured columns, laid out once per table with one measurer, keyed on the density (which
 * carries the font scale). Composed once by RankingsPage and once by the screen's lazy list, so scrolling
 * a row in measures nothing. The widest pill candidate at the default scale is "WR Susp"
 * (RankingsWidthsTest), 62 dp with the pill's padding. */
@Composable
internal fun rememberRankingsWidths(): RankingsWidths {
    val measurer = rememberTextMeasurer(cacheSize = 0)
    val density = LocalDensity.current
    return remember(density) {
        val pillStyle = pillStyle
        val (_, widest) =
            widestPill(RankingsPills.widestCandidates) { measurer.measure(it, pillStyle, maxLines = 1, softWrap = false).size.width }
        val totalStyle = Faces.number(NumWeight.Bold, Tokens.Type.md.sp)
        val total = measurer.measure(StartWords.number(RankingsColumn.WIDEST_TOTAL), totalStyle, maxLines = 1, softWrap = false).size.width
        with(density) {
            RankingsWidths(
                pill = maxOf(widest.toDp() + PILL_PADDING * 2, RankingsColumn.pillLeast),
                total = total.toDp() + FigureStripSize.gap,
            )
        }
    }
}

/** The game line's indent under the name: past the # cell (on the order) and the face. */
private val FACE_INDENT = RankingsColumn.face + Tokens.Space.s2.dp

/** The order's: the # cell's whole width (its padding before the face is inside it), then the face's. */
private val ORDER_INDENT = RankingsColumn.rank + FACE_INDENT

/** The first line of a row (BoxPlayer.svelte's line at 390): his face or his club's mark, his name the
 * biggest thing on it, whole where it fits and else his short form (a link to his sheet where the site has
 * his page), then his pill and club as a column of fixed width. */
@Composable
private fun RankingsNameLine(
    player: RankingsPlayer,
    pillSlot: Dp,
    open: (SheetPlayer) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Avatar(if (player.clubMark) player.club else initialsOf(player.name), RankingsColumn.face)
        NameText(player, open, Modifier.padding(start = Tokens.Space.s2.dp).weight(1f))
        Box(Modifier.width(pillSlot)) {
            // Its own width, never squeezed: the words are a fact (Lane 215 review H1).
            player.pill?.let { PositionPill(it, Modifier.wrapContentWidth(Alignment.Start, unbounded = true), RankingsColumn.pillLeast) }
        }
        Text(
            player.club,
            style = Faces.label.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.sp),
            color = c.ink2,
            maxLines = 1,
            modifier = Modifier.padding(start = Tokens.Space.s1.dp).width(RankingsColumn.club),
        )
    }
}

/** His name whole where it fits in one line, else his short form; it opens the sheet where the site has his
 * page. */
@Composable
private fun NameText(
    player: RankingsPlayer,
    open: (SheetPlayer) -> Unit,
    modifier: Modifier,
) {
    val style = Faces.body.copy(fontWeight = FontWeight.SemiBold)
    val measurer = rememberTextMeasurer()
    val sheet = player.sheetPlayer
    BoxWithConstraints(modifier) {
        val room = constraints.maxWidth
        val fits =
            remember(player.name, room, style) {
                measurer.measure(player.name, style, maxLines = 1, softWrap = false).size.width <= room
            }
        Text(
            if (fits) player.name else player.fit,
            style = style,
            color = CommishTheme.colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier =
                Modifier.semantics { contentDescription = player.name }.then(
                    if (sheet != null) Modifier.clickableLink(player.name) { open(sheet) } else Modifier,
                ),
        )
    }
}

/** The second line (BoxGame.svelte with its glyph, then StatusChip): his game as one cell, the opponent
 * strong and the kickoff or the state's word after it, the kickoff weather as its glyph alone (its words
 * the glyph's description), then his status chip whole. Where the two do not fit one line the status takes
 * a second, as the web's game line wraps; nothing is cut. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RankingsGameLine(
    player: RankingsPlayer,
    indent: Dp,
) {
    if (player.game == RowGame.None && player.status == null) return
    FlowRow(
        Modifier.fillMaxWidth().padding(start = indent),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(Modifier.align(Alignment.CenterVertically)) { GameCell(player) }
        player.status?.let { Pill(it.mark, if (it.sits) PillTone.Loss else PillTone.Plain, Modifier.align(Alignment.CenterVertically)) }
    }
}

@Composable
private fun GameCell(player: RankingsPlayer) {
    val c = CommishTheme.colors
    when (val game = player.game) {
        is RowGame.Game ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
                Text(game.place, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink, maxLines = 1, softWrap = false)
                Text(game.time, style = Faces.small, color = c.ink2, maxLines = 1, softWrap = false)
                player.weather?.let { weather ->
                    Box(Modifier.clearAndSetSemantics { contentDescription = weather.words }) {
                        StrokeGlyph(WeatherGlyphs.paths(weather.glyph), WEATHER_GLYPH, c.ink3)
                    }
                }
            }
        RowGame.Bye -> Text(Words.Box.bye, style = Faces.small, color = c.ink2, maxLines = 1)
        RowGame.NoClub -> Text(Words.Box.noClub, style = Faces.small, color = c.ink2, maxLines = 1)
        RowGame.None -> Unit
    }
}

private val WEATHER_GLYPH = 11.dp

/** A Rankings row's frame: its lines, its padding and the hairline under it. */
@Composable
private fun RankingsRowFrame(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(CommishTheme.colors.surface)
            .padding(Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) { content() }
    Hairline()
}

/** One row of our order (OrderTable.svelte at 390), two lines and a strip: the place, the player and his
 * Projected; his game under his name; his figures as labelled cells across the row. */
@Composable
internal fun RankingsRowView(
    row: RankingsRow,
    widths: RankingsWidths,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    RankingsRowFrame {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                row.place,
                style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp),
                color = c.ink,
                textAlign = TextAlign.End,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.width(RankingsColumn.rank).padding(end = Tokens.Space.s2.dp),
            )
            RankingsNameLine(row.player, widths.pill, open, Modifier.weight(1f))
            // The name's size, its weight for emphasis: the player stays the biggest thing.
            Text(
                row.total,
                style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp),
                color = if (row.total == Words.Box.none) c.ink3 else c.ink,
                textAlign = TextAlign.End,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.width(widths.total),
            )
        }
        RankingsGameLine(row.player, ORDER_INDENT)
        FigureStrip(row.cells)
    }
}

/** One row of the kickers' or defenses' week (WeekTable.svelte at 390), as the order's: the player and his
 * Proj, quiet once his game kicks off; his game; Opp rank, Avg and Last as labelled cells. */
@Composable
internal fun WeekRankingsRowView(
    row: WeekRankingsRow,
    proj: Boolean,
    kicked: Boolean,
    widths: RankingsWidths,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    RankingsRowFrame {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RankingsNameLine(row.player, widths.pill, open, Modifier.weight(1f))
            if (proj) {
                Text(
                    row.proj,
                    style = Faces.number(NumWeight.Bold, if (kicked) Tokens.Type.sm.sp else Tokens.Type.md.sp),
                    color = if (kicked || row.proj == Words.Box.none) c.ink3 else c.ink,
                    textAlign = TextAlign.End,
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.width(RankingsColumn.proj),
                )
            }
        }
        RankingsGameLine(row.player, FACE_INDENT)
        FigureStrip(row.cells)
    }
}

/** The order's heads (OrderTable.svelte's cols at 390): #, Player and Projected; the week's figure and
 * Over repl. head their own cells in each row's strip. */
@Composable
internal fun RankingsHeadRow(heads: RankingsHeads) {
    HeadLine {
        Head(heads.rank, Modifier.width(RankingsColumn.rank).padding(end = Tokens.Space.s2.dp), TextAlign.End)
        Head(Words.Box.player, Modifier.weight(1f))
        Head(heads.total, Modifier.wrapContentWidth(unbounded = true), TextAlign.End)
    }
}

/** The week's heads: Player, and Proj once the week's projection is in. */
@Composable
internal fun WeekHeadRow(proj: Boolean) {
    HeadLine {
        Head(Words.Box.player, Modifier.weight(1f))
        if (proj) Head(Words.Box.proj, Modifier.width(RankingsColumn.proj), TextAlign.End)
    }
}

@Composable
private fun HeadLine(content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 32.dp)
            .background(CommishTheme.colors.bg)
            .padding(horizontal = Tokens.Space.s2.dp)
            .clearAndSetSemantics {},
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
    Hairline()
}

@Composable
private fun Head(
    words: String,
    modifier: Modifier,
    align: TextAlign = TextAlign.Start,
) {
    Text(
        words.uppercase(),
        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
        color = CommishTheme.colors.ink3,
        textAlign = align,
        maxLines = 1,
        softWrap = false,
        modifier = modifier,
    )
}
