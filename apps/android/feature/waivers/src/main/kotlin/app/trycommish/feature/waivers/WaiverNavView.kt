package app.trycommish.feature.waivers

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.waivers.NavCard
import app.trycommish.core.waivers.NavLead
import app.trycommish.core.waivers.PanelMode
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.wrapCenter
import kotlinx.coroutines.flow.first

/** The card's measures: at least 120 wide (Lane 304 widened it so a rank is never cut), growing rather
 * than cut; the meter's height; the chosen card's pointer down to the comparison. */
private object NavMeasure {
    val card = 120.dp
    val meter = 4.dp
    val pointer = 12.dp
    val chip = 30.dp
    val target = 48.dp
}

private const val MUTED = 0.78f
private const val PICKUP_WASH = 0.18f
private const val NEED_WASH = 0.16f
private const val METER_ON = 0.3f

/** What the position cards draw and do (web PositionNav.svelte): the cards in the toggle's figures, the
 * chosen one, the toggle, the line over the comparison; a card chosen, the toggle set. */
class NavActions(
    val cards: List<NavCard> = emptyList(),
    val chosen: String = "",
    val mode: PanelMode = PanelMode.Season,
    val hasWeek: Boolean = false,
    val lead: NavLead? = null,
    val choose: (String) -> Unit = {},
    val chooseMode: (PanelMode) -> Unit = {},
    /** Draws the row at rest with the chosen card in view (a snapshot draws no scroll). */
    val still: Boolean = false,
)

/**
 * The Waivers screen's navigation (web PositionNav.svelte at 390): "Your positions" with the toggle, one
 * row of cards scrolling sideways (All first, then a card a position the league starts with the member's
 * rank there, his figure against the median and the Need mark), the chosen card solid ink and kept in
 * view; the rank's meaning once a mode under the row; then the chosen card's line over the comparison.
 */
@Composable
internal fun WaiverNavView(nav: NavActions) {
    if (nav.cards.isEmpty()) return
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        NavHead(nav)
        NavRow(nav)
        Text(nav.mode.explain, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
        nav.lead?.let { LeadLine(it) }
    }
}

/** The row of cards, the chosen one scrolled into view: a part card at an edge says the row scrolls. */
@Composable
private fun NavRow(nav: NavActions) {
    val chosenIndex = nav.cards.indexOfFirst { it.key == nav.chosen }.coerceAtLeast(0)
    if (nav.still) {
        // The row as a phone shows it once scrolled, drawn at rest: two cards before the chosen one at most
        // (one before the last card, so it shows whole), the first of them in part where cards follow.
        val shift = if (chosenIndex >= 2 && chosenIndex < nav.cards.size - 1) -NavMeasure.card / 2 else 0.dp
        Box(Modifier.fillMaxWidth().clipToBounds()) {
            CardRow(
                nav,
                nav.cards.drop((chosenIndex - if (chosenIndex == nav.cards.size - 1) 1 else 2).coerceAtLeast(0)),
                Modifier.wrapContentWidth(Alignment.Start, unbounded = true).offset(x = shift),
            )
        }
        return
    }
    val scroll = rememberScrollState()
    val lefts = remember(nav.cards.size) { IntArray(nav.cards.size) }
    LaunchedEffect(nav.chosen) {
        // Once the row is laid out (its scroll has a range), never again on a refresh or a toggle: a hand
        // scroll stands until another card is chosen (review 308 L4).
        snapshotFlow { scroll.maxValue }.first { it > 0 }
        bringIntoView(scroll, lefts, chosenIndex)
    }
    CardRow(nav, nav.cards, Modifier.horizontalScroll(scroll)) { index, left -> lefts[index] = left }
}

@Composable
private fun CardRow(
    nav: NavActions,
    cards: List<NavCard>,
    modifier: Modifier,
    placed: (Int, Int) -> Unit = { _, _ -> },
) {
    Row(
        modifier.padding(bottom = NavMeasure.pointer / 2 + 2.dp),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        cards.forEachIndexed { index, card ->
            NavCardView(
                card,
                card.key == nav.chosen,
                Modifier.onGloballyPositioned { placed(index, it.positionInParent().x.toInt()) },
            ) { nav.choose(card.key) }
        }
    }
}

/** The chosen card scrolled to the row's middle place, so the card before it shows in part. */
private suspend fun bringIntoView(
    scroll: ScrollState,
    lefts: IntArray,
    index: Int,
) {
    if (index < 2 || scroll.maxValue == 0) return
    val previous = lefts.getOrElse(index - 1) { 0 }
    val target = (previous + (lefts.getOrElse(index) { 0 } - previous) / 2).coerceIn(0, scroll.maxValue)
    scroll.animateScrollTo(target)
}

/** "Your positions", then the toggle where the answer reads this week, else the figure's basis. */
@Composable
private fun NavHead(nav: NavActions) {
    val c = CommishTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Text(
            Words.WaiverPanel.label.uppercase(),
            style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
            color = c.ink2,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.weight(1f))
        if (nav.hasWeek) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                PanelMode.entries.forEach { mode -> ModeChip(mode, nav.mode == mode) { nav.chooseMode(mode) } }
            }
        } else {
            Text(Words.WaiverPanel.season, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
        }
    }
}

