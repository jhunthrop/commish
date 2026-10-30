package app.trycommish.feature.waivers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.api.models.WaiverRow
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.waivers.PanelCard
import app.trycommish.core.waivers.PanelEntry
import app.trycommish.core.waivers.PanelMode
import app.trycommish.core.waivers.WaiverPanel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.StrokeGlyph
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.Figure
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.Hairline
import app.trycommish.feature.boxscore.NoteRow
import app.trycommish.feature.boxscore.TableFrame
import app.trycommish.feature.boxscore.wrapCenter

/** The phone's panel columns: the player taking the rest, the figure, Beats and the Add. */
private object PanelColumn {
    val card = 120.dp
    val figure = 60.dp
    val beats = 88.dp
    val act = 48.dp
}

private val PANEL_CHIP_HEIGHT = 28.dp
private val PANEL_HEAD_HEIGHT = 28.dp
private val ADD_SIDE = 30.dp

/** The Add's tap target, the platform's minimum; the drawn square stays [ADD_SIDE]. */
private val ADD_TARGET = 48.dp
private val PLUS = listOf("M12 5v14", "M5 12h14")

/** What the position panel draws and does (PositionPanel.svelte): the cards in the toggle's figures, the
 * one open, the toggle, a card tapped, a free agent's Add (the screen's one verb) and a name's sheet. */
class PanelActions(
    val cards: List<PanelCard> = emptyList(),
    val mode: PanelMode = PanelMode.Season,
    val hasWeek: Boolean = false,
    val opened: PanelCard? = null,
    val choose: (PanelMode) -> Unit = {},
    val toggle: (String) -> Unit = {},
    val add: (WaiverRow) -> Unit = {},
    val open: (SheetPlayer) -> Unit = {},
)

/**
 * The Waivers screen's position panel (web PositionPanel.svelte at 390): "Your positions" with the
 * toggle, one row of cards scrolling sideways (a position each, its rank in the league, the member's
 * figure, the need mark and the median team's), and the open card's ranked list under the row: the
 * member's players first, then the best free agents there, each with the table's Beats words and Add.
 * Nothing at all from an answer without the panel.
 */
@Composable
internal fun WaiverPanelView(panel: PanelActions) {
    if (panel.cards.isEmpty()) return
    Column(
        Modifier.semantics { contentDescription = Words.WaiverPanel.label },
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        PanelHead(panel)
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            panel.cards.forEach { card -> PanelCardView(card, panel.opened?.key == card.key) { panel.toggle(card.key) } }
        }
        panel.opened?.let { PanelList(it, panel) }
    }
}

/** "Your positions", then the toggle where the answer reads this week, else the figure's basis. */
@Composable
private fun PanelHead(panel: PanelActions) {
    val c = CommishTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Text(
            Words.WaiverPanel.label.uppercase(),
            style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
            color = c.ink2,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.weight(1f))
        if (panel.hasWeek) {
            PanelMode.entries.forEach { mode -> ModeChip(mode, panel.mode == mode) { panel.choose(mode) } }
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
    Text(
        mode.word,
        style = Faces.label.copy(letterSpacing = 0.sp),
        color = if (lit) c.accentInk else c.ink2,
        modifier =
            Modifier
                .heightIn(min = PANEL_CHIP_HEIGHT)
                .clip(pill)
                .background(if (lit) c.accent else c.surface)
                .border(1.dp, if (lit) c.accent else c.lineStrong, pill)
                .clickable(role = Role.Button, onClick = choose)
                .semantics { selected = lit }
                .padding(horizontal = Tokens.Space.s3.dp)
                .wrapCenter(),
    )
}

/** One card, three lines: the position and its rank, the member's figure with Need, the median team's. */
@Composable
private fun PanelCardView(
    card: PanelCard,
    open: Boolean,
    tap: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .widthIn(min = PanelColumn.card)
            .clip(shape)
            .background(if (open) c.accentWash else c.surface)
            .border(1.dp, if (open) c.accent else c.line, shape)
            .clickable(role = Role.Button, onClick = tap)
            .semantics {
                contentDescription =
                    listOfNotNull(card.rank, card.figure, Words.WaiverPanel.need.takeIf { card.need }, card.median).joinToString(", ")
                selected = open
            }.padding(Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = c.ink)) { append(card.word) }
                append(" ${card.place}")
            },
            style = Faces.small,
            color = c.ink2,
            maxLines = 1,
            softWrap = false,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(card.figure, style = Faces.number(NumWeight.Bold, Tokens.Type.lg.sp), color = c.ink)
            if (card.need) Pill(Words.WaiverPanel.need, PillTone.Loss)
        }
        Text(card.median ?: " ", style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
    }
}

