package app.trycommish.core.companion

import app.trycommish.core.board.BoardChip
import app.trycommish.core.board.Heat

/** The bar at the head of the followed draft (CompanionBar.svelte): the platform's pick count where a mock
 * room's clock would be (we never show a clock we do not own), the draft, the league, when you are up, the
 * platform gone quiet, and the way back to its draft room. */
data class CompanionBar(
    val figure: String,
    val caption: String,
    val section: String,
    val title: String,
    val league: String,
    val turn: String,
    val onTurn: Boolean,
    val stale: String?,
    val open: String,
    val openUrl: String,
)

/** One face on a strip of picks (types/room.ts StripPick). */
data class StripFace(
    /** The overall pick. */
    val pick: Int,
    val player: RoomPlayer,
    /** His last name, as the strip prints it. */
    val name: String,
    val lines: List<String>,
    /** The newest pick, marked in ink. */
    val newest: Boolean,
    /** The line after the name in ink: a pick the drafter made. */
    val strong: Boolean,
)

/** A strip of picks with its lead (PickStrip.svelte): the newest pick's label and its lines, or the count
 * since your pick. */
data class PickStripModel(
    val lead: String,
    val lines: List<String>,
    val picks: List<StripFace>,
)

/** A call row as the panel prints it (CallPanel.svelte at 390: face, player, Over repl, the chance). */
data class CallLine(
    val player: RoomPlayer,
    val value: String,
    val chance: String,
)

/** Our call (RoomCall.svelte): its tag, its chance head, its rows and the one verb, quiet off the clock. */
data class CallModel(
    val tag: String,
    val chanceHead: String?,
    val verb: String,
    /** Off your turn the call waits on the board: a quiet edge and a quiet verb. */
    val waiting: Boolean,
    val rows: List<CallLine>,
)

/** Who we would take next (Shortlist.svelte): each with his chance of lasting and what it is of, our why's
 * first sentence with full_reasoning, and his outcome range on the list's shared scale with
 * range_of_outcomes. */
data class ShortlistLine(
    val player: RoomPlayer,
    val chance: String?,
    val label: String,
    val why: String?,
    val range: RangeLine?,
)

/** A pool row (PoolRow.svelte at 390): face, player, Over repl on its round's tint, the chance. */
data class PoolLine(
    val player: RoomPlayer,
    val value: String,
    /** The tint, null where he carries no value round. */
    val heat: Heat?,
    /** His chance under the column, null where the column is not drawn or the card holds none. */
    val chance: String?,
    val isCall: Boolean,
)

/** The pool (Pool.svelte): its count, the basis over it, the chance column's head and every row under the
 * chip, the screen drawing the first and then more. */
data class PoolModel(
    val line: String,
    val basis: String,
    /** The chance column's head, null when no call with chances is coming. */
    val chanceHead: String?,
    val chanceLabel: String,
    /** What a row with no chance says under the column. */
    val missing: String,
    val filter: String,
    val rows: List<PoolLine>,
) {
    /** The chips, the one under which the rows are drawn pressed. */
    val chips: List<BoardChip<String>> get() = RoomDraft.filters.map { BoardChip(it, it, it == filter) }

    /** The pool's line when the chip leaves nobody. */
    val empty: String? get() = if (rows.isEmpty()) RoomWords.poolEmpty(filter) else null

    /** "Show 25 more" under `shown` rows, null when every row is shown. */
    fun more(shown: Int): String? = if (rows.size > shown) RoomWords.showMore(minOf(MORE_ROWS, rows.size - shown)) else null

    companion object {
        /** Pool.svelte FIRST_ROWS and MORE_ROWS. */
        const val FIRST_ROWS = 14
        const val MORE_ROWS = 25
    }
}

/** One slot of your team: who fills it and the pick that took him, or open. */
data class TeamLine(
    val slot: String,
    val player: RoomPlayer?,
    val pick: String?,
)

/** Your team (TeamPanel.svelte): the count, then each filled slot with the pick that took him and each open
 * one. */
data class TeamModel(
    val count: String,
    val slots: List<TeamLine>,
)
