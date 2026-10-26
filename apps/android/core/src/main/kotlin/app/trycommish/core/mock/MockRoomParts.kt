package app.trycommish.core.mock

import app.trycommish.core.board.BoardChip
import app.trycommish.core.companion.CallModel
import app.trycommish.core.companion.CallView
import app.trycommish.core.companion.PoolLine
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.companion.RoomDraft

/** The solo room's bar (SoloBar.svelte): the pick on the clock, the league's cells, and its verbs. */
data class MockBar(
    val head: String,
    val cells: List<MockCell>,
    /** The round Pick for me drafts through, and its words. */
    val autopickTo: Int,
    val autopick: String,
    /** Your latest pick, which Undo takes back; null before your first. */
    val undoPick: Int?,
)

/** A pool row as the room draws it (PoolRow.svelte at 390): the board's line, whether he is queued, and
 * whether he is the marked row, which shows his verbs. */
data class MockPoolLine(
    val line: PoolLine,
    val queued: Boolean,
    val marked: Boolean,
) {
    val id: String get() = line.player.id
}

/** The pool (Pool.svelte): the board's pool model with the queue, the marked row and the verbs. */
data class MockPool(
    val model: PoolModel,
    val rows: List<MockPoolLine>,
    /** The chips: the positions, and on your own draft Queue. */
    val filters: List<String>,
    val empty: String?,
    /** Draft is drawn only while the pick is yours, and pressable while nothing is in flight. */
    val draftShown: Boolean,
    val canDraft: Boolean,
    /** A shared draft's pool: read, never drafted in. */
    val readOnly: Boolean,
) {
    val chips: List<BoardChip<String>> get() = filters.map { BoardChip(it, it, it == model.filter) }

    /** "Show 25 more" under `shown` rows, null when every row is shown. */
    fun more(shown: Int): String? = model.more(shown)
}

/** A shared draft's head (SharedHead.svelte): whose it is, where it stands, its one verb. */
data class MockSharedHead(
    val title: String,
    val line: String,
    val verb: String,
    val note: String,
)

/** What the room shows in the call's place: our call, its frame while the next one is on its way, or the
 * turn with no call coming, which drafts from the pool. */
sealed interface MockCallState {
    data class Call(
        val call: CallModel,
        val playerId: String,
    ) : MockCallState

    data class Reading(
        val call: CallModel,
        val words: String,
    ) : MockCallState

    data class NoCall(
        val verb: String?,
        val playerId: String?,
    ) : MockCallState
}

/** The room's own state beside the API's answer: the chip, the marked row, the pick in flight, the line after
 * an undo and the call last shown. */
data class MockRoomUi(
    val filter: String = RoomDraft.ALL,
    val marked: String? = null,
    /** The pick the drafter just drafted at, until the room moves past it. */
    val draftedAt: Int? = null,
    val busy: Boolean = false,
    val notice: String? = null,
    val callMissing: Boolean = false,
    val lastCall: CallView? = null,
)
