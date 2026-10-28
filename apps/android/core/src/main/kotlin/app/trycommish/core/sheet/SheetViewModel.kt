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
    /** The format an empty sheet starts in: the selected league's, else the account's, else PPR. */
    val format: BoardFormat,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    internal val mutableUi = MutableStateFlow(SheetUi())
    private val mutableRefreshing = MutableStateFlow(false)

    /** The edits the write on its way carries. */
    private var sending: Map<String, SheetEdit> = emptyMap()

    val ui: StateFlow<SheetUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** The sheet as the screen draws it at the clock; null while the account has no sheet. */
    fun model(ui: SheetUi = this.ui.value): SheetModel? = ui.model(format, deps.clock.now(), deps.zone)

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

    // Edits.

    /** His note set, or cleared when empty (model.ts setNote); nothing when it reads the same. */
    fun setNote(
        id: String,
        text: String,
    ): Job? {
        val entry = ui.value.entries.firstOrNull { it.id == id } ?: return null
        val note = text.trim().take(SheetLimits.NOTE).ifEmpty { null }
        if (note == entry.note) return null
        return annotate(entry, entry.tags, note)
    }

    /** A tap on one of his tags; false when his row is full and the tag cannot go on. */
    fun toggleTag(
        id: String,
        tag: String,
    ): Boolean {
        val entry = ui.value.entries.firstOrNull { it.id == id } ?: return true
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
        val entry = ui.value.entries.firstOrNull { it.id == id } ?: return null
        if (SheetTags.has(entry.tags, tag)) return null
        return if (toggleTag(id, tag)) null else SheetWords.full
    }

    /** His row taken off the sheet. */
    fun remove(id: String): Job? {
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
            ui.copy(notices = ui.notices - entry.id, edits = edits)
        }
        return viewModelScope.launch { write() }
    }

    /** Every row written in one request guarded by the sheet's stamp; an edit made while it is on its way is
     * written after it. */
    internal suspend fun write() {
        val ui = ui.value
        val sheet = ui.detail ?: return
        if (ui.edits.isEmpty() || ui.save == SheetSave.Saving) return
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
     * device while the edit waited, signal or not, so the edits are merged into it field by field first. */
    fun retry(): Job? {
        val failed = ui.value.save as? SheetSave.Failed ?: return null
        val id =
            ui.value.detail
                ?.id
                ?.toString() ?: return null
        return viewModelScope.launch {
            try {
                val fresh = reads().sheet(id)
                update { it.merged(fresh).shown(fresh, deps.clock.now(), false) }
                keep()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                signOut()
                return@launch
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                update { it.copy(save = SheetSave.Failed(reason(e), failed.changed)) }
                return@launch
            }
            update { it.copy(save = SheetSave.Idle) }
            write()
        }
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
