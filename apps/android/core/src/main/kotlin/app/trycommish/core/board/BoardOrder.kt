package app.trycommish.core.board

import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunMarketRow
import app.trycommish.api.models.RunPlayerStatus

/** A row a board places: his id, his position and his place at it. */
internal class Placed<Row>(
    val row: Row,
    val id: String,
    val position: String,
    val positionRank: Int,
)

internal fun RunBoardRow.placed(): Placed<RunBoardRow> = Placed(this, id, position.value, positionRank)

internal fun RunMarketRow.placed(): Placed<RunMarketRow> = Placed(this, id, position.value, positionRank)

/** A position's tier as the web draws it (run/tiers.ts TierGroup): its number, the players shown in it,
 * and its drop to the next tier as the run writes it, null where the drop is not said. */
internal data class TierGroup(
    val tier: Int,
    val rows: List<RunBoardRow>,
    val drop: Double?,
)

/**
 * The rows a view lists as the web's board page lists them (server/pages/board.ts, BoardView.svelte),
 * over the run's board, whose ranked rows come in our order: the All view the run's order, a
 * position's view by his place at it in tiers, and a kicker's or a defense's the drafts' order; each
 * player on a season-long list after the last available player at his position. Nothing here numbers a
 * player: every number is the run's.
 */
internal object BoardOrder {
    /** derive.ts rowsAt and market.ts marketAt: a position's rows by their place, ties as listed. */
    fun <Row> at(
        rows: List<Placed<Row>>,
        position: BoardPosition,
    ): List<Placed<Row>> = rows.filter { it.position == position.id }.sortedBy { it.positionRank }

    fun heldOut(
        id: String,
        statuses: Map<String, RunPlayerStatus>,
    ): Boolean = statuses[id]?.seasonLong == true

    /** board-status.ts withStatuses: each player on a season-long list after the last available player at
     * his position, in their order; a position with nobody available as it was. */
    fun <Row> withStatuses(
        rows: List<Placed<Row>>,
        statuses: Map<String, RunPlayerStatus>,
    ): List<Placed<Row>> {
        val lastAvailable = mutableMapOf<String, Int>()
        val waiting = mutableMapOf<String, MutableList<Placed<Row>>>()
        rows.forEachIndexed { index, row ->
            if (heldOut(row.id, statuses)) {
                waiting.getOrPut(row.position) { mutableListOf() } += row
            } else {
                lastAvailable[row.position] = index
            }
        }
        return rows.flatMapIndexed { index, row ->
            val last = lastAvailable[row.position]
            val here = if (!heldOut(row.id, statuses) || last == null) listOf(row) else emptyList()
            here + (if (index == last) waiting[row.position].orEmpty() else emptyList())
        }
    }

    /** run/tiers.ts tierGroups: a position's tiers in order, its players on a season-long list left out,
     * each tier's drop said only where neither its last player nor the next tier's first is. */
    fun tiers(
        rows: List<Placed<RunBoardRow>>,
        position: BoardPosition,
        statuses: Map<String, RunPlayerStatus>,
    ): List<TierGroup> {
        val all = at(rows, position).map { it.row }
        val out = { row: RunBoardRow -> heldOut(row.id, statuses) }
        val groups = mutableListOf<Pair<Int, MutableList<RunBoardRow>>>()
        all.filterNot(out).forEach { row ->
            if (groups.lastOrNull()?.first == row.tier) groups.last().second += row else groups += row.tier to mutableListOf(row)
        }
        return groups.map { (tier, shown) ->
            val end = all.lastOrNull { it.tier == tier }
            val start = all.firstOrNull { it.tier == tier + 1 }
            val said = end != null && !out(end) && start != null && !out(start)
            TierGroup(tier, shown.toList(), if (said) end?.tierDrop?.toDouble() else null)
        }
    }
}
