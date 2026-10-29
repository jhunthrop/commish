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
 * twelve named and the rest counted, and, when it read no player, what became of the sheet, what a list that
 * reads looks like when no skipped row says why ([shape]; for a CSV, that it held a header alone), and that its
 * verb ("Fix the list") goes back to the box with the text kept so it can be fixed ([again]). A pasted list's
 * skipped rows repeat what was typed on them. */
data class SheetImportWords(
    val read: String,
    val skipped: String?,
    val rows: List<String>,
    val kept: String?,
    val shape: String? = null,
    val again: Boolean = false,
) {
    /** The result's verb: "Fix the list" when nothing was read and the box opens again with the text kept,
     * else Done. */
    val verb: String get() = if (again) SheetWords.fixList else SheetWords.done

    companion object {
        /** [list] is the pasted list the account read, whose rows a skipped row repeats; null for a CSV, whose rows
         * the account numbers by record, not by the text's lines. */
        fun of(
            count: Int,
            skips: List<SheetCsv.Skip>,
            kept: String?,
            list: String? = null,
        ): SheetImportWords {
            val rows = list?.split("\n").orEmpty()
            val named =
                skips.take(SheetWords.SKIPS_SHOWN).map { skip ->
                    typed(rows, skip.row)?.let { SheetWords.skip(skip.row, it, skip.reason) } ?: SheetWords.skip(skip.row, skip.reason)
                }
            val rest = skips.size - named.size
            return SheetImportWords(
                read = SheetWords.read(count),
                skipped = if (skips.isEmpty()) null else SheetWords.skipped(skips.size),
                rows = named + if (rest > 0) listOf(SheetWords.more(rest)) else emptyList(),
                kept = kept,
                shape =
                    when {
                        count > 0 || skips.isNotEmpty() -> null
                        list == null -> SheetWords.headerOnly
                        else -> SheetWords.listShape
                    },
                again = count == 0,
            )
        }

        /** The account's rank on a list's row (paste.ts LEADING_RANK). */
        private val leadingRank = Regex("""(?U)^\d+\s*[.)\-:]?\s+""")

        /** What was typed on row [line] (rows split at each line break, as the account numbers them), its rank set
         * aside, trimmed and cut to [SheetWords.TYPED_SHOWN]; null when the row is not there or holds nothing. */
        private fun typed(
            rows: List<String>,
            line: Int,
        ): String? =
            rows
                .getOrNull(line - 1)
                ?.trim { it.isWhitespace() || it == '\uFEFF' }
                ?.replace(leadingRank, "")
                ?.take(SheetWords.TYPED_SHOWN)
                ?.trimEnd()
                ?.ifEmpty { null }
    }
}

/** A CSV chosen from the phone's files: the name the picker gives it and the text it read as. */
data class ChosenFile(
    val name: String,
    val text: String,
)

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
