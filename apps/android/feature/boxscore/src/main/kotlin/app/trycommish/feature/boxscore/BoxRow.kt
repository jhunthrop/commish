package app.trycommish.feature.boxscore

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.Ease
import app.trycommish.core.start.Move
import app.trycommish.core.start.RowCells
import app.trycommish.core.start.RowGame
import app.trycommish.design.ArrowMark
import app.trycommish.design.Avatar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.R
import app.trycommish.design.StrokeGlyph
import app.trycommish.design.Tokens
import app.trycommish.design.Words

private const val MOVED_IN_TINT = 0.08f
private const val MOVED_OUT_TINT = 0.04f
private const val OPEN_TURN = 180f
private val EDGE = 3.dp

/** One player's row (web BoxLine.svelte and BoxPlayer.svelte at 390): the slot with the move's arrow,
 * his face, his name (whole where it fits, else his short form), his club, position and status, his
 * game, the expected score and weather while it is to come, the evidence line, then Our rank, Proj and
 * Pts; a moved-in row tinted in the accent with the chevron that opens its evidence. The Lineup and the
 * Matchup draw it; the Matchup's style leaves out the evidence line and the why cell. */
@Composable
fun BoxRow(
    cells: RowCells,
    bench: Boolean,
    actions: RowActions,
    style: BoxStyle = BoxStyle.Lineup,
) {
    val c = CommishTheme.colors
    val open = cells.id in actions.opened
    val edge = edge(cells)
    Row(
        Modifier
            .fillMaxWidth()
            .background(ground(cells))
            .edgeRule(edge, EDGE),
    ) {
        Column(Modifier.weight(1f)) {
            Row(
                Modifier.padding(start = Tokens.Space.s2.dp, end = Tokens.Space.s2.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SlotCell(cells, bench)
                PlayerCell(
                    cells,
                    actions.open,
                    Modifier.weight(1f),
                    evidence = if (style.evidence) cells.evidence else null,
                    facts = style.facts,
                    shortName = style.shortName,
                )
                if (style.rank) {
                    Text(
                        cells.rank,
                        style = Faces.number(NumWeight.Medium),
                        color = if (cells.rank == Words.Box.none) c.ink3 else c.ink,
                        modifier = Modifier.width(BoxColumn.rank).padding(start = Tokens.Space.s1.dp),
                    )
                }
                Figure(cells.proj, BoxColumn.proj)
                if (style.season) Figure(cells.season, BoxColumn.season) else Figure(cells.pts, BoxColumn.pts)
                if (style.why) WhyCell(cells, open, actions)
            }
            val why = cells.why
            if (open && why != null) {
                Text(
                    why,
                    style = Faces.small,
                    color = c.ink,
                    modifier =
                        Modifier.padding(
                            start = BoxColumn.slot + Tokens.Space.s2.dp,
                            end = Tokens.Space.s3.dp,
                            bottom = Tokens.Space.s3.dp,
                        ),
                )
            }
        }
    }
    Hairline()
}

@Composable
private fun SlotCell(
    cells: RowCells,
    bench: Boolean,
) {
    val c = CommishTheme.colors
    Row(
        Modifier.width(BoxColumn.slot),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        cells.move?.let { ArrowMark(starts = it == Move.Into, side = 18.dp) }
        Text(
            cells.row.slot,
            style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp),
            color = if (bench) c.ink3 else c.ink2,
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Composable
private fun WhyCell(
    cells: RowCells,
    open: Boolean,
    actions: RowActions,
) {
    val c = CommishTheme.colors
    Box(Modifier.width(BoxColumn.why), contentAlignment = Alignment.CenterEnd) {
        val why = cells.why ?: return@Box
        val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
        Box(
            Modifier
                .size(width = 26.dp, height = 30.dp)
                .clip(shape)
                .border(1.dp, c.lineStrong, shape)
                .clickable(role = Role.Button) { actions.toggleWhy(cells.id) }
                .semantics {
                    contentDescription = "${Words.Box.why} ${cells.row.name}"
                    stateDescription = if (open) why else ""
                },
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
}

/** A moved-in row on the accent's wash, a moved-out one on the ink's, a spot no one can play on the
 * loss's. */
@Composable
private fun ground(cells: RowCells): Color {
    val c = CommishTheme.colors
    return when {
        cells.move == Move.Into -> c.accent.copy(alpha = MOVED_IN_TINT).compositeOver(c.surface)
        cells.move == Move.Out -> c.ink.copy(alpha = MOVED_OUT_TINT).compositeOver(c.surface)
        cells.idle -> idleGround()
        else -> c.surface
    }
}

@Composable
private fun edge(cells: RowCells): Color =
    when (cells.move) {
        Move.Into -> CommishTheme.colors.accent
        Move.Out -> CommishTheme.colors.lineStrong
        null -> Color.Transparent
    }

/** The player cell: face, name, club line, game line, facts and evidence, folded as the phone folds
 * them. His name opens the player sheet (by `sheetPlayer`) where the site has a page for him. The
 * Waivers rows draw no facts, their own evidence line with A game after it, the day a claim clears
 * after the kickoff, and a Stash row's week in place of his game. */
@Composable
fun PlayerCell(
    cells: RowCells,
    open: (SheetPlayer) -> Unit,
    modifier: Modifier = Modifier,
    sheetPlayer: SheetPlayer? = cells.sheetPlayer,
    /** The line under the game, null for none. */
    evidence: String? = cells.evidence,
    /** Draws the expected score and the weather while his game is to come. */
    facts: Boolean = true,
    clears: String? = null,
    /** Said in place of his game. */
    note: String? = cells.note,
    /** His short form, "A. Rodgers", whatever the room (the Trades' rows). */
    shortName: Boolean = false,
) {
    val c = CommishTheme.colors
    val row = cells.row
    val ink = if (cells.idle) c.ink3 else c.ink
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Avatar(if (row.clubMark) row.club else initialsOf(row.name), BoxColumn.face)
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            NameLine(cells, ink, sheetPlayer, open, shortName)
            ClubLine(cells)
            GameLine(cells, note, clears)
            if (facts) Facts(cells)
            if (evidence != null) {
                Text(
                    evidence(cells, evidence),
                    style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                    color = c.ink2,
                )
            }
        }
    }
}

/** His name whole where it fits in one line, else his short form ("P. Mahomes"), the short form always
 * where the box asks for it; it opens the sheet. */
@Composable
private fun NameLine(
    cells: RowCells,
    ink: Color,
    player: SheetPlayer?,
    open: (SheetPlayer) -> Unit,
    short: Boolean,
) {
    val row = cells.row
    val style = Faces.body.copy(fontWeight = FontWeight.SemiBold)
    val measurer = rememberTextMeasurer()
    BoxWithConstraints {
        val whole = measurer.measure(row.name, style, maxLines = 1, softWrap = false).size.width
        val fits = !short && whole <= constraints.maxWidth
        Text(
            if (fits) row.name else row.fit,
            style = style,
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier =
                Modifier.semantics { contentDescription = row.name }.then(
                    if (player != null) Modifier.clickableLink(row.name) { open(player) } else Modifier,
                ),
        )
    }
}

@Composable
private fun ClubLine(cells: RowCells) {
    val c = CommishTheme.colors
    val row = cells.row
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        Text(row.club, style = Faces.label.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.sp), color = c.ink2)
        Text(row.position, style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.sp), color = c.ink)
        row.status?.let { Pill(it.mark, if (it.sits) PillTone.Loss else PillTone.Plain) }
    }
}

