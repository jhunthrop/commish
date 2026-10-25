package app.trycommish.feature.rankings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.rankings.RankingsHeads
import app.trycommish.core.rankings.RankingsPlayer
import app.trycommish.core.rankings.RankingsRow
import app.trycommish.core.rankings.WeekRankingsRow
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.RowGame
import app.trycommish.design.Avatar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.PositionPill
import app.trycommish.design.StrokeGlyph
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.Figure
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.Hairline
import app.trycommish.feature.boxscore.WeatherGlyphs
import app.trycommish.feature.boxscore.clickableLink

/** The phone's columns (OrderTable.svelte and WeekTable.svelte at 390), the iOS RankingsColumn's: the #
 * cell, the week's figure and the big Projected; the week's Proj. */
internal object RankingsColumn {
    val rank = 30.dp
    val week = 40.dp
    val total = 74.dp
    val proj = 52.dp
    val face = 28.dp
}

private val ROW_PADDING = 7.dp

/** A player's cell (BoxPlayer.svelte at 390): his initials or his club's mark, his name whole where it
 * fits and else his short form (a link to his sheet where the site has his page), his club with his pill
 * and his status chip, his game with its zone, the expected score and the kickoff weather while it is to
 * come, and the line folded under it all. */
@Composable
internal fun RankingsPlayerCell(
    player: RankingsPlayer,
    folded: String,
    open: (SheetPlayer) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Avatar(if (player.clubMark) player.club else initialsOf(player.name), RankingsColumn.face)
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            NameLine(player, open)
            ClubLine(player)
            GameLine(player.game)
            Facts(player)
            Text(folded, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
        }
    }
}

/** His name whole where it fits in one line, else his short form; it opens the sheet where the site has
 * his page. */
@Composable
private fun NameLine(
    player: RankingsPlayer,
    open: (SheetPlayer) -> Unit,
) {
    val style = Faces.body.copy(fontWeight = FontWeight.SemiBold)
    val measurer = rememberTextMeasurer()
    val sheet = player.sheetPlayer
    BoxWithConstraints {
        val fits = measurer.measure(player.name, style, maxLines = 1, softWrap = false).size.width <= constraints.maxWidth
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

@Composable
private fun ClubLine(player: RankingsPlayer) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        Text(player.club, style = Faces.label.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.sp), color = CommishTheme.colors.ink2)
        player.pill?.let { PositionPill(it) }
        player.status?.let { Pill(it.mark, if (it.sits) PillTone.Loss else PillTone.Plain) }
    }
}

@Composable
private fun GameLine(game: RowGame) {
    val c = CommishTheme.colors
    when (game) {
        is RowGame.Game ->
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = c.ink)) { append(game.place) }
                    append(" ")
                    withStyle(SpanStyle(color = c.ink2)) { append(game.time) }
                },
                style = Faces.small,
            )
        RowGame.Bye -> Text(Words.Box.bye, style = Faces.small, color = c.ink2)
        RowGame.NoClub -> Text(Words.Box.noClub, style = Faces.small, color = c.ink2)
        RowGame.None -> Unit
    }
}

/** The expected score and the weather while his game is to come, wrapping between them, never inside. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Facts(player: RankingsPlayer) {
    val c = CommishTheme.colors
    if (player.expected == null && player.weather == null) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        player.expected?.let {
            Text(
                it,
                modifier = Modifier.align(Alignment.CenterVertically),
                style = Faces.label.copy(letterSpacing = 0.sp),
                color = c.ink2,
            )
        }
        player.weather?.let { weather ->
            Row(
                Modifier.align(Alignment.CenterVertically),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                StrokeGlyph(WeatherGlyphs.paths(weather.glyph), 11.dp, c.ink3)
                Text(weather.words, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
            }
        }
    }
}

/** One row of our order (OrderTable.svelte at 390): the place, the player, the week's figure and his
 * Projected big. */
@Composable
internal fun RankingsRowView(
    row: RankingsRow,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    Row(
        Modifier.fillMaxWidth().background(c.surface).padding(horizontal = Tokens.Space.s2.dp, vertical = ROW_PADDING),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            row.place,
            style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp),
            color = c.ink,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(RankingsColumn.rank).padding(end = Tokens.Space.s2.dp),
        )
        RankingsPlayerCell(row.player, row.folded, open, Modifier.weight(1f))
        Text(
            row.week,
            style = Faces.number(NumWeight.Bold, Tokens.Type.sm.sp),
            color = c.ink2,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(RankingsColumn.week),
        )
        Text(
            row.total,
            style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp),
            color = if (row.total == Words.Box.none) c.ink3 else c.ink,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(RankingsColumn.total),
        )
    }
    Hairline()
}

/** One row of the kickers' or defenses' week (WeekTable.svelte at 390): the player and his Proj, quiet
 * once his game has kicked off. */
@Composable
internal fun WeekRankingsRowView(
    row: WeekRankingsRow,
    proj: Boolean,
    kicked: Boolean,
    open: (SheetPlayer) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().background(CommishTheme.colors.surface).padding(horizontal = Tokens.Space.s2.dp, vertical = ROW_PADDING),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RankingsPlayerCell(row.player, row.folded, open, Modifier.weight(1f))
        if (proj) Figure(row.proj, RankingsColumn.proj, muted = kicked || row.proj == Words.Box.none)
    }
    Hairline()
}

/** The order's heads (OrderTable.svelte's cols at 390): #, Player, the week's head, Projected. */
@Composable
internal fun RankingsHeadRow(heads: RankingsHeads) {
    HeadLine {
        Head(heads.rank, Modifier.width(RankingsColumn.rank).padding(end = Tokens.Space.s2.dp), TextAlign.End)
        Head(Words.Box.player, Modifier.weight(1f))
        Head(heads.week, Modifier.width(RankingsColumn.week), TextAlign.End, wraps = false)
        Head(heads.total, Modifier.width(RankingsColumn.total), TextAlign.End, wraps = false)
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
    wraps: Boolean = true,
) {
    Text(
        words.uppercase(),
        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
        color = CommishTheme.colors.ink3,
        textAlign = align,
        maxLines = 1,
        softWrap = wraps,
        modifier = modifier,
    )
}
