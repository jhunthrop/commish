package app.trycommish.feature.sheet

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.trycommish.core.sheet.SheetBoard
import app.trycommish.core.sheet.SheetImport
import app.trycommish.core.sheet.SheetImportWords
import app.trycommish.core.sheet.SheetUi
import app.trycommish.core.sheet.SheetWords
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.feature.boxscore.HEAD_TRACKING

/** What the empty sheet and the import panel do. */
class SheetPanelActions(
    val start: () -> Unit = {},
    val openImport: () -> Unit = {},
    val closeImport: () -> Unit = {},
    val chooseFile: () -> Unit = {},
    val paste: (String) -> Unit = {},
    val importText: (String) -> Unit = {},
)

private val PASTE_LINES = 4..8

/** A panel on the surface (the empty sheet, the import), its corners the medium radius. */
@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Tokens.Space.s3.dp)
            .background(CommishTheme.colors.surface, RoundedCornerShape(Tokens.Radius.md.dp))
            .padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) { content() }
}

@Composable
private fun PanelHead(words: String) {
    Text(
        words,
        style = Faces.section.copy(fontWeight = FontWeight.Bold),
        color = CommishTheme.colors.ink,
        modifier = Modifier.semantics { heading() },
    )
}

/** A field's label over it: uppercase, tracked, the third ink. */
@Composable
private fun Label(words: String) {
    Text(words.uppercase(), style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em), color = CommishTheme.colors.ink3)
}

@Composable
private fun Problem(words: String) {
    Text(words, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = CommishTheme.colors.lossInk)
}

/**
 * A sheet with no one on it (EmptySheet.svelte, the iOS SheetEmptyView): our board's first players with
 * their faces, so the verb shows what it does before it is pressed, then Start from our board, or Import a
 * sheet where we have no board for the format.
 */
@Composable
internal fun SheetEmpty(
    ui: SheetUi,
    formatLabel: String,
    actions: SheetPanelActions,
) {
    Panel {
        PanelHead(SheetWords.startHead)
        val lead =
            when (ui.board) {
                SheetBoard.None -> SheetWords.boardNone(formatLabel)
                SheetBoard.Failed -> SheetWords.boardFailed
                SheetBoard.Loading, is SheetBoard.Ready -> SheetWords.boardLead(formatLabel)
            }
        Label(lead)
        Column(Modifier.clip(RoundedCornerShape(Tokens.Radius.md.dp))) {
            ui.preview.forEach { SheetRowView(it, open = false, actions = SheetRowActions(), editable = false) }
        }
        if (ui.board == SheetBoard.Loading) {
            CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
        }
        if (ui.board == SheetBoard.None) {
            Verb(SheetWords.importSheet, onClick = actions.openImport)
        } else {
            Verb(SheetWords.start, enabled = !ui.starting && ui.board != SheetBoard.Loading, onClick = actions.start)
            QuietButton(SheetWords.importSheet, Modifier.align(Alignment.CenterHorizontally), onClick = actions.openImport)
        }
        ui.startProblem?.let { Problem(it) }
    }
}

/**
 * The import panel (ImportPanel.svelte, the iOS SheetImportView): a CSV file or a pasted one, what was
 * refused, what the import read and skipped by row, the verb that replaces the sheet and Cancel. `live`
 * false draws the paste box at rest.
 */
@Composable
internal fun SheetImportPanel(
    ui: SheetUi,
    actions: SheetPanelActions,
    live: Boolean,
) {
    Panel {
        PanelHead(SheetWords.importHead)
        when (val importing = ui.importing) {
            is SheetImport.Done -> {
                ImportResult(importing.words)
                Verb(SheetWords.done, onClick = actions.closeImport)
            }
            else -> {
                Label(SheetWords.fileLabel)
                ChosenLine(ui, actions.chooseFile)
                Label(SheetWords.pasteLabel)
                SheetField(
                    ui.pasted,
                    SheetWords.pastePlaceholder,
                    live,
                    Modifier.fillMaxWidth(),
                    lines = PASTE_LINES,
                    style = Faces.small.copy(fontFamily = FontFamily.Monospace),
                    change = actions.paste,
                )
                (importing as? SheetImport.Open)?.problem?.let { Problem(it) }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
                    val sending = importing == SheetImport.Sending
                    Verb(
                        ui.importVerb,
                        Modifier.weight(1f),
                        enabled = !sending && ui.importText.isNotBlank(),
                    ) { actions.importText(ui.importText) }
                    QuietButton(SheetWords.cancel, onClick = actions.closeImport)
                }
            }
        }
    }
}

/** The file's way in (FilePick.svelte): the button, and beside it the chosen file's name, or that none is
 * chosen yet. A chosen file's text is never put in the paste box. */
@Composable
private fun ChosenLine(
    ui: SheetUi,
    choose: () -> Unit,
) {
    val c = CommishTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        QuietButton(SheetWords.chooseFile, onClick = choose)
        val chosen = ui.chosen
        if (chosen == null) {
            Label(SheetWords.noFile)
        } else {
            Text(
                chosen.name,
                style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
                color = c.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** What the import read: the players, what became of the sheet when it read none, the rows skipped. */
@Composable
private fun ImportResult(words: SheetImportWords) {
    val c = CommishTheme.colors
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        Text(words.read, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink)
        words.kept?.let { Problem(it) }
        words.skipped?.let { skipped ->
            Label(skipped)
            words.rows.forEach { Text(it, style = Faces.small, color = c.ink2) }
        }
    }
}
