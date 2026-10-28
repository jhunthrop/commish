package app.trycommish.core.sheet

import java.io.File

/** Where the sheet's last write stands, as the status line says it (status.ts SyncStatus, the states a
 * phone that holds nothing of its own can be in). */
sealed interface SheetSave {
    /** Nothing written since the sheet was read. */
    data object Idle : SheetSave

    data object Saving : SheetSave

    data object Saved : SheetSave

    /** The write did not land: the reason in words, and whether the account's copy changed since it was
     * read. */
    data class Failed(
        val reason: String,
        val changed: Boolean,
    ) : SheetSave
}

/** A row's save as the row says it: nothing to say, on its way, or not saved with the reason. */
sealed interface RowSave {
    data object Saved : RowSave

    data object Saving : RowSave

    data class Unsaved(
        val reason: String,
    ) : RowSave

    /** The line under the row, null once saved. */
    val words: String?
        get() =
            when (this) {
                Saved -> null
                Saving -> SheetWords.rowSaving
                is Unsaved -> SheetWords.rowUnsaved(reason)
            }
}

/** Our board for an empty sheet (our-board.svelte.ts OurBoardState): on its way, here, not out for the
 * format, or failed to load. */
sealed interface SheetBoard {
    data object Loading : SheetBoard

    data class Ready(
        val entries: List<SheetEntry>,
    ) : SheetBoard

    data object None : SheetBoard

    data object Failed : SheetBoard
}

/** What an import says once it is in or refused: the players read, the rows skipped and why, the first
 * twelve named and the rest counted, and, when it read no player, what became of the sheet. */
data class SheetImportWords(
    val read: String,
    val skipped: String?,
    val rows: List<String>,
    val kept: String?,
) {
    companion object {
        fun of(
            count: Int,
            skips: List<SheetCsv.Skip>,
            kept: String?,
        ): SheetImportWords {
            val named = skips.take(SheetWords.SKIPS_SHOWN).map { SheetWords.skip(it.row, it.reason) }
            val rest = skips.size - named.size
            return SheetImportWords(
                read = SheetWords.read(count),
                skipped = if (skips.isEmpty()) null else SheetWords.skipped(skips.size),
                rows = named + if (rest > 0) listOf(SheetWords.more(rest)) else emptyList(),
                kept = kept,
            )
        }
    }
}

/** The import panel (ImportPanel.svelte): closed, open with what was refused, the CSV on its way, or what
 * the import read and skipped. */
sealed interface SheetImport {
    data object Closed : SheetImport

    data class Open(
        val problem: String? = null,
    ) : SheetImport

    data object Sending : SheetImport

    data class Done(
        val words: SheetImportWords,
    ) : SheetImport
}

/** The export (files.ts downloadCsv, handed to the share sheet): writing, the file ready to share, or why
 * it is not. */
sealed interface SheetExport {
    data object Idle : SheetExport

    data object Writing : SheetExport

    data class Ready(
        val file: File,
    ) : SheetExport

    data class Failed(
        val reason: String,
    ) : SheetExport
}