@Composable
private fun ModeChip(
    mode: PanelMode,
    lit: Boolean,
    choose: () -> Unit,
) {
    val c = CommishTheme.colors
    val pill = RoundedCornerShape(Tokens.Radius.pill.dp)
    Box(
        Modifier
            .heightIn(min = NavMeasure.target)
            .clickable(role = Role.Button, onClick = choose)
            .semantics {
                // The chip names its group, as the web's ChipGroup label does: "Figures for This week".
                contentDescription = "${Words.WaiverNav.figuresFor} ${mode.word}"
                selected = lit
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            mode.word,
            style = Faces.label.copy(letterSpacing = 0.sp),
            color = if (lit) c.bg else c.ink2,
            modifier =
                Modifier
                    .heightIn(min = NavMeasure.chip)
                    .clip(pill)
                    .background(if (lit) c.ink else c.surface)
                    .border(1.dp, if (lit) c.ink else c.lineStrong, pill)
                    .padding(horizontal = Tokens.Space.s3.dp)
                    .wrapCenter(),
        )
    }
}

/** The chosen card's rank in bold, and only what the card cannot say beside it. */
@Composable
private fun LeadLine(lead: NavLead) {
    val c = CommishTheme.colors
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = c.ink, fontSize = Tokens.Type.md.sp)) { append(lead.head) }
            lead.words?.let { append("  $it") }
        },
        style = Faces.small,
        color = c.ink2,
        modifier = Modifier.fillMaxWidth().padding(top = Tokens.Space.s1.dp),
    )
}

/** One card: the position with the Pickup mark, its rank, the member's figure with its tag and Need, the
 * meter against the median's tick, the median team's figure; or what it waits on. The chosen card is
 * solid ink with a pointer down to the comparison. */
@Composable
private fun NavCardView(
    card: NavCard,
    chosen: Boolean,
    modifier: Modifier,
    tap: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val ink = if (chosen) c.bg else c.ink
    val muted = if (chosen) c.bg.copy(alpha = MUTED) else c.ink2
    val small = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp)
    Box(modifier) {
        if (chosen) {
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .offset(y = NavMeasure.pointer / 2)
                    .size(NavMeasure.pointer)
                    .rotate(45f)
                    .background(c.ink, RoundedCornerShape(2.dp)),
            )
        }
        Column(
            Modifier
                // The card as wide as its widest line, at least the card's measure: the meter and the marks'
                // spacers fill that width inside a row that scrolls.
                .width(IntrinsicSize.Max)
                .widthIn(min = NavMeasure.card)
                .clip(shape)
                .background(if (chosen) c.ink else c.surface)
                .border(1.dp, if (chosen) c.ink else c.lineStrong, shape)
                .clickable(role = Role.Button, onClick = tap)
                .semantics {
                    contentDescription = card.spoken
                    selected = chosen
                }.padding(Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(card.word, style = Faces.number(NumWeight.Bold, Tokens.Type.lg.sp), color = ink)
                Spacer(Modifier.weight(1f).widthIn(min = 6.dp))
                if (card.pickup) {
                    Mark(
                        Words.WaiverNav.pickup,
                        if (chosen) c.accentInk else c.accentText,
                        if (chosen) c.accent else c.accent.copy(alpha = PICKUP_WASH),
                    )
                }
            }
            card.place?.let { Text(it, style = small, color = muted, maxLines = 1, softWrap = false) }
            val waits = card.waits
            if (waits != null) {
                Text(waits, style = small, color = muted, modifier = Modifier.width(NavMeasure.card - Tokens.Space.s2.dp * 2))
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(card.figure.orEmpty(), style = Faces.number(NumWeight.Bold, Tokens.Type.lg.sp), color = ink)
                    card.tag?.let { Text(it, style = small, color = muted, maxLines = 1, softWrap = false) }
                    Spacer(Modifier.weight(1f))
                    if (card.need) {
                        Mark(
                            Words.WaiverPanel.need,
                            if (chosen) c.bg else c.lossInk,
                            if (chosen) c.lossInk else c.lossInk.copy(alpha = NEED_WASH),
                        )
                    }
                }
                Meter(card, chosen)
                Text(card.foot ?: " ", style = small, color = if (chosen) muted else c.ink3, maxLines = 1, softWrap = false)
            }
        }
    }
}

@Composable
private fun Mark(
    words: String,
    ink: Color,
    fill: Color,
) {
    Text(
        words,
        style = Faces.label.copy(letterSpacing = 0.sp),
        color = ink,
        maxLines = 1,
        softWrap = false,
        modifier = Modifier.clip(RoundedCornerShape(Tokens.Radius.pill.dp)).background(fill).padding(horizontal = 6.dp),
    )
}

/** The member's figure against the median team's: the tick is the median, at the middle. */
@Composable
private fun Meter(
    card: NavCard,
    chosen: Boolean,
) {
    val c = CommishTheme.colors
    val track = RoundedCornerShape(2.dp)
    Box(
        Modifier.fillMaxWidth().padding(vertical = 3.dp).height(NavMeasure.meter),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(NavMeasure.meter)
                .clip(track)
                .background(if (chosen) c.bg.copy(alpha = METER_ON) else c.line),
        )
        card.meter?.let { meter ->
            Box(
                Modifier
                    .fillMaxWidth(meter.share.toFloat())
                    .height(NavMeasure.meter)
                    .clip(track)
                    .background(if (meter.under) c.lossInk else c.gainInk),
            )
            Box(
                Modifier
                    .align(Alignment.Center)
                    .width(2.dp)
                    .height(NavMeasure.meter + 6.dp)
                    .background(if (chosen) c.bg else c.ink2),
            )
        }
    }
}
