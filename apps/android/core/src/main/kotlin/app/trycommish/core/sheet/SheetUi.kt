package app.trycommish.core.sheet

import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.SheetDetail
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import java.time.Instant
import java.time.ZoneId

/** Where the screen is: reading, drawing the sheet (or its empty state), a sentence for why nothing can be
 * drawn, or signed out because the API no longer takes the device's token. */
sealed interface SheetPhase {
    data object Loading : SheetPhase

    data object Ready : SheetPhase

    data class Failed(
        val message: String,
    ) : SheetPhase

    data object SignedOut : SheetPhase
}

/**
 * Everything the Sheet screen draws from, one value the view model replaces whole: the account's sheet as
 * last read or written (null while it has none), when it was read and whether that read is a saved copy,
 * the last write's state, the position chosen, the row whose editor is open, the empty sheet's board and
 * start, the import panel and its paste box, the export, the unsaved edits by player id, and by player id
 * what the phone had where the account's copy won a conflict.
 */
data class SheetUi(
    val phase: SheetPhase = SheetPhase.Loading,
    val detail: SheetDetail? = null,
    val stamp: Instant? = null,
    val stale: Boolean = false,
    val save: SheetSave = SheetSave.Idle,
    val position: String? = null,
    val openRow: String? = null,
    val board: SheetBoard = SheetBoard.Loading,
    val starting: Boolean = false,
    val startProblem: String? = null,
    val importing: SheetImport = SheetImport.Closed,
    val pasted: String = "",
    val export: SheetExport = SheetExport.Idle,
    val edits: Map<String, SheetEdit> = emptyMap(),
    val notices: Map<String, List<String>> = emptyMap(),
) {
    /** The rows as the account holds them with the phone's unsaved edits laid over them. */
    val entries: List<SheetEntry>
        get() =
            detail?.rows.orEmpty().mapNotNull { row ->
                val entry = SheetEntry.of(row)
                edits[entry.id]?.over(entry) ?: entry.takeIf { entry.id !in edits }
            }

    /** Whether a write is held: an edit not yet on the account, which an export would leave out. */
    val unsaved: Boolean get() = edits.isNotEmpty()

    /** Import is closed while a row's write is on its way, whose answer would land over the imported rows. */
    val canImport: Boolean get() = save != SheetSave.Saving

    /** The import panel's verb: "Replace my sheet" over rows, else "Use this sheet". */
    val importVerb: String get() = if (entries.isEmpty()) SheetWords.use else SheetWords.replace

    /** His row as the account holds it. */
    fun accountRow(id: String): SheetEntry? = detail?.rows?.firstOrNull { it.playerId == id }?.let(SheetEntry::of)

    /** The sheet's format chip: its own, else the one an empty sheet starts in. */
    fun formatLabel(start: BoardFormat): String = detail?.format?.let(SheetWords::formatLabel) ?: SheetWords.formatLabel(start).orEmpty()

    /** "Last read Sat 12:00 pm" while the sheet shown is a saved copy. */
    fun stampWords(zone: ZoneId): String? = stamp?.takeIf { stale }?.let { "${AppWords.lastRead} ${Format.weekdayTime(it, zone)}" }

    /** The sheet as the screen draws it; null while the account has no sheet. */
    fun model(
        start: BoardFormat,
        now: Instant,
        zone: ZoneId,
    ): SheetModel? {
        val sheet = detail ?: return null
        val entries = entries
        val status = SheetWords.status(save, instantOrNull(sheet.updatedAt), stamp ?: now, entries.size, zone)
        val line = SheetWords.headLine(formatLabel(start), entries.size, status)
        return SheetModel.of(sheet.name, line, entries, rowSaves, position, notices)
    }

    /** The first players our board would put on an empty sheet (EmptySheet.svelte PREVIEWED). */
    val preview: List<SheetLine>
        get() =
            (board as? SheetBoard.Ready)?.entries.orEmpty().take(PREVIEWED).mapIndexed {
                index,
                entry,
                ->
                SheetLine.of(entry, index + 1)
            }

    /** Each unsaved row's state: on its way, or not saved with the reason. */
    private val rowSaves: Map<String, RowSave>
        get() = edits.mapValues { (save as? SheetSave.Failed)?.let { RowSave.Unsaved(it.reason) } ?: RowSave.Saving }

    /** The sheet shown as read or written at `stamp`. */
    fun shown(
        sheet: SheetDetail?,
        stamp: Instant,
        stale: Boolean,
    ): SheetUi = copy(detail = sheet, stamp = stamp, stale = stale, phase = SheetPhase.Ready)

    /**
     * The unsaved edits laid over a sheet read afresh (merge.ts mergeRow): a row taken off on the account
     * stays off; a row the phone took off stays off; each field the phone changed keeps the phone's value
     * unless the account's changed too, when the account's stands and the row says what the phone had.
     * Each edit left is then held against the fresh row.
     */
    fun merged(fresh: SheetDetail?): SheetUi {
        val rows =
            fresh
                ?.rows
                .orEmpty()
                .distinctBy { it.playerId }
                .associate { it.playerId to SheetEntry.of(it) }
        val start = Pair(emptyMap<String, SheetEdit>(), notices)
        val (next, said) =
            edits.entries.fold(start) { (held, told), (id, edit) ->
                val server = rows[id] ?: return@fold held to told
                val local = edit.local ?: return@fold (held + (id to SheetEdit(server, null))) to told
                val merged = SheetMerge.row(edit.base, local, server)
                val notices = if (merged.notices.isEmpty()) told else told + (id to merged.notices)
                val moved = merged.entry.tags != server.tags || merged.entry.note != server.note
                (if (moved) held + (id to SheetEdit(server, merged.entry)) else held) to notices
            }
        return copy(edits = next, notices = said)
    }

    private companion object {
        const val PREVIEWED = 5
    }
}
