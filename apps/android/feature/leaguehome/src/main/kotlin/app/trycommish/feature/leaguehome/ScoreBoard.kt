package app.trycommish.feature.leaguehome

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.trycommish.core.leaguehome.BugSide
import app.trycommish.core.leaguehome.GameBug
import app.trycommish.core.leaguehome.Stands
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Section
import app.trycommish.design.Tokens
import app.trycommish.design.Words

private val SMALL_W = 76.dp
private val BIG_W = 60.dp

/** Every game of the week as a score bug, the member's first: the state at its head, each side's two
 * figures under the column heads, the side ahead drawn bright. */
@Composable
internal fun ScoreBoard(
    week: String,
    games: List<GameBug>,
) {
    Section(week, Words.LeagueHome.scoreboardAside) {
        Column(
            Modifier.padding(horizontal = Tokens.Space.s4.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            games.forEach { Bug(it) }
        }
    }
}

@Composable
private fun Bug(game: GameBug) {
    val c = CommishTheme.colors
    Surface(
        shape = RoundedCornerShape(Tokens.Radius.md.dp),
        color = c.surface,
        border = BorderStroke(if (game.mine) 2.dp else 1.dp, if (game.mine) c.accent else c.line),
    ) {
        Column(Modifier.padding(vertical = Tokens.Space.s2.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text(game.head.uppercase(), style = Faces.label, color = c.ink2)
                    if (game.words.isNotEmpty()) {
                        Text(game.words, style = Faces.small, color = c.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Head(game.smallHead, SMALL_W)
                Head(game.bigHead, BIG_W)
            }
            HorizontalDivider(Modifier.padding(top = Tokens.Space.s1.dp), color = c.line)
            game.sides.forEach { Side(it) }
        }
    }
}

@Composable
private fun Head(
    text: String,
    width: Dp,
) {
    Text(
        text.uppercase(),
        style = Faces.label,
        color = CommishTheme.colors.ink3,
        textAlign = TextAlign.End,
        maxLines = 1,
        modifier = Modifier.width(width),
    )
}

@Composable
private fun Side(side: BugSide) {
    val c = CommishTheme.colors
    val bright = side.stands != Stands.Behind
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                side.name,
                style = Faces.body,
                color =
                    if (side.me) {
                        c.accentText
                    } else if (bright) {
                        c.ink
                    } else {
                        c.ink2
                    },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val sub = listOf(side.record, side.toPlay).filter { it.isNotEmpty() }.joinToString("   ")
            if (sub.isNotEmpty()) Text(sub, style = Faces.small, color = c.ink3)
        }
        Text(side.small, style = Faces.cell, color = c.ink2, textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(SMALL_W))
        Text(
            side.big,
            style = Faces.figure,
            color = if (bright) c.ink else c.ink3,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(BIG_W),
        )
    }
}
