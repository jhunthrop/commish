package app.trycommish.feature.waivers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.waivers.BeatsCell
import app.trycommish.core.waivers.DropHead
import app.trycommish.core.waivers.DropRow
import app.trycommish.core.waivers.NavCompare
import app.trycommish.core.waivers.PoolRow
import app.trycommish.core.waivers.WaiverModel
import app.trycommish.core.waivers.WaiverSort
import app.trycommish.core.waivers.WaiverSortKey
import app.trycommish.core.waivers.WaiverTable
import app.trycommish.core.waivers.YoursRow
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Pill
import app.trycommish.design.R
import app.trycommish.design.StrokeGlyph
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.Figure
import app.trycommish.feature.boxscore.Hairline
import app.trycommish.feature.boxscore.NoteRow
import app.trycommish.feature.boxscore.PlayerCell
import app.trycommish.feature.boxscore.SectionRow
import app.trycommish.feature.boxscore.TableFrame
import app.trycommish.feature.boxscore.edgeRule

/** The phone's Waivers columns (WaiverTable.svelte at 390): the player taking the rest, Proj, Beats and
 * the row's button. */
object WaiverColumn {
    val proj = 46.dp
    val beats = 88.dp
    val act = 44.dp
}

private val NAMED_EDGE = 3.dp
private val BUTTON_SIDE = 30.dp
private val RADIO_SIDE = 22.dp
private const val READING_ALPHA = 0.6f
private const val OPEN_TURN = 180f
private val PLUS = listOf("M12 5v14", "M5 12h14")

/** What the table's rows do and what they draw from: a name opens the player sheet, a row's button its
 * drop panel, a drop is chosen; the rows in the sort and the search, the open panel's rows, and whether a
 * position is being read (its last rows stand, quieter). */
class TableActions(
    val open: (SheetPlayer) -> Unit = {},
    val tap: (String) -> Unit = {},
    val chooseDrop: (String) -> Unit = {},
    val opened: String? = null,
    val drops: List<DropRow> = emptyList(),
    val chosenDrop: String? = null,
    val dropHead: DropHead? = null,
    val table: WaiverTable = WaiverTable.Empty,
    val sort: WaiverSort = WaiverSort.Initial,
    val onSort: (WaiverSortKey) -> Unit = {},
    val reading: Boolean = false,
    /** The member's players at the chosen position over its free agents, null for All (Lane 305). */
    val compare: NavCompare? = null,
    /** What the table says with no row: no free agent at the chosen position, else none found. */
    val empty: String = Words.Waivers.noneFound,
)

/** Which of the table's groups a part draws. */
enum class TableGroup {
    /** The rows that gain. */
    Gaining,

    /** The rest under the divider. */
    Rest,

    /** The Stash group with its line. */
    Stash,

    /** Only the open row with its drop panel, the heads over it. */
    Opened,
    ;

    companion object {
        /** The whole table: the rows that gain, the rest, the Stash group, under one set of heads. */
        val Page: Set<TableGroup> = setOf(Gaining, Rest, Stash)
    }
}

/** The players free to add (WaiverTable.svelte at 390): the heads with the line under them said once,
 * the rows that gain, the rest under one divider, quiet, then the Stash group with its line; an open
 * row's drop panel under it. */
@Composable
internal fun WaiverTableView(
    model: WaiverModel,
    groups: Set<TableGroup>,
    actions: TableActions,
) {
    val table = actions.table
    Box(Modifier.alpha(if (actions.reading) READING_ALPHA else 1f).semantics { contentDescription = Words.InSeason.waiverAdds }) {
        TableFrame {
            WaiverHeadRow(model.projected, actions.sort, actions.onSort)
            HeadsLine(model.heads)
            val compare = actions.compare
            if (TableGroup.Gaining in groups && compare != null) {
                // The member's players there, then the free agents: each head only over rows of its own.
                if (compare.rows.isNotEmpty()) {
                    SectionRow(compare.yours)
                    compare.rows.forEach { YoursRowView(it, model.projected, actions.open) }
                }
                if (table.rows.isNotEmpty()) SectionRow(compare.free)
            }
            if (TableGroup.Gaining in groups) table.gaining.forEach { Entry(it, model, actions) }
            if (TableGroup.Opened in groups) table.rows.filter { it.key == actions.opened }.forEach { Entry(it, model, actions) }
            if (TableGroup.Rest in groups && table.rest.isNotEmpty()) {
                SectionRow(Words.Waivers.noGain)
                table.rest.forEach { Entry(it, model, actions) }
            }
            if (TableGroup.Gaining in groups && table.gaining.isEmpty() && table.rest.isEmpty()) NoteRow(actions.empty)
            if (TableGroup.Stash in groups && (table.stash.isNotEmpty() || model.stashLine.isNotEmpty())) {
                SectionRow(Words.Stash.head)
                if (model.stashLine.isNotEmpty()) NoteRow(model.stashLine.joinToString(" "))
                table.stash.forEach { Entry(it, model, actions) }
            }
        }
    }
}