@Composable
private fun GameLine(
    cells: RowCells,
    note: String?,
    clears: String?,
) {
    val c = CommishTheme.colors
    when {
        note != null -> Text(note, style = Faces.small, color = c.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        cells.game is RowGame.Game -> {
            val game = cells.game as RowGame.Game
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = c.ink)) { append(game.place) }
                    append(" ")
                    withStyle(SpanStyle(color = c.ink2)) { append(game.time) }
                    clears?.let {
                        append(" ")
                        withStyle(
                            SpanStyle(color = c.accentText, fontWeight = FontWeight.SemiBold, fontSize = Tokens.Type.xs.sp),
                        ) { append(it) }
                    }
                },
                style = Faces.small,
            )
        }
        cells.game == RowGame.Bye -> Text(Words.Box.bye, style = Faces.small, color = c.ink2)
        cells.game == RowGame.NoClub -> Text(Words.Box.noClub, style = Faces.small, color = c.ink2)
        else -> Unit
    }
}

/** The expected score and the weather while his game is to come, in one line that wraps between them,
 * never inside either. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Facts(cells: RowCells) {
    val c = CommishTheme.colors
    val row = cells.row
    if (row.expected == null && row.weather == null) return
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        row.expected?.let {
            Text(
                it,
                modifier = Modifier.align(Alignment.CenterVertically),
                style = Faces.cell.copy(fontSize = Tokens.Type.sm.sp),
                color = c.ink2,
            )
        }
        row.weather?.let { weather ->
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

/** "Opp 2nd, Avg 23.3, Last 19.0": the opponent's rank in the ease's ink while his game is to come. */
@Composable
private fun evidence(
    cells: RowCells,
    said: String,
): AnnotatedString {
    val c = CommishTheme.colors
    val rank = cells.oppRank
    val at = rank?.let { said.indexOf(it) } ?: -1
    if (rank == null || at < 0 || cells.ease == Ease.Even) return AnnotatedString(said)
    val ink = if (cells.ease == Ease.Hard) c.lossInk else c.gainInk
    return buildAnnotatedString {
        append(said.substring(0, at))
        withStyle(SpanStyle(color = ink, fontWeight = FontWeight.Bold)) { append(rank) }
        append(said.substring(at + rank.length))
    }
}

/** The kickoff weather's glyphs, the web's own paths (web/src/lib/league/box/WeatherGlyph.svelte). */
internal object WeatherGlyphs {
    private val paths =
        mapOf(
            "wind" to listOf("M3 8h11a3 3 0 1 0-3-3", "M3 12h15a3 3 0 1 1-3 3", "M3 16h8"),
            "indoors" to listOf("M3 19h18", "M5 19v-5a7 7 0 0 1 14 0v5"),
            "roof" to listOf("M3 19h18", "M5 19v-6l7-5 7 5v6", "M12 8V4"),
            "abroad" to listOf("M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M3 12h18", "M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"),
            "outdoors" to listOf("M12 4v2", "M12 18v2", "M4 12h2", "M18 12h2", "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8"),
        )

    fun paths(glyph: String): List<String> = paths[glyph] ?: paths.getValue("outdoors")
}
