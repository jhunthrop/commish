package app.trycommish.core.sheet

import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.SheetImportResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// The Sheet's files (the iOS CheatSheetViewModel+Files): our board for an empty sheet and the start from it,
// the CSV import read on the phone first, and the export handed to the share sheet.

/** Our board for the empty sheet's format. */
internal suspend fun SheetViewModel.readBoard() {
    update { it.copy(board = SheetBoard.Loading) }
    val board =
        try {
            SheetStart.rows(deps.run, ui.value.start)?.let { SheetBoard.Ready(it) } ?: SheetBoard.None
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
            return
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            SheetBoard.Failed
        }
    update { it.copy(board = board) }
}

/** Starts the account's sheet from our board, every row of it. */
fun SheetViewModel.start(): Job? {
    val board = ui.value.board as? SheetBoard.Ready ?: return null
    if (ui.value.starting) return null
    update { it.copy(starting = true, startProblem = null) }
    return viewModelScope.launch {
        try {
            val made = reads().create(SheetWords.defaultName, ui.value.start, board.entries.map { it.input })
            update { it.shown(made, deps.clock.now(), false) }
            keep()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            update { it.copy(startProblem = SheetViewModel.reason(e)) }
        }
        update { it.copy(starting = false) }
    }
}

// Import.

/** The import panel opened; not while a row's write is on its way, whose answer would land over the
 * imported rows. */
fun SheetViewModel.openImport() {
    if (ui.value.canImport) update { it.copy(importing = SheetImport.Open()) }
}

fun SheetViewModel.closeImport() {
    if (ui.value.importing != SheetImport.Sending) update { it.copy(importing = SheetImport.Closed, pasted = "", chosen = null) }
}

/** The paste box as typed: the last way in is the one the verb sends, so a chosen file is let go. */
fun SheetViewModel.paste(text: String) = update { it.copy(pasted = text, chosen = null) }

/** A chosen file read and held under its name, which the panel says beside the button (FilePick.svelte);
 * the verb sends its text, which never fills the paste box. Refused past 1 MB (files.ts readCsvFile) or
 * when it is not UTF-8 text. */
fun SheetViewModel.chose(
    file: ByteArray,
    name: String,
) {
    if (file.size > SheetLimits.CSV_BYTES) {
        update { it.copy(importing = SheetImport.Open(SheetWords.tooLarge), chosen = null) }
        return
    }
    val text = utf8(file)
    update {
        if (text == null) {
            it.copy(importing = SheetImport.Open(SheetWords.unreadable), chosen = null)
        } else {
            it.copy(chosen = ChosenFile(name, text), importing = SheetImport.Open())
        }
    }
}

