package app.trycommish.core.companion

/** One player's outcome range in points, his floor, median and ceiling. */
data class PointsRange(
    val floor: Double,
    val median: Double,
    val ceiling: Double,
)

/** The scale the range bars in one list share, so spans compare across rows (web/src/lib/ui/range.ts). */
data class RangeScale(
    val low: Double,
    val high: Double,
) {
    /** rangePercent: where a point falls on the bar, a percent of its width clamped to the bar; a scale with
     * no span puts every point at its start. */
    fun percent(points: Double): Double {
        val span = high - low
        if (span <= 0) return 0.0
        return ((points - low) / span * HUNDRED).coerceIn(0.0, HUNDRED)
    }

    companion object {
        private const val HUNDRED = 100.0

        /** sharedScale: the lowest floor to the highest ceiling, null with no range. */
        fun shared(ranges: List<PointsRange>): RangeScale? {
            val all = ranges.flatMap { listOf(it.floor, it.ceiling) }
            val low = all.minOrNull() ?: return null
            val high = all.maxOrNull() ?: return null
            return RangeScale(low, high)
        }
    }
}

/** One player's outcome range on a list's shared scale: the ends in words under the bar, and where its span
 * and median mark fall, as percents of the bar. */
data class RangeLine(
    val text: String,
    val left: Double,
    val width: Double,
    val mid: Double,
) {
    companion object {
        fun of(
            range: PointsRange,
            scale: RangeScale,
        ): RangeLine {
            val left = scale.percent(range.floor)
            return RangeLine(
                DraftFormat.span(range.floor, range.ceiling),
                left,
                scale.percent(range.ceiling) - left,
                scale.percent(range.median),
            )
        }
    }
}