@Composable
private fun Entry(
    row: PoolRow,
    model: WaiverModel,
    actions: TableActions,
) {
    val open = actions.opened == row.key
    WaiverRowView(row, model.projected, open, actions)
    if (open) DropPanel(model.projected, actions)
}

/** The columns' basis said once under the heads, each head in bold (Lane 98, B35). */
@Composable
private fun HeadsLine(text: String) {
    val c = CommishTheme.colors
    Text(
        bolded(text),
        style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
        color = c.ink2,
        modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
    )
    Hairline()
}

/** The heads named in the line drawn strong, each the first time it is said. */
@Composable
private fun bolded(text: String): AnnotatedString {
    val c = CommishTheme.colors
    val heads = listOf(Words.Waivers.rest, Words.Box.avg, Words.Box.delta, Words.Waivers.beats)
    val spans =
        heads
            .mapNotNull { head ->
                val at = text.indexOf("$head ").takeIf { it >= 0 } ?: text.indexOf(head).takeIf { it >= 0 }
                at?.let { it until it + head.length }
            }.sortedBy { it.first }
    return buildAnnotatedString {
        var at = 0
        spans.forEach { span ->
            append(text.substring(at, span.first))
            withStyle(SpanStyle(color = c.ink, fontWeight = FontWeight.Bold)) { append(text.substring(span.first, span.last + 1)) }
            at = span.last + 1
        }
        append(text.substring(at))
    }
}

/** One player free to add: his cell with the evidence line and A game, Proj, Beats and his button. The
 * strip's own move is tinted in the accent; a row that gains nothing is quiet. */
@Composable
private fun WaiverRowView(
    row: PoolRow,
    projected: Boolean,
    open: Boolean,
    actions: TableActions,
) {
    val c = CommishTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (row.named || open) c.accentWash else c.surface)
            .then(if (row.named) Modifier.edgeRule(c.accent, NAMED_EDGE) else Modifier)
            .padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayerCell(
            row.cells,
            actions.open,
            Modifier.weight(1f),
            sheetPlayer = row.sheetPlayer,
            evidence = row.evidence,
            facts = false,
            clears = row.clears,
            note = row.away ?: row.cells.note,
        )
        if (projected) Figure(row.cells.proj, WaiverColumn.proj)
        BeatsView(row.beats, quiet = !row.gains, Modifier.width(WaiverColumn.beats))
        Box(Modifier.width(WaiverColumn.act), contentAlignment = Alignment.CenterEnd) { RowButton(row, open, actions) }
    }
    Hairline()
}

/** One of the member's players at the chosen position (WaiverTable.svelte's Your rows): his cell with the
 * evidence line and A game, Proj, and Starter or Bench where a free agent's Beats is; no verb. */
@Composable
private fun YoursRowView(
    row: YoursRow,
    projected: Boolean,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    Row(
        Modifier.fillMaxWidth().background(c.surface2).padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayerCell(row.cells, open, Modifier.weight(1f), sheetPlayer = row.sheetPlayer, evidence = row.evidence, facts = false)
        if (projected) Figure(row.cells.proj, WaiverColumn.proj)
        Text(
            row.role,
            style = Faces.label.copy(fontWeight = if (row.starts) FontWeight.Bold else FontWeight.Normal, letterSpacing = 0.sp),
            color = if (row.starts) c.ink else c.ink3,
            textAlign = TextAlign.End,
            modifier = Modifier.width(WaiverColumn.beats),
        )
        Spacer(Modifier.width(WaiverColumn.act))
    }
    Hairline()
}

/** The row's own button: "+" opening the players he could replace (turned while open), or a Stash row's
 * word. */
