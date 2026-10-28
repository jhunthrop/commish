package app.trycommish.core.sheet

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.SheetDetail
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunReads
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import java.io.File
import java.io.IOException
import java.time.ZoneId

/** What the view model reads and writes through, and where: the account's sheets, the run (our board for
 * an empty sheet), the cache, the clock and the member's zone, the folder an export's file is written to
 * before the share sheet takes it, and the dispatcher that writes it. */
class SheetDeps(
    val reads: SheetReads,
    val run: RunReads,
    val cache: Cache,
    val clock: Clock,
    val zone: ZoneId,
    val exports: File,
    val io: CoroutineDispatcher = Dispatchers.IO,
)

/**
 * The cheat sheet's view model (web/src/lib/sheet/store.svelte.ts and sync.ts, the iOS CheatSheetViewModel,
 * for a phone that keeps nothing of its own): the account's most recently changed sheet, the saved answer at
 * once and then the API's; a note, a tag or a row taken off is an edit held on the phone and written with
 * every row in one request guarded by the sheet's stamp. An edit never says saved before the account
 * answers: while it is on its way its row says so, and when the request fails (no signal, the sheet changed
 * on another device) its row says it is not saved and why, and a retry reads the sheet again and writes the
 * edit over it field by field (merge.ts). The screen decides nothing. A 401 anywhere signs the device out.
 */
