package app.trycommish.feature.reference

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.Format
import app.trycommish.core.board.BoardChip
import app.trycommish.core.reference.CompareCandidate
import app.trycommish.core.reference.CompareCell
import app.trycommish.core.reference.CompareHead
import app.trycommish.core.reference.CompareModel
import app.trycommish.core.reference.CompareOutcome
import app.trycommish.core.reference.CompareRange
import app.trycommish.core.reference.CompareRow
import app.trycommish.core.reference.CompareScale
import app.trycommish.core.reference.CompareSlot
import app.trycommish.core.reference.CompareTable
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Headshot
import app.trycommish.design.NumWeight
import app.trycommish.design.PositionPill
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.board.SmallCaps
import app.trycommish.feature.board.gapInk
import app.trycommish.feature.boxscore.SearchField

/** What Compare's controls do: a side picked by its slug or cleared, a format chosen, a name opening the sheet. */
class CompareActions(
    val pick: (Int, String?) -> Unit = { _, _ -> },
    val format: (String) -> Unit = {},
    val open: (SheetPlayer) -> Unit = {},
)

/** Compare's phone columns: the row's label, then each side. */
private val LABEL_WIDTH = 96.dp
private val CELL_HEIGHT = 40.dp
private val FIELD_ROW = 48.dp

/** A side's picker (the web's .picked and PlayerPicker): the player set on it with the way to pick someone
 * else; or the absent words over a search of the run's players, its first eight hits listed. */
@Composable
fun ComparePicker(
    slot: CompareSlot,
    label: String,
    search: (String) -> List<CompareCandidate>,
    pick: (String?) -> Unit,
    still: Boolean,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        when (slot) {
            is CompareSlot.Picked ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = FIELD_ROW)
                        .background(c.surface, shape)
                        .border(1.dp, c.lineStrong, shape)
                        .padding(horizontal = Tokens.Space.s3.dp),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Headshot(slot.headshot, slot.initials, 32.dp)
                    Text(
                        slot.name,
                        style = Faces.body.copy(fontWeight = FontWeight.SemiBold),
                        color = c.ink,
                        modifier = Modifier.weight(1f),
                    )
                    QuietButton(Words.ComparePage.pickAnother) { pick(null) }
                }
            CompareSlot.Missing, CompareSlot.Open -> {
                if (slot == CompareSlot.Missing) {
                    Text(Words.ComparePage.missingTitle, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink)
                    Text(Words.ComparePage.missingLine, style = Faces.small, color = c.ink3)
                }
                var query by rememberSaveable(label) { mutableStateOf("") }
                SearchField(query, label, hits = null, find = { query = it }, still = still)
                search(query).forEach { candidate -> Hit(candidate) { pick(candidate.slug) } }
            }
        }
    }
}

@Composable
private fun Hit(
    candidate: CompareCandidate,
    press: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(role = Role.Button, onClick = press)
            .padding(horizontal = Tokens.Space.s3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            candidate.name,
            style = Faces.body.copy(fontWeight = FontWeight.SemiBold),
            color = CommishTheme.colors.ink,
            modifier = Modifier.weight(1f),
        )
        SmallCaps(candidate.line)
    }
}

/** A side's head over the table: his face, his name opening his sheet, his pill and club. */
@Composable
private fun CompareHeadCell(
    head: CompareHead,
    lead: Boolean,
    open: (SheetPlayer) -> Unit,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    Column(
        modifier.background(if (lead) c.accentWash else c.surface).padding(Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) {
        Headshot(head.headshot, head.initials, 44.dp)
        Text(
            head.name,
            style = Faces.body.copy(fontWeight = FontWeight.Bold),
            color = c.ink,
            modifier = Modifier.clickable(role = Role.Button) { open(head.sheetPlayer) },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp), verticalAlignment = Alignment.CenterVertically) {
            PositionPill(head.pill)
            SmallCaps(head.club)
        }
    }
}

/** A range bar on the pair's shared scale: floor to ceiling, the median marked. */
@Composable
private fun RangeBar(
    range: CompareRange,
    scale: CompareScale,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    val said = listOf(range.floor, range.median, range.ceiling).joinToString(", ") { Format.fixed(it) }
    Canvas(modifier.fillMaxWidth().height(20.dp).semantics { contentDescription = said }) {
        val span = maxOf(scale.high - scale.low, 1.0)
        val place = { value: Double -> ((value - scale.low) / span * size.width).toFloat() }
        val bar = 6.dp.toPx()
        val top = (size.height - bar) / 2
        val round = CornerRadius(bar / 2)
        drawRoundRect(c.surface2, Offset(0f, top), Size(size.width, bar), round)
        val from = place(range.floor)
        drawRoundRect(c.ink3, Offset(from, top), Size(maxOf(place(range.ceiling) - from, 2.dp.toPx()), bar), round)
        drawCircle(c.ink, 5.dp.toPx(), Offset(place(range.median), size.height / 2))
    }
}

