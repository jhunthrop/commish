package app.trycommish.feature.player

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.player.CardHead
import app.trycommish.core.player.CardTile
import app.trycommish.core.player.NextCell
import app.trycommish.core.player.PlayerCard
import app.trycommish.core.player.SheetRead
import app.trycommish.core.player.ShownRead
import app.trycommish.core.start.RowStatus
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.Tokens
import app.trycommish.design.Words

/** The tiles' columns, three across as the shelf draws them at 390. */
private const val TILES_ACROSS = 3

/** The read's line height over its size (the box-score paragraph's leading). */
private const val READ_LEADING = 1.4

/**
 * The sheet's body once his week is read (the web's PlayerShelf.svelte at 390): his status, his week's
 * game, the six figures as cells three across, our read (the writer's words in the sans face at the rows'
 * size with its byline a caption, or the words that say why none stands), and the basis once under it all.
 */
@Composable
fun PlayerCardView(
    card: PlayerCard,
    stamp: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        card.status?.let { StatusPill(it) }
        stamp?.let { StampLine(it) }
        card.head?.let { GameLine(it, card.cell) }
        TileGrid(card.tiles)
        card.read?.let { WeekReadView(it) }
        if (card.basis.isNotEmpty()) BasisLines(card.basis)
    }
}

/** His designation's chip, a loss's tint where it keeps him out. */
@Composable
internal fun StatusPill(status: RowStatus) {
    Pill(status.mark, if (status.sits) PillTone.Loss else PillTone.Plain)
}

/** "Last read Sun 3:05 pm" over a card or a page drawn from saved reads. */
@Composable
internal fun StampLine(text: String) {
    Text(text, style = Faces.label.copy(letterSpacing = 0.sp), color = CommishTheme.colors.accentText)
}

/** Every line of a basis, once, in the interface face (the read face reads as a legal page in season). */
@Composable
internal fun BasisLines(lines: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        lines.forEach { Text(it, style = Faces.small, color = CommishTheme.colors.ink3) }
    }
}

/** A small uppercase head over a figure or a list (Label.svelte). */
@Composable
internal fun SmallHead(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(text.uppercase(), style = Faces.label.copy(fontWeight = FontWeight.Bold), color = CommishTheme.colors.ink3, modifier = modifier)
}

/** His week's game under his name (CardNext.svelte folded): the week, the opponent and the kickoff or the
 * state's word, then the expected score and the weather while it is still to be played. */
@Composable
private fun GameLine(
    head: CardHead,
    cell: NextCell?,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        HorizontalDivider(color = c.line)
        SmallHead(head.label, Modifier.padding(top = Tokens.Space.s1.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp), verticalAlignment = Alignment.Bottom) {
            Text(cell?.place ?: head.opponent, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink)
            cell?.time?.let { Text(it, style = Faces.small, color = c.ink2) }
        }
        val facts = listOfNotNull(cell?.expected, cell?.weather?.words)
        if (facts.isNotEmpty()) Text(facts.joinToString("   "), style = Faces.small, color = c.ink2)
    }
}

/** The figures as cells, three across in a box (CardTiles.svelte folded): each its label over its figure,
 * the week's figure in the accent and the opponent's ease in its tint, the change quiet. */
@Composable
private fun TileGrid(tiles: List<CardTile>) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, c.line, shape)) {
        tiles.chunked(TILES_ACROSS).forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider(color = c.line)
            Row(Modifier.fillMaxWidth().height(TILE_HEIGHT.dp)) {
                row.forEachIndexed { at, tile ->
                    if (at > 0) VerticalDivider(color = c.line)
                    TileCell(tile, Modifier.weight(1f))
                }
            }
        }
    }
}

private const val TILE_HEIGHT = 72

@Composable
private fun TileCell(
    tile: CardTile,
    modifier: Modifier,
) {
    Column(
        modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) {
        Text(
            tile.label.uppercase(),
            style = Faces.label.copy(fontWeight = FontWeight.Bold),
            color = CommishTheme.colors.ink3,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(tile.value, style = Faces.number(NumWeight.Bold, Tokens.Type.xl.sp), color = inkOf(tile.tone), maxLines = 1)
    }
}

@Composable
private fun inkOf(tone: CardTile.Tone?): Color {
    val c = CommishTheme.colors
    return when (tone) {
        CardTile.Tone.Lead -> c.accentText
        CardTile.Tone.Easy -> c.gainInk
        CardTile.Tone.Hard -> c.lossInk
        CardTile.Tone.Quiet -> c.ink2
        CardTile.Tone.Even, null -> c.ink
    }
}

/** Our read in season (Capsule.svelte with `week`): the box-score paragraph in the sans face with its
 * byline as a caption above it, or the words that say why no read stands (founder ruling 2026-10-21:
 * sans in season, caption byline). */
@Composable
internal fun WeekReadView(read: SheetRead) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        SmallHead(Words.Card.ourRead, Modifier.semantics { heading() })
        val shown = (read as? SheetRead.Shown)?.read
        if (shown is ShownRead.Written) {
            Text(shown.caption, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
            Text(shown.body, style = Faces.body.copy(lineHeight = (Tokens.Type.md * READ_LEADING).sp), color = c.ink)
        } else {
            val words =
                when (read) {
                    is SheetRead.None -> read.words
                    is SheetRead.Shown -> (read.read as ShownRead.Withheld).words
                }
            Text(words, style = Faces.body, color = c.ink2)
        }
    }
}
