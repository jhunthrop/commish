package app.trycommish.feature.waivers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.waivers.PickupCard
import app.trycommish.core.waivers.WaiverModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.edgeRule

private val EDGE = 4.dp
private val SLOT_SIDE = 40.dp
private val SUM_WIDTH = 200.dp
private const val TRACKING = 0.08

/** The Waivers decision as a strip (web PickupStrip.svelte at 390): the week and the count of pickups
 * worth making, what they add to the lineup, then a card for each (his slot, Best over the first of more
 * than one, the move, why its drop is the one named, this week's Proj gain and the season's). A card
 * tapped is the one the pinned verb acts on. The stamp of a saved read under the title. */
@Composable
internal fun WaiverStrip(
    model: WaiverModel,
    stamp: String?,
    chosen: String?,
    choose: (String) -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .edgeRule(c.accent, EDGE)
            .border(1.dp, c.line, shape)
            .semantics(mergeDescendants = false) { contentDescription = model.decision },
    ) {
        Column(Modifier.padding(Tokens.Space.s4.dp).padding(start = EDGE), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
                Head(model, stamp, Modifier.weight(1f))
                Sum(model)
            }
            model.cards.forEach { card -> Card(card, card.key == chosen) { choose(card.key) } }
        }
    }
}

@Composable
private fun Head(
    model: WaiverModel,
    stamp: String?,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val none = model.cards.isEmpty()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            model.week.uppercase(),
            style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = TRACKING.em),
            color = c.accentText,
        )
        Text(
            model.title.uppercase(),
            style = if (none) Faces.figure.copy(fontSize = Tokens.Type.lg.sp) else Faces.figure,
            color = if (none) c.ink2 else c.ink,
            maxLines = 2,
            modifier = Modifier.semantics { heading() },
        )
        stamp?.let { Text(it, style = Faces.label.copy(letterSpacing = 0.sp), color = c.accentText) }
    }
}

/** "105.4" over "Proj with both, 98.9 without, +6.5": the gain in the gain's ink. */
@Composable
private fun Sum(model: WaiverModel) {
    val c = CommishTheme.colors
    val sum = model.sum ?: return
    Column(Modifier.widthIn(max = SUM_WIDTH), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(sum.figure, style = Faces.figure, color = c.accentText)
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = c.ink3)) { append("${sum.words}, ") }
                withStyle(SpanStyle(color = c.gainInk, fontWeight = FontWeight.Bold)) { append(sum.gain) }
            },
            style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
            textAlign = TextAlign.End,
        )
    }
}

/** One card: his slot, the move with Best over the first, why its drop is named, the gains. The chosen
 * card is outlined in the accent. */
@Composable
private fun Card(
    card: PickupCard,
    chosen: Boolean,
    choose: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (chosen) c.accentWash else c.surface)
            .border(1.dp, if (chosen) c.accent else c.line, shape)
            .clickable(role = Role.Button, onClick = choose)
            .semantics { selected = chosen }
            .padding(Tokens.Space.s3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        Box(Modifier.size(SLOT_SIDE).background(c.surface2, CircleShape), contentAlignment = Alignment.Center) {
            Text(card.slot, style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp), color = c.ink2)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            card.mark?.let {
                Text(
                    it.uppercase(),
                    style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = TRACKING.em),
                    color = c.accentText,
                )
            }
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = c.ink, fontWeight = FontWeight.Bold)) { append(card.move) }
                    card.why?.let { withStyle(SpanStyle(color = c.ink2)) { append(" $it") } }
                },
                style = Faces.small,
            )
            Text(card.gains, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2)
        }
    }
}