/** One row of the table: its label, then each side's figure, the better one bold on the gain's wash, the
 * Gap in its tone, the range as bars. */
@Composable
private fun CompareRowView(
    row: CompareRow,
    table: CompareTable,
) {
    val c = CommishTheme.colors
    Column {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(start = Tokens.Space.s2.dp)) {
            Text(
                row.label.uppercase(),
                style = Faces.label,
                color = c.ink3,
                modifier = Modifier.width(LABEL_WIDTH).align(Alignment.CenterVertically),
            )
            row.cells.forEachIndexed { index, cell ->
                Row(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .heightIn(min = CELL_HEIGHT)
                        .background(if (cell.wins == true) c.gainBg else Color.Transparent)
                        .padding(horizontal = Tokens.Space.s2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val range = table.heads[index].range
                    val scale = table.scale
                    if (row.range && range != null && scale != null) {
                        RangeBar(range, scale)
                    } else {
                        Text(
                            cell.text,
                            style = if (cell.wins == true) Faces.number(NumWeight.Bold) else Faces.cell,
                            color = ink(cell),
                        )
                    }
                }
            }
        }
        HorizontalDivider(color = c.line)
    }
}

@Composable
private fun ink(cell: CompareCell): Color {
    val c = CommishTheme.colors
    return when {
        cell.text == Words.Box.none -> c.ink3
        cell.tone != null -> gapInk(cell.tone)
        cell.wins == false -> c.ink3
        else -> c.ink
    }
}

/** The call and its table: the call band, the heads, the rows, the evidence and the basis. */
@Composable
fun CompareTableView(
    table: CompareTable,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        Text(
            table.call.uppercase(),
            style = Faces.head.copy(fontSize = Tokens.Type.xl.sp),
            color = c.ink,
            modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp),
        )
        Column(
            Modifier
                .padding(horizontal = Tokens.Space.s3.dp)
                .clip(shape)
                .background(c.surface)
                .border(1.dp, c.line, shape),
        ) {
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(start = Tokens.Space.s2.dp)) {
                Column(Modifier.width(LABEL_WIDTH)) {}
                table.heads.forEachIndexed { index, head ->
                    CompareHeadCell(head, index == 0, open, Modifier.weight(1f).fillMaxHeight())
                }
            }
            HorizontalDivider(color = c.line)
            table.rows.forEach { CompareRowView(it, table) }
        }
        Text(
            table.evidence,
            style = Faces.small.copy(fontWeight = FontWeight.Medium),
            color = c.ink2,
            modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp),
        )
        BasisLines(table.basis)
    }
}

/**
 * Compare as its model says it at 390: the heading and its first step, the format chips, the two pickers,
 * then the same-player words or the call with its table, the evidence and the basis. `still` draws it at
 * rest (a snapshot's): the search fields as text, no scrolling.
 */
@Composable
fun CompareScreen(
    model: CompareModel,
    stale: String?,
    formats: List<BoardChip<String>>,
    actions: CompareActions,
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    val scroll = if (still) Modifier else Modifier.fillMaxSize().verticalScroll(rememberScrollState())
    Column(
        scroll.background(c.bg).padding(vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
    ) {
        ReferenceHead(model.title, stamp = null, lead = model.lead, stale = stale)
        FormatChips(formats, actions.format, still)
        Column(Modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            model.slots.forEachIndexed { index, slot ->
                ComparePicker(slot, model.slotLabels[index], model::search, { actions.pick(index, it) }, still)
            }
        }
        when (val outcome = model.outcome) {
            CompareOutcome.None -> Unit
            is CompareOutcome.Same ->
                Column(Modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
                    Text(outcome.title, style = Faces.section.copy(fontWeight = FontWeight.Bold), color = c.ink)
                    Text(outcome.line, style = Faces.small, color = c.ink3, textAlign = TextAlign.Start)
                }
            is CompareOutcome.Table -> CompareTableView(outcome.table, actions.open)
        }
    }
}