/** The open card's list: its rank with what the rank is, the heads, the member's players, then the free
 * agents with their Beats and Add, or the line that none we list plays there. */
@Composable
private fun PanelList(
    card: PanelCard,
    panel: PanelActions,
) {
    val c = CommishTheme.colors
    Box(Modifier.semantics { contentDescription = card.rank }) {
        TableFrame {
            Column(
                Modifier.fillMaxWidth().background(c.surface2).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(card.rank, style = Faces.small.copy(fontWeight = FontWeight.Bold), color = c.ink)
                Text(
                    WaiverPanel.explain(panel.mode, listOf(card)),
                    style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                    color = c.ink2,
                )
            }
            Hairline()
            ListHeads(panel.mode)
            card.mine.forEach { EntryRow(it, panel) }
            if (card.free.isEmpty()) NoteRow(Words.WaiverPanel.noneFree)
            card.free.forEach { EntryRow(it, panel) }
        }
    }
}

@Composable
private fun ListHeads(mode: PanelMode) {
    val c = CommishTheme.colors
    val style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em)
    Row(
        Modifier.fillMaxWidth().heightIn(min = PANEL_HEAD_HEIGHT).padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(Words.Box.player.uppercase(), style = style, color = c.ink3, modifier = Modifier.weight(1f))
        Text(mode.head.uppercase(), style = style, color = c.ink3, textAlign = TextAlign.End, modifier = Modifier.width(PanelColumn.figure))
        Text(
            Words.Waivers.beats.uppercase(),
            style = style,
            color = c.ink3,
            textAlign = TextAlign.End,
            modifier = Modifier.width(PanelColumn.beats),
        )
        Spacer(Modifier.width(PanelColumn.act))
    }
    Hairline()
}

/** One player on the list: his name (it opens his sheet) and club with his mark, the figure, a free
 * agent's Beats words and Add. */
@Composable
private fun EntryRow(
    entry: PanelEntry,
    panel: PanelActions,
) {
    val c = CommishTheme.colors
    val gains = entry.pool?.gains == true
    Row(
        Modifier.fillMaxWidth().background(c.surface).padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            val sheet = entry.sheetPlayer
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = c.ink)) { append(entry.name) }
                    withStyle(SpanStyle(color = c.ink3)) { append(" ${entry.team}") }
                },
                style = Faces.small,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier =
                    Modifier
                        .then(if (sheet != null) Modifier.clickable(role = Role.Button) { panel.open(sheet) } else Modifier)
                        .semantics { contentDescription = entry.full },
            )
            Text(entry.mark, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2)
        }
        Box(Modifier.width(PanelColumn.figure), contentAlignment = Alignment.CenterEnd) { Figure(entry.figure, PanelColumn.figure) }
        Text(
            entry.beats.orEmpty(),
            style = Faces.label.copy(fontWeight = if (gains) FontWeight.Bold else FontWeight.Normal, letterSpacing = 0.sp),
            color = if (gains) c.gainInk else c.ink2,
            textAlign = TextAlign.End,
            modifier = Modifier.width(PanelColumn.beats),
        )
        Box(Modifier.width(PanelColumn.act), contentAlignment = Alignment.CenterEnd) {
            entry.pool?.let { pool -> AddButton(entry, gains) { panel.add(pool.source) } }
        }
    }
    Hairline()
}

@Composable
private fun AddButton(
    entry: PanelEntry,
    gains: Boolean,
    add: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    Box(
        Modifier
            .size(ADD_TARGET)
            .clickable(role = Role.Button, onClick = add)
            .semantics { contentDescription = "${Words.InSeason.add} ${entry.full}" },
        contentAlignment = Alignment.CenterEnd,
    ) {
        Box(
            Modifier.sizeIn(minWidth = ADD_SIDE, minHeight = ADD_SIDE).clip(shape).border(1.dp, c.lineStrong, shape),
            contentAlignment = Alignment.Center,
        ) { StrokeGlyph(PLUS, 15.dp, if (gains) c.ink else c.ink3) }
    }
}
