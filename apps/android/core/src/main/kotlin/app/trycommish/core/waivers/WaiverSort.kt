package app.trycommish.core.waivers

/** The table's sortable columns (waivers.ts SortKey), by the web's names; the phone draws Player, Proj
 * and Beats. */
enum class WaiverSortKey(
    val key: String,
) {
    Name("name"),
    Game("game"),
    Proj("proj"),
    Opp("opp"),
    Avg("avg"),
    Last("last"),
    Delta("delta"),
    Rest("rest"),
    Beats("beats"),
    ;

    companion object {
        fun of(key: String): WaiverSortKey? = entries.firstOrNull { it.key == key }
    }
}

/** A sort of the table (waivers.ts Sort): a column and whether highest first. */
data class WaiverSort(
    val key: WaiverSortKey,
    val down: Boolean,
) {
    /** waivers.ts nextSort: a column chosen again turns it around; a new column starts highest first, a
     * name A to Z, a game soonest first. */
    fun next(key: WaiverSortKey): WaiverSort =
        if (key == this.key) copy(down = !down) else WaiverSort(key, down = key != WaiverSortKey.Name && key != WaiverSortKey.Game)

    companion object {
        /** waivers.ts DEFAULT_SORT: Beats, by the season Gain, the API's own order among the rows that gain. */
        val Initial = WaiverSort(WaiverSortKey.Beats, down = true)
    }
}

/** A row's value for a column: a figure, or words (a name, a kickoff as the API writes it) compared as
 * JavaScript compares strings. */
private sealed interface SortValue : Comparable<SortValue> {
    data class Number(
        val value: Double,
    ) : SortValue

    data class Text(
        val value: String,
    ) : SortValue

    override fun compareTo(other: SortValue): Int =
        when {
            // As JavaScript's < compares numbers: -0 and 0 are equal.
            this is Number && other is Number ->
                if (value < other.value) {
                    -1
                } else if (value > other.value) {
                    1
                } else {
                    0
                }
            this is Text && other is Text -> value.compareTo(other.value)
            else -> 0
        }
}

/** waivers.ts sortRows and findRows over the table's rows. */
internal object WaiverSorting {
    /** waivers.ts valueOf: a row's value for a column, null when not held (always last, whichever way). */
    private fun value(
        row: PoolRow,
        key: WaiverSortKey,
    ): SortValue? {
        val cells = row.cells.row
        val number =
            when (key) {
                WaiverSortKey.Name -> return SortValue.Text(cells.name)
                WaiverSortKey.Game ->
                    return row.source.add.facts.kickoff
                        ?.let(SortValue::Text)
                WaiverSortKey.Proj -> cells.proj
                WaiverSortKey.Opp -> cells.oppRank?.toDouble()
                WaiverSortKey.Avg -> cells.avg
                WaiverSortKey.Last -> cells.last
                WaiverSortKey.Delta -> cells.delta
                WaiverSortKey.Rest -> row.rest
                WaiverSortKey.Beats -> row.order
            }
        return number?.let(SortValue::Number)
    }

    /** waivers.ts sortRows: by a column, the not-held last, ties kept in the answer's order. */
    fun sorted(
        rows: List<PoolRow>,
        sort: WaiverSort,
    ): List<PoolRow> {
        val values = rows.map { value(it, sort.key) }
        val valued = rows.indices.filter { values[it] != null }
        val ascending = compareBy<Int> { values[it] }
        // sortedWith is stable: equal values keep the answer's order whichever way the column runs.
        val order = if (sort.down) ascending.reversed() else ascending
        return (valued.sortedWith(order) + rows.indices.filter { values[it] == null }).map { rows[it] }
    }

    /** waivers.ts findRows: the rows whose name holds the search, any case; every row for an empty one. */
    fun found(
        rows: List<PoolRow>,
        query: String,
    ): List<PoolRow> {
        val wanted = query.trim().lowercase()
        return if (wanted.isEmpty()) {
            rows
        } else {
            rows.filter {
                it.cells.row.name
                    .lowercase()
                    .contains(wanted)
            }
        }
    }
}
