package app.trycommish.feature.record

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.AppWords
import app.trycommish.core.rankings.RankingsChip
import app.trycommish.core.record.DraftRow
import app.trycommish.core.record.DraftSectionModel
import app.trycommish.core.record.RecordCell
import app.trycommish.core.record.RecordFigure
import app.trycommish.core.record.RecordFigureCells
import app.trycommish.core.record.RecordModel
import app.trycommish.core.record.RecordSectionModel
import app.trycommish.core.record.RecordState
import app.trycommish.core.record.RecordUi
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.ChipRow
import app.trycommish.feature.boxscore.Hairline
import app.trycommish.feature.boxscore.NoteRow
import app.trycommish.feature.boxscore.PageHead
import app.trycommish.feature.boxscore.ScreenFailed
import app.trycommish.feature.boxscore.TableFrame

/** What the screen's chips do, and a pull. */
class RecordActions(
    val figure: (RecordFigure) -> Unit = {},
    val position: (String) -> Unit = {},
    val draftFigure: (RecordFigure) -> Unit = {},
    val refresh: () -> Unit = {},
)

/** The parts of the page a screen draws: the whole page, or one of its runs (a snapshot's). */
enum class RecordPart { Head, Weeks, Draft }

private val STATUS_LEAD = 96.dp

/** Our record with its view model (the iOS RecordView's twin): the saved read at once, then the run's; a
 * pull reads again. The screen decides nothing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordScreen(
    ui: RecordUi,
    stamp: String?,
    refreshing: Boolean,
    actions: RecordActions,
    modifier: Modifier = Modifier,
) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = actions.refresh,
        modifier = modifier.fillMaxSize().background(CommishTheme.colors.bg),
    ) {
        when (val state = ui.state) {
            RecordState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            RecordState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
            is RecordState.Failed -> ScreenFailed(state.message, actions.refresh)
            is RecordState.Loaded ->
                RecordPage(state.model, ui, stamp, actions, modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()))
        }
    }
}

/** Our record in the web's order at 390: the name and the lead, the weekly record (its head, the summary,
 * the chips, the weeks with their status words and figures, the season to date, the basis), then the
 * draft record. Drawn whole, or the parts a snapshot asks for; `still` lays the chips still. */
@Composable
fun RecordPage(
    model: RecordModel,
    ui: RecordUi,
    stamp: String?,
    actions: RecordActions,
    parts: List<RecordPart> = RecordPart.entries,
    still: Boolean = false,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.background(CommishTheme.colors.bg).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
    ) {
        if (RecordPart.Head in parts) {
            PageHead(model.title, model.lead, stamp)
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
                model.weekly.head?.let { (title, what) -> RecordHeadView(title, what) }
                RecordBugView(model.weekly.bug)
            }
        }
        if (RecordPart.Weeks in parts) WeeksView(model.weekly, ui, actions, still)
        if (RecordPart.Draft in parts) DraftView(model.draft, ui.draftFigure, actions.draftFigure, still)
    }
}

/** record.ts's chip word for a position: a defense is "D/ST". */
private fun positionWord(position: String): String = if (position == DEFENSE) RankingsChip.DEF.word else position

private const val DEFENSE = "DST"

/** The chips, the weeks as a box score for the figure chosen (the phone draws one at a time), the season
 * to date, and the basis once. */
@Composable
private fun WeeksView(
    section: RecordSectionModel,
    ui: RecordUi,
    actions: RecordActions,
    still: Boolean,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        if (section.positions.isNotEmpty()) {
            ChipRow(section.positions.map { positionWord(it) to it }, ui.position, actions.position, still)
        }
        ChipRow(section.figures.zip(RecordFigure.entries), ui.figure, actions.figure, still)
        TableFrame {
            RecordHeadRow(Words.RecordBox.week, section.sourceHeads)
            section.before?.let { (lead, text) -> StatusRow(lead, text, null) }
            section.rows.forEach { row ->
                val cells = row.cells?.get(ui.position)?.get(ui.figure)
                if (row.graded && cells != null) FigureRow(row.lead, row.caption, cells) else StatusRow(row.lead, row.text, row.order)
                row.note?.let { NoteRow(it) }
            }
            section.toDate?.let { toDate ->
                toDate.cells[ui.position]?.get(ui.figure)?.let { FigureRow(toDate.lead, null, it, c.bg) }
            }
        }
        BasisText(section.basis)
    }
}

@Composable
private fun Lead(
    text: String,
    order: String?,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(text, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
        order?.let {
            Text(
                it,
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = Faces.small.letterSpacing),
                color = c.ink3,
            )
        }
    }
}

@Composable
private fun FigureRow(
    lead: String,
    order: String?,
    cells: RecordFigureCells,
    ground: Color = CommishTheme.colors.surface,
) {
    Row(
        Modifier.fillMaxWidth().background(ground).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Lead(lead, order, Modifier.weight(1f))
        cells.cells.forEachIndexed { index, cell -> RecordFigureView(cell, lit = index == 0 && !cells.trails) }
    }
    Hairline()
}

@Composable
private fun StatusRow(
    lead: String,
    text: String,
    order: String?,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        Lead(lead, order, Modifier.width(STATUS_LEAD))
        Text(text, style = Faces.small, color = CommishTheme.colors.ink2, modifier = Modifier.weight(1f))
    }
    Hairline()
}

/** The draft record (DraftSection.svelte at 390): its head, the line saying the next run writes it, or its
 * bug with each figure's pair, the figure chips, the positions as a box score with All last, and its
 * basis. */
@Composable
private fun DraftView(
    draft: DraftSectionModel,
    figure: RecordFigure,
    choose: (RecordFigure) -> Unit,
    still: Boolean,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        RecordHeadView(draft.title, draft.what)
        val waiting = draft.waiting
        if (waiting != null) {
            BasisText(waiting)
            return@Column
        }
        draft.span?.let { span ->
            Card {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(span, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink2)
                    Text(draft.players.orEmpty(), style = Faces.number(NumWeight.Bold, Tokens.Type.lg.sp), color = c.ink)
                }
                draft.tiles.forEach { PairTileView(it.label, it.key, it.pair) }
                draft.honest?.let { Text(it, style = Faces.small, color = c.ink2) }
            }
        }
        ChipRow(draft.figures.zip(RecordFigure.entries), figure, choose, still)
        TableFrame {
            RecordHeadRow(Words.Records.position, listOf(Words.RecordBox.ours, Words.RecordBox.adp))
            draft.rows.forEach { DraftRowView(it, figure) }
            draft.all?.let { DraftRowView(it, figure, Words.Records.all, c.bg) }
        }
        BasisText(draft.basis)
    }
}

@Composable
private fun DraftRowView(
    row: DraftRow,
    figure: RecordFigure,
    lead: String? = null,
    ground: Color = CommishTheme.colors.surface,
) {
    val cell = row.cells[figure]
    Row(
        Modifier.fillMaxWidth().background(ground).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            lead ?: positionWord(row.position),
            style = Faces.body.copy(fontWeight = FontWeight.SemiBold),
            color = CommishTheme.colors.ink,
            modifier = Modifier.weight(1f),
        )
        RecordFigureView(RecordCell(Words.RecordBox.ours, cell?.ours.orEmpty(), null), lit = cell?.accented == true)
        RecordFigureView(RecordCell(Words.RecordBox.adp, cell?.adp.orEmpty(), null), lit = false)
    }
    Hairline()
}