class SheetViewModel(
    internal val deps: SheetDeps,
    /** The format an empty sheet starts in at first; the tab moves it as the league shown changes. */
    start: BoardFormat,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    internal val mutableUi = MutableStateFlow(SheetUi(start = start))
    private val mutableRefreshing = MutableStateFlow(false)

    /** The edits the write on its way carries. */
    private var sending: Map<String, SheetEdit> = emptyMap()

    val ui: StateFlow<SheetUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The sheet as the screen draws it at the clock; null while the account has no sheet. */
    fun model(ui: SheetUi = this.ui.value): SheetModel? = ui.model(deps.clock.now(), deps.zone)

    /** The format an empty sheet starts in, as the league shown sets it: a value read only for that start
     * (iOS reads it the same way), so the sheet, its unsaved edits and the open row stay as they are; an empty
     * sheet's preview reads our board in the new format. */
    fun startIn(format: BoardFormat): Job? {
        val ui = ui.value
        if (ui.start == format) return null
        update { it.copy(start = format) }
        if (ui.phase != SheetPhase.Ready || ui.detail != null) return null
        return viewModelScope.launch { readBoard() }
    }

    /** What the cache keeps: the sheet, or none when the account has none. */
    @Serializable
    internal data class Saved(
        val detail: SheetDetail? = null,
    )

    // Reads.

    /** The saved sheet at once on the first open, then the account's most recently changed; a failed read
     * keeps the sheet shown, dated; a refused token signs out. An empty account reads our board for the
     * empty sheet's preview. */
    fun load(): Job =
        viewModelScope.launch {
            mutableRefreshing.value = true
            try {
                read()
            } finally {
                mutableRefreshing.value = false
            }
        }

    private suspend fun read() {
        if (ui.value.phase == SheetPhase.Loading) {
            deps.cache.read(KEY)?.let { kept -> decoded(kept.body)?.let { saved -> update { it.shown(saved.detail, kept.stamp, true) } } }
        }
        try {
            val fresh = reads().sheets().firstOrNull()?.let { reads().sheet(it.id.toString()) }
            // A write on its way answers with the account's sheet itself; the read is left to it, so its edits
            // are not held against rows it is about to replace and sent a second time.
            if (ui.value.save == SheetSave.Saving) return
            // A slow read passed by a write's answer would step the sheet back.
            if (ui.value.older(fresh)) return
            update { ui ->
                val merged = ui.merged(fresh)
                // Every unsaved edit already on the account (or its row taken off there): nothing is left
                // unsaved, so the head stops saying so.
                val settled = if (merged.edits.isEmpty() && merged.save is SheetSave.Failed) merged.copy(save = SheetSave.Idle) else merged
                settled.shown(fresh, deps.clock.now(), false)
            }
            keep()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
            return
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            update { if (it.phase == SheetPhase.Ready) it.copy(stale = true) else it.copy(phase = SheetPhase.Failed(reason(e))) }
        }
        if (ui.value.phase == SheetPhase.Ready && ui.value.detail == null) readBoard()
    }

    /** The sheet as last read or written, kept for the next open. */
    internal fun keep() {
        val ui = ui.value
        val stamp = ui.stamp ?: return
        deps.cache.write(KEY, Cached(CommishJson.encodeToString(Saved.serializer(), Saved(ui.detail)), stamp))
    }

    // Choices.

    fun choose(position: String?) = update { it.copy(position = position) }

    /** A row's editor opened, or closed when it is the one open. */
    fun toggle(row: String) = update { it.copy(openRow = if (it.openRow == row) null else row) }

    // Edits. The rows are held while an import is on its way: its answer replaces them all.

    /** His row as it is drawn, while the rows can be edited. */
    private fun editable(id: String): SheetEntry? =
        ui.value
            .takeIf { it.canEdit }
            ?.entries
            ?.firstOrNull { it.id == id }

    /** His note set, or cleared when empty (model.ts setNote); nothing when it reads the same. */
    fun setNote(
        id: String,
        text: String,
    ): Job? {
        val entry = editable(id) ?: return null
        val note = text.trim().take(SheetLimits.NOTE).ifEmpty { null }
        if (note == entry.note) return null
        return annotate(entry, entry.tags, note)
    }

    /** A tap on one of his tags; false when his row is full and the tag cannot go on. */
    fun toggleTag(
        id: String,
        tag: String,
    ): Boolean {
        val entry = editable(id) ?: return true
        val tags = SheetTags.toggled(entry.tags, tag) ?: return false
        annotate(entry, tags, entry.note)
        return true
    }

    /** His own tag typed and added: why it cannot be, or null once it is on (RowEditor.svelte addOwn). */
    fun addTag(
        id: String,
        typed: String,
    ): String? {
        val tag = SheetTags.canonical(typed)
        SheetTags.problem(tag)?.let { return it }
        val entry = editable(id) ?: return null
        if (SheetTags.has(entry.tags, tag)) return null
        return if (toggleTag(id, tag)) null else SheetWords.full
    }

    /** His row taken off the sheet. */
    fun remove(id: String): Job? {
        if (!ui.value.canEdit) return null
        update { it.copy(openRow = null) }
        val account = ui.value.accountRow(id) ?: return null
        update { it.copy(notices = it.notices - id, edits = it.edits + (id to SheetEdit(it.edits[id]?.base ?: account, null))) }
        return viewModelScope.launch { write() }
    }

    /** His tags and note as set, held against the account's row the first unsaved edit was made over. */
    private fun annotate(
        entry: SheetEntry,
        tags: List<String>,
        note: String?,
    ): Job? {
        val account = ui.value.accountRow(entry.id) ?: return null
        val same = account.tags == tags && account.note == note
        update { ui ->
            val edits =
                if (same) {
                    ui.edits - entry.id
                } else {
                    ui.edits +
                        (entry.id to SheetEdit(ui.edits[entry.id]?.base ?: account, entry.with(tags, note)))
                }
            // An edit taken back to what the account holds leaves nothing unsaved: the head stops saying so.
            val save = if (edits.isEmpty() && ui.save is SheetSave.Failed) SheetSave.Idle else ui.save
            ui.copy(notices = ui.notices - entry.id, edits = edits, save = save)
        }
        return viewModelScope.launch { write() }
    }

    /** Every row written in one request guarded by the sheet's stamp, one write at a time: an edit made while
     * one is on its way is written after it, and one made while a retry reads the sheet is written by the
     * retry. */
    internal suspend fun write() {
        val ui = ui.value
        val sheet = ui.detail ?: return
        if (ui.edits.isEmpty() || ui.save == SheetSave.Saving || ui.retrying) return
        sending = ui.edits
        update { it.copy(save = SheetSave.Saving) }
        try {
            val fresh = reads().replaceRows(sheet.id.toString(), ui.entries.map { it.input }, sheet.updatedAt)
            // An edit made while the write was on its way is held against the rows just written.
            val written = fresh.rows.distinctBy { it.playerId }.associate { it.playerId to SheetEntry.of(it) }
            val sent = sending
            sending = emptyMap()
            update { now ->
                val held =
                    now.edits.filter { sent[it.key] != it.value }.mapNotNull { (id, edit) ->
                        written[id]?.let {
                            id to
                                SheetEdit(it, edit.local)
                        }
                    }
                now.copy(edits = held.toMap(), save = SheetSave.Saved).shown(fresh, deps.clock.now(), false)
            }
            keep()
            write()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            sending = emptyMap()
            update { it.copy(save = SheetSave.Failed(reason(e), changed(e))) }
        }
    }

    /** The unsaved edits written again over the account's sheet read afresh: it may have changed on another
     * device while the edit waited, signal or not, so the edits are merged into it field by field first. One
     * retry at a time: a second tap while one is on its way does nothing (the screen holds the button). */
    fun retry(): Job? {
        val now = ui.value
        val failed = now.save as? SheetSave.Failed ?: return null
        if (now.retrying) return null
        val id = now.detail?.id?.toString() ?: return null
        update { it.copy(retrying = true) }
        return viewModelScope.launch {
            val read = readForRetry(id, failed)
            update { it.copy(retrying = false) }
            // Nothing to write after a failed read; a write already on its way carries the edits.
            if (!read || ui.value.save == SheetSave.Saving) return@launch
            update { it.copy(save = SheetSave.Idle) }
            write()
        }
    }

    /** The sheet read again and the edits merged into it, unless the read is older than the copy shown;
     * false when the read failed. */
    private suspend fun readForRetry(
        id: String,
        failed: SheetSave.Failed,
    ): Boolean =
        try {
            val fresh = reads().sheet(id)
            if (!ui.value.older(fresh)) {
                update { it.merged(fresh).shown(fresh, deps.clock.now(), false) }
                keep()
            }
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
            false
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            update { it.copy(save = SheetSave.Failed(reason(e), failed.changed)) }
            false
        }

    // Failures and the state.

    internal fun reads(): SheetReads = deps.reads

    internal fun update(change: (SheetUi) -> SheetUi) = mutableUi.update(change)

    internal fun signOut() {
        sessionEnd.signedOut()
        update { it.copy(phase = SheetPhase.SignedOut) }
    }

    private fun decoded(body: String): Saved? =
        try {
            CommishJson.decodeFromString(Saved.serializer(), body)
        } catch (e: SerializationException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }

    internal companion object {
        /** The cache key of the sheet the phone opens. */
        const val KEY = "/sheets/open"

        /** A failure in words: the API's own sentence (the field's where it names one), no connection, else
         * try again. */
        fun reason(e: Exception): String =
            when (e) {
                is Unauthorized -> AppWords.signedOut
                is ApiFailure ->
                    e.fields
                        .toSortedMap()
                        .values
                        .firstOrNull() ?: e.message.ifEmpty { SheetWords.unknown }
                is IOException -> SheetWords.offline
                else -> SheetWords.unknown
            }

        /** The account refused a guarded write: the sheet changed since it was read. */
        fun changed(e: Exception): Boolean = (e as? ApiFailure)?.code == CONFLICT

        private const val CONFLICT = "conflict"
    }
}