@Composable
private fun RowButton(
    row: PoolRow,
    open: Boolean,
    actions: TableActions,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    val ink =
        when {
            open -> c.accentText
            row.gains -> c.ink
            else -> c.ink3
        }
    Box(
        Modifier
            .sizeIn(minWidth = BUTTON_SIDE, minHeight = BUTTON_SIDE)
            .clip(shape)
            .border(1.dp, if (open) c.accent else c.lineStrong, shape)
            .clickable(role = Role.Button) { actions.tap(row.key) }
            .semantics {
                contentDescription = "${if (open) Words.Waivers.close else row.button} ${row.cells.row.name}"
                selected = open
            },
        contentAlignment = Alignment.Center,
    ) {
        when {
            row.button != Words.InSeason.add ->
                Text(
                    row.button,
                    style = Faces.label.copy(letterSpacing = 0.sp),
                    color = ink,
                    modifier = Modifier.padding(horizontal = Tokens.Space.s1.dp),
                )
            open ->
                Icon(
                    painterResource(R.drawable.icon_chevron),
                    null,
                    Modifier.size(15.dp).rotate(OPEN_TURN),
                    tint = ink,
                )
            else -> StrokeGlyph(PLUS, 15.dp, ink)
        }
    }
}

/** The Beats cell: whom his move replaces with his place, then the season Gain, loud on a row that
 * gains, and the strip's move's week figure under it. */
@Composable
private fun BeatsView(
    beats: BeatsCell,
    quiet: Boolean,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val small = Faces.label.copy(letterSpacing = 0.sp)
    Column(modifier, horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
        beats.who?.let { who ->
            Text(who.name, style = small, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.End)
            Text(who.place, style = small.copy(fontWeight = FontWeight.Normal), color = c.ink2, maxLines = 1)
        }
        beats.figure?.let { figure ->
            Text(
                figure,
                style =
                    if (beats.loud) {
                        Faces.number(NumWeight.Bold)
                    } else {
                        Faces.number(NumWeight.Medium, Tokens.Type.sm.sp)
                    },
                color =
                    when {
                        beats.loud -> c.gainInk
                        quiet -> c.ink3
                        else -> c.ink2
                    },
                maxLines = 1,
            )
        }
        beats.week?.let { Text(it, style = small.copy(fontWeight = FontWeight.Normal), color = c.ink2) }
    }
}

/** An add's drop panel: "Drop one for Mason Taylor" with its lead, then each player of the member's he
 * could replace in the same columns, the advice's drop first, a radio to choose one; the pair the verb
 * makes is pinned above the bar. */
@Composable
private fun DropPanel(
    projected: Boolean,
    actions: TableActions,
) {
    val c = CommishTheme.colors
    Column(Modifier.semantics { contentDescription = actions.dropHead?.title.orEmpty() }) {
        actions.dropHead?.let { head ->
            Column(
                Modifier.fillMaxWidth().background(c.surface2).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(head.title, style = Faces.small.copy(fontWeight = FontWeight.Bold), color = c.ink)
                Text(head.lead, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2)
            }
            Hairline()
        }
        val chosen = actions.chosenDrop ?: actions.drops.firstOrNull()?.key
        actions.drops.forEach { DropRowView(it, projected, it.key == chosen, actions) }
    }
}

/** One player the add could replace: his cell, Proj, the season Gain with him dropped (and the week's
 * where the drops differ), Starter where this week's lineup starts him, and the radio. */
@Composable
private fun DropRowView(
    drop: DropRow,
    projected: Boolean,
    chosen: Boolean,
    actions: TableActions,
) {
    val c = CommishTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (chosen) c.accentWash else c.surface)
            .padding(start = Tokens.Space.s2.dp + Tokens.Space.s3.dp, end = Tokens.Space.s2.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayerCell(drop.cells, actions.open, Modifier.weight(1f), evidence = drop.evidence, facts = false)
        if (projected) Figure(drop.cells.proj, WaiverColumn.proj)
        Column(Modifier.width(WaiverColumn.beats), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            drop.starter?.let { Pill(it) }
            Text(
                drop.gain,
                style = Faces.number(NumWeight.Bold),
                color =
                    when {
                        drop.gain.startsWith("+") -> c.gainInk
                        drop.gain.startsWith("−") -> c.lossInk
                        else -> c.ink2
                    },
            )
            drop.week?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink2) }
        }
        Box(Modifier.width(WaiverColumn.act), contentAlignment = Alignment.CenterEnd) {
            Radio(chosen, "${Words.Stash.drop} ${drop.cells.row.name}") { actions.chooseDrop(drop.key) }
        }
    }
    Hairline()
}

@Composable
private fun Radio(
    chosen: Boolean,
    label: String,
    choose: () -> Unit,
) {
    val c = CommishTheme.colors
    Box(
        Modifier
            .size(RADIO_SIDE)
            .clip(CircleShape)
            .border(2.dp, if (chosen) c.accent else c.lineStrong, CircleShape)
            .clickable(role = Role.RadioButton, onClick = choose)
            .semantics {
                contentDescription = label
                selected = chosen
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(RADIO_SIDE - 10.dp).background(if (chosen) c.accent else c.surface, CircleShape))
    }
}
