package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.trades.Tone
import app.trycommish.core.trades.TradeBug
import app.trycommish.core.trades.TradeBugSide
import app.trycommish.design.CommishColors
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.HEAD_TRACKING

/** The team's column, the web's 7.5rem at a phone's type. */
private val WHO = 96.dp

/** The rest-of-season column, its head in two short lines. */
private val REST = 58.dp
private val BAR = 40.dp
private val BAR_HEIGHT = 4.dp
private val CELL_GAP = 6.dp

/** The verdict's box score as a phone draws it (TradeBug.svelte under 760 px, Lanes 268 and 277): the heads
 * once, then one row per side: You or With over the team's name whole and its room, this week's Proj before
 * to after with its change, the gain a week before to after with its change and a short bar against the
 * other side's, and the rest-of-season change; who would not take it is the answer line's and the pin's,
 * as the web's phone says it. */
@Composable
internal fun TradeBugView(
    bug: TradeBug,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.lineStrong, shape)
            .padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(CELL_GAP)) {
            Box(Modifier.width(WHO))
            Head(Words.Trades.weekHead, Modifier.weight(1f))
            Head(Words.Trades.gainHead, Modifier.weight(1f))
            Head(Words.Trades.restHead, Modifier.width(REST))
        }
        BugRow(bug.yours)
        HorizontalDivider(color = c.line)
        BugRow(bug.theirs)
    }
}

@Composable
private fun BugRow(side: TradeBugSide) {
    val c = CommishTheme.colors
    Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(CELL_GAP)) {
        Column(Modifier.width(WHO)) {
            Text(
                side.label.uppercase(),
                style = Faces.label.copy(fontWeight = FontWeight.Bold),
                color = if (side.mine) c.accentText else c.ink3,
            )
            Text(side.name, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink)
            if (side.room.isNotEmpty()) {
                Text(side.room, style = Faces.label.copy(letterSpacing = 0.sp), color = c.ink2)
            }
        }
        val f = side.figures
        Swing(f.projBefore, f.projAfter, f.projChange, f.projTone, null, Modifier.weight(1f))
        Swing(f.seasonBefore, f.seasonAfter, f.seasonChange, f.seasonTone, side.bar, Modifier.weight(1f))
        Box(Modifier.width(REST)) {
            if (side.rest.text.isNotEmpty()) Change(side.rest.text, side.rest.tone)
        }
    }
}

/** "98.9 to 109.0 +10.1": before quiet, after strong, the change in its chip; the gain's bar under. */
@Composable
private fun Swing(
    before: String,
    after: String,
    change: String,
    tone: Tone,
    bar: Double?,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val figure = Faces.number(NumWeight.SemiBold, Tokens.Type.sm.sp)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(before, style = figure, color = c.ink3, maxLines = 1)
            Text(Words.Trades.to, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
            Text(after, style = figure.copy(fontWeight = Faces.number(NumWeight.Bold).fontWeight), color = c.ink, maxLines = 1)
            Change(change, tone)
        }
        bar?.let { GainBar(it, tone) }
    }
}

/** A change in its tone's chip: "+5.3" on the gain's ground, "−9.6" on the loss's. */
@Composable
private fun Change(
    words: String,
    tone: Tone,
) {
    val c = CommishTheme.colors
    Text(
        words,
        style = Faces.number(NumWeight.Bold, Tokens.Type.xs.sp),
        color = ink(tone, c),
        maxLines = 1,
        modifier =
            Modifier
                .clip(RoundedCornerShape(Tokens.Radius.sm.dp))
                .background(ground(tone, c))
                .padding(horizontal = 3.dp),
    )
}

/** A side's gain a week as a short bar, the longer side full, in the gain's or the loss's ink. */
@Composable
private fun GainBar(
    share: Double,
    tone: Tone,
) {
    val c = CommishTheme.colors
    val pill = RoundedCornerShape(Tokens.Radius.pill.dp)
    Box(
        Modifier
            .width(BAR)
            .height(BAR_HEIGHT)
            .clip(pill)
            .background(c.line),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(share.coerceIn(0.0, 1.0).toFloat())
                .clip(pill)
                .background(
                    when (tone) {
                        Tone.Gain -> c.gainInk
                        Tone.Loss -> c.lossInk
                        Tone.Even -> c.ink3
                    },
                ),
        )
    }
}

@Composable
private fun Head(
    words: String,
    modifier: Modifier,
) {
    Text(
        words.uppercase(),
        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
        color = CommishTheme.colors.ink3,
        maxLines = 2,
        modifier = modifier,
    )
}

private fun ink(
    tone: Tone,
    c: CommishColors,
): Color =
    when (tone) {
        Tone.Gain -> c.gainInk
        Tone.Loss -> c.lossInk
        Tone.Even -> c.ink2
    }

private fun ground(
    tone: Tone,
    c: CommishColors,
): Color =
    when (tone) {
        Tone.Gain -> c.gainBg
        Tone.Loss -> c.lossBg
        Tone.Even -> Color.Transparent
    }
