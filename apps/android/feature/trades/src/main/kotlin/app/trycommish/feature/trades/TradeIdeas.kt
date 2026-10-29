package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.trycommish.core.trades.IdeaPlace
import app.trycommish.core.trades.NoIdeaLine
import app.trycommish.core.trades.OfferPreset
import app.trycommish.core.trades.TradeBuilderModel
import app.trycommish.core.trades.TradePreset
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.HEAD_TRACKING

/** The web's card width on a phone, min(22rem, 86vw), at the phone's own width. */
private val CARD_WIDTH = 300.dp
private val CARD_HEIGHT = 38.dp
private val DASH = floatArrayOf(8f, 6f)

/** Our ideas (TradeBuilder's .ideas at 390, Lanes 260, 268, 290, B271): the head with "N more" at its end
 * over a row of cards that scrolls sideways from its first, the first three; once every idea shows they
 * stack in place. The host's newest offer heads the row, then Best. A card loads its trade into the ticks,
 * pressed while the ticks hold it; an offer the builder cannot hold and a team the finder lists no trade
 * with keep their place, dashed, nothing to press. */
@Composable
internal fun TradeIdeasView(
    builder: TradeBuilderModel,
    actions: TradeActions,
) {
    val c = CommishTheme.colors
    val wide = builder.more == null
    Column(
        Modifier.semantics { contentDescription = builder.ideasHead },
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                builder.ideasHead.uppercase(),
                style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = HEAD_TRACKING.em),
                color = c.ink3,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.weight(1f))
            // The rest of the ideas a tap away, on the head's line so a phone always shows it.
            builder.more?.let { more ->
                Text(
                    more,
                    style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
                    color = c.accentText,
                    modifier =
                        Modifier
                            .clickable(role = Role.Button, onClick = actions.more)
                            .padding(horizontal = Tokens.Space.s2.dp, vertical = Tokens.Space.s1.dp),
                )
            }
        }
        if (wide) {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) { Places(builder, actions, wide = true) }
        } else {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
            ) { Places(builder, actions, wide = false) }
        }
    }
}

@Composable
private fun Places(
    builder: TradeBuilderModel,
    actions: TradeActions,
    wide: Boolean,
) {
    val size = if (wide) Modifier.fillMaxWidth() else Modifier.width(CARD_WIDTH)
    builder.ideas.forEach { place ->
        when (place) {
            is IdeaPlace.Offer -> OfferCard(place.offer, builder.pressed == place.key, size) { actions.idea(place.key) }
            is IdeaPlace.Idea -> IdeaCard(place.preset, builder.pressed == place.key, size) { actions.idea(place.key) }
            is IdeaPlace.None -> NoIdeaCard(place.line, size)
        }
    }
}

/** One idea's card: "Best" and both gains on its first line, "With Max_Jensen10" whole on its own line (a
 * long team name wraps, never cut), the deal under it with what it fills at its end (Lane 290). */
@Composable
private fun IdeaCard(
    preset: TradePreset,
    pressed: Boolean,
    size: Modifier,
    load: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        size
            .heightIn(min = CARD_HEIGHT)
            .clip(shape)
            .background(c.surface)
            .border(if (pressed) 2.dp else 1.dp, if (pressed) c.accent else c.line, shape)
            .clickable(role = Role.Button, onClick = load)
            .semantics { selected = pressed }
            .padding(horizontal = Tokens.Space.s3.dp, vertical = 3.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        val quiet = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.em)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            preset.mark?.let {
                Text(it.uppercase(), style = Faces.label.copy(fontWeight = FontWeight.Bold), color = c.accentText)
            }
            Spacer(Modifier.weight(1f))
            Text(preset.gains, style = quiet, color = c.ink2)
        }
        Text(preset.with, style = quiet, color = c.ink2)
        DealLine(preset.deal, preset.fills, c.accentText)
    }
}

/** The deal and its fact at the line's end (what it fills, when an offer lapses, or where to answer it); a
 * deal too long for the line wraps beside the fact, never cut. */
@Composable
private fun DealLine(
    deal: String,
    fact: String?,
    factInk: Color,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Text(
            deal,
            style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
            color = CommishTheme.colors.ink,
            modifier = Modifier.weight(1f),
        )
        fact?.let {
            Text(
                it,
                style = Faces.label.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.em),
                color = factInk,
                modifier = Modifier.padding(start = 6.dp),
            )
        }
    }
}

/** A trade offered to the member on the host (Lane 290): "Offered to you" marked, "With Muttdogs", then give
 * for get with its expiry at the line's end. One the builder can hold loads its ticks like an idea; one it
 * cannot is dashed, nothing to press, and says where to answer it. Nothing is sent to the host. */
@Composable
private fun OfferCard(
    offer: OfferPreset,
    pressed: Boolean,
    size: Modifier,
    load: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val frame =
        if (offer.picks == null) {
            size.heightIn(min = CARD_HEIGHT).dashed(c.line).semantics(mergeDescendants = true) {}
        } else {
            size
                .heightIn(min = CARD_HEIGHT)
                .clip(shape)
                .background(c.surface)
                .border(if (pressed) 2.dp else 1.dp, if (pressed) c.accent else c.line, shape)
                .clickable(role = Role.Button, onClick = load)
                .semantics { selected = pressed }
        }
    Column(frame.padding(horizontal = Tokens.Space.s3.dp, vertical = 3.dp), verticalArrangement = Arrangement.Center) {
        Text(offer.label.uppercase(), style = Faces.label.copy(fontWeight = FontWeight.Bold), color = c.accentText)
        Text(offer.with, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.em), color = c.ink2)
        DealLine(offer.deal, offer.fact, c.ink2)
    }
}

/** A dashed rounded outline: a card with nothing to press. */
private fun Modifier.dashed(ink: Color): Modifier =
    drawBehind {
        val radius =
            Tokens.Radius.md.dp
                .toPx()
        drawRoundRect(
            ink,
            cornerRadius = CornerRadius(radius, radius),
            style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(DASH)),
        )
    }

/** A team with no idea (B271): its card's two lines, quiet and dashed, nothing to press. */
@Composable
private fun NoIdeaCard(
    line: NoIdeaLine,
    size: Modifier,
) {
    val c = CommishTheme.colors
    Column(
        size
            .heightIn(min = CARD_HEIGHT)
            .dashed(c.line)
            .semantics(mergeDescendants = true) {}
            .padding(horizontal = Tokens.Space.s3.dp, vertical = 3.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(line.with, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.em), color = c.ink2)
        Text(line.note, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink2)
    }
}