private fun utf8(bytes: ByteArray): String? =
    try {
        Charsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (e: CharacterCodingException) {
        null
    }

/**
 * A pasted or chosen text sent to the account's import, which replaces the rows; an empty account's sheet is
 * made for it first. A list of names (a first line that does not name player_id) goes as it is, typed
 * text/plain, and the account reads it against our board. A CSV is read on the phone first, as the web's
 * panel reads it: a header that cannot be used is refused with its sentence and a file that reads no player
 * with what it skipped, and nothing is sent or made. An import the account refuses because it read no player
 * is shown as the import's result in the account's sentence, and the sheet read again as the account holds
 * it; nothing is written back.
 */
fun SheetViewModel.importText(text: String): Job? {
    if (text.toByteArray(Charsets.UTF_8).size > SheetLimits.CSV_BYTES) {
        update { it.copy(importing = SheetImport.Open(SheetWords.tooLarge)) }
        return null
    }
    val ui = ui.value
    if (text.isBlank() || ui.importing == SheetImport.Sending || !ui.canImport) return null
    if (!SheetCsv.looksLikeCsv(text)) return sending(SheetImportBody.Names(text))
    val read =
        try {
            SheetCsv.read(text)
        } catch (e: SheetCsv.HeaderError) {
            update { it.copy(importing = SheetImport.Open(e.message)) }
            return null
        }
    if (read.ids.isEmpty()) {
        update { it.copy(importing = SheetImport.Done(SheetImportWords.of(0, read.skipped, SheetWords.keptAsItWas))) }
        return null
    }
    return sending(SheetImportBody.Csv(text))
}

private fun SheetViewModel.sending(body: SheetImportBody): Job {
    update { it.copy(importing = SheetImport.Sending) }
    return viewModelScope.launch { send(body) }
}

/** The code of the import's 400 (api/internal/sheets/handler.go, WriteInvalid): the body read to no player, or
 * its first line was a header the import cannot use, and the sheet is as it was. */
private const val READ_NOTHING = "invalid"

private suspend fun SheetViewModel.send(body: SheetImportBody) {
    var made: String? = null
    try {
        val id =
            ui.value.detail
                ?.id
                ?.toString() ?: reads().create(SheetWords.defaultName, ui.value.start, emptyList()).let { sheet ->
                made = sheet.id.toString()
                update { it.shown(sheet, deps.clock.now(), false) }
                sheet.id.toString()
            }
        val result = reads().import(id, body)
        update {
            it
                .copy(
                    edits = emptyMap(),
                    notices = emptyMap(),
                    save = SheetSave.Idle,
                    pasted = "",
                    chosen = null,
                    importing = SheetImport.Done(words(result)),
                ).shown(result.sheet, deps.clock.now(), false)
        }
        keep()
        return
    } catch (e: CancellationException) {
        throw e
    } catch (e: Unauthorized) {
        signOut()
        return
    } catch (e: ApiFailure) {
        val said = SheetViewModel.reason(e)
        val importing = if (e.code == READ_NOTHING) SheetImport.Done(refused(said)) else SheetImport.Open(said)
        update { it.copy(importing = importing) }
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        update { it.copy(importing = SheetImport.Open(SheetViewModel.reason(e))) }
    }
    reread(made)
}

/** The account's answer, its reasons said with the phone's word for a line ([SheetWords.rowWords]). */
private fun words(result: SheetImportResult): SheetImportWords =
    SheetImportWords.of(result.imported, result.skipped.map { SheetCsv.Skip(it.line, SheetWords.rowWords(it.reason)) }, null)

/** The account's refusal of a body that read to no player, in its own sentence: the sheet is as it was. */
private fun refused(sentence: String): SheetImportWords = SheetImportWords.of(0, emptyList(), SheetWords.rowWords(sentence))

/** After an import that did not land: the sheet made for it taken off, else the account's sheet read again,
 * so the phone shows what the account holds (a failed delete leaves the made sheet shown, as it is). */
private suspend fun SheetViewModel.reread(made: String?) {
    if (made == null) {
        update { it.copy(save = SheetSave.Idle) }
        load().join()
        return
    }
    try {
        reads().delete(made)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Unauthorized) {
        signOut()
        return
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        return
    }
    update { it.shown(null, deps.clock.now(), false) }
    keep()
}

// Export.

/** The account's sheet written as the CSV file (the web's format byte for byte: the API's EncodeCSV is held
 * to the web's encodeCsv), fetched and kept on the phone under the API's file name for the share sheet.
 * Held while an edit is not saved, which the account's file would leave out. */
fun SheetViewModel.exportFile(): Job? {
    val ui = ui.value
    val id = ui.detail?.id?.toString() ?: return null
    if (ui.unsaved || ui.export == SheetExport.Writing) return null
    update { it.copy(export = SheetExport.Writing) }
    return viewModelScope.launch {
        val export =
            try {
                val link = reads().export(id)
                val bytes = reads().download(link.url)
                kept(File(link.fileName).name.ifEmpty { EXPORT_NAME }, bytes)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                signOut()
                SheetExport.Idle
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                SheetExport.Failed(SheetViewModel.reason(e))
            }
        update { it.copy(export = export) }
    }
}

/** The export's bytes kept on the phone for the share sheet, one file at a time (an earlier export, perhaps
 * another account's, is let go); a write the phone refuses (no room, the folder gone) says so in its own
 * words, never as no connection. */
private suspend fun SheetViewModel.kept(
    name: String,
    bytes: ByteArray,
): SheetExport =
    try {
        val file = File(deps.exports, name)
        withContext(deps.io) {
            deps.exports.listFiles()?.forEach { it.delete() }
            deps.exports.mkdirs()
            file.writeBytes(bytes)
        }
        SheetExport.Ready(file)
    } catch (e: IOException) {
        SheetExport.Failed(SheetWords.notKept)
    }

/** The share sheet closed. */
fun SheetViewModel.finishExport() = update { it.copy(export = SheetExport.Idle) }

/** The file's name where the API names none. */
private const val EXPORT_NAME = "sheet.csv"
