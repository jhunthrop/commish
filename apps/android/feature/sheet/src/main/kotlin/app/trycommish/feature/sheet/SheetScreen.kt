package app.trycommish.feature.sheet

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.AppWords
import app.trycommish.core.sheet.SheetExport
import app.trycommish.core.sheet.SheetImport
import app.trycommish.core.sheet.SheetLine
import app.trycommish.core.sheet.SheetModel
import app.trycommish.core.sheet.SheetPhase
import app.trycommish.core.sheet.SheetUi
import app.trycommish.core.sheet.SheetWords
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.board.BoardPin
import app.trycommish.feature.boxscore.ChipRow
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.ScreenFailed

/** What the screen draws from: the view model's state, the sheet as drawn at the clock, the format's chip
 * and the stamp over a saved copy. */
class SheetView(
    val ui: SheetUi,
    val model: SheetModel?,
    val formatLabel: String,
    val stamp: String?,
)

/** What the screen's controls do: the rows', the panels', a chip, the tools, a pull and the pinned verb. */
class SheetActions(
    val row: SheetRowActions = SheetRowActions(),
    val panels: SheetPanelActions = SheetPanelActions(),
    val choose: (String?) -> Unit = {},
    val export: () -> Unit = {},
    val refresh: () -> Unit = {},
    val openMock: () -> Unit = {},
)

private val SPINNER = 16.dp
private const val DISPLAY_SCALE = Tokens.Type.display / Tokens.Type.head

/** The one verb, a mock draft, pinned above the bar while the sheet has rows and no panel is open. */
private fun pinned(view: SheetView): Boolean = (view.model?.players ?: 0) > 0 && view.ui.importing == SheetImport.Closed

/**
 * The cheat sheet as the view model holds it (the iOS CheatSheetView): the sheet scrolling under the one
 * verb pinned above the bar; a pull reads again; a row's face and name open the player sheet. The screen
 * decides nothing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SheetScreen(
    view: SheetView,
    refreshing: Boolean,
    actions: SheetActions,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxSize().background(c.bg)) {
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = actions.refresh, modifier = Modifier.weight(1f)) {
            when (val phase = view.ui.phase) {
                SheetPhase.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                SheetPhase.SignedOut -> ScreenFailed(AppWords.signedOut, null)
                is SheetPhase.Failed -> ScreenFailed(phase.message, actions.refresh)
                SheetPhase.Ready -> LazyColumn(Modifier.fillMaxSize().imePadding()) { sheet(view, actions) }
            }
        }
        if (view.ui.phase == SheetPhase.Ready && pinned(view)) BoardPin(Words.PageVerb.mock, actions.openMock)
    }
}

/** The sheet top to bottom as the web's page draws it at 390 (SheetPage.svelte), as a lazy list's items. */
private fun LazyListScope.sheet(
    view: SheetView,
    actions: SheetActions,
) {
    item("head") { SheetHead(view, actions, Modifier.padding(top = Tokens.Space.s4.dp)) }
    if (view.ui.importing != SheetImport.Closed) item("import") { Spaced { SheetImportPanel(view.ui, actions.panels, live = true) } }
    val model = view.model
    if (model != null && model.players > 0) {
        item("chips") { SheetChips(model, actions.choose, still = false) }
        items(model.lines, key = { it.id }) { RowAndEditor(it, view, model, actions, live = true) }
    } else if (view.ui.importing == SheetImport.Closed) {
        item("empty") { Spaced { SheetEmpty(view.ui, view.formatLabel, actions.panels) } }
    }
    item("foot") { Box(Modifier.padding(bottom = Tokens.Space.s4.dp)) }
}

/** The sheet drawn whole with no scrolling and its fields at rest: a snapshot's, its first `rows` rows. */
@Composable
fun SheetPage(
    view: SheetView,
    rows: Int,
    modifier: Modifier = Modifier,
) {
    val actions = SheetActions()
    Column(modifier.fillMaxWidth().background(CommishTheme.colors.bg).padding(vertical = Tokens.Space.s4.dp)) {
        SheetHead(view, actions)
        if (view.ui.importing != SheetImport.Closed) Spaced { SheetImportPanel(view.ui, actions.panels, live = false) }
        val model = view.model
        if (model != null && model.players > 0) {
            SheetChips(model, actions.choose, still = true)
            model.lines.take(rows).forEach { RowAndEditor(it, view, model, actions, live = false) }
        } else if (view.ui.importing == SheetImport.Closed) {
            Spaced { SheetEmpty(view.ui, view.formatLabel, actions.panels) }
        }
    }
}

@Composable
private fun Spaced(content: @Composable () -> Unit) {
    Box(Modifier.padding(top = Tokens.Space.s3.dp)) { content() }
}

@Composable
private fun RowAndEditor(
    line: SheetLine,
    view: SheetView,
    model: SheetModel,
    actions: SheetActions,
    live: Boolean,
) {
    val open = view.ui.openRow == line.id
    Column {
        SheetRowView(line, open, actions.row)
        if (open) SheetEditor(line, model.ownTags, actions.row, live)
    }
}

/** The head: the name in the number face, its format, count and save, the stamp over a saved copy, and the
 * tools once the sheet has rows. */
@Composable
private fun SheetHead(
    view: SheetView,
    actions: SheetActions,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(
        modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) {
        Text(
            (view.model?.name ?: SheetWords.defaultName).uppercase(),
            style = Faces.head.copy(fontSize = Faces.head.fontSize * DISPLAY_SCALE),
            color = c.ink,
            maxLines = 2,
            modifier = Modifier.semantics { heading() },
        )
        Text(view.model?.line ?: view.formatLabel, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink2)
        view.stamp?.let { Text(it, style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em), color = c.accentText) }
        if ((view.model?.players ?: 0) > 0) Tools(view, actions)
    }
}

/** Import and the export (SheetPage.svelte sheetTools): Import held while a row's write is on its way, the
 * export while an edit is unsaved; the export's state beside it. */
@Composable
private fun Tools(
    view: SheetView,
    actions: SheetActions,
) {
    val ui = view.ui
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        QuietButton(SheetWords.importTool, enabled = ui.canImport, onClick = actions.panels.openImport)
        QuietButton(SheetWords.exportTool, enabled = !ui.unsaved, onClick = actions.export)
        if (ui.export == SheetExport.Writing) CircularProgressIndicator(Modifier.size(SPINNER), strokeWidth = 2.dp)
    }
    (ui.export as? SheetExport.Failed)?.let {
        Text(it.reason, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = CommishTheme.colors.lossInk)
    }
}

/** The position chips over the rows and the count under a filter. */
@Composable
private fun SheetChips(
    model: SheetModel,
    choose: (String?) -> Unit,
    still: Boolean,
) {
    val pressed = model.positions.firstOrNull { it.pressed }?.value
    Column(
        Modifier.padding(top = Tokens.Space.s3.dp, bottom = Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) {
            ChipRow(model.positions.map { it.label to it.value }, pressed, choose, still = still)
        }
        model.shown?.let {
            Text(
                it.uppercase(),
                style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em, fontSize = Tokens.Type.xs.sp),
                color = CommishTheme.colors.ink3,
                modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp),
            )
        }
    }
}
