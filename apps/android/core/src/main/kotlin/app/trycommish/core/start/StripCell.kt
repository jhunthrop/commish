package app.trycommish.core.start

import app.trycommish.core.Format
import app.trycommish.design.Words

/** One labelled cell of a box row's strip (figure-strip.ts StripCell, Lane 209; iOS's StripCell, Lane
 * 215): its head in small caps over its figure, so a row's figures are columns down the list and never a
 * sentence. */
data class StripCell(
    val head: String,
    /** The figure as printed, "--" when not held. */
    val value: String,
    /** The figure the rows sort on, drawn in ink: a sorted column draws its key on every row. */
    val key: Boolean = false,
    /** The opponent's rank's cell, drawn with its tint and quiet without a rank. */
    val opp: Boolean = false,
    /** How easy the opponent is; null on every other cell and on an opponent's cell without a rank. */
    val ease: Ease? = null,
    /** A short figure under a short head (the week's "13.0" under "Wk 6"): a narrower share of the strip,
     * so the longer heads keep their room on the smallest phone. */
    val narrow: Boolean = false,
) {
    /** The cell's share of the strip's width beside each other cell's one (figure-strip.ts stripShare),
     * held to the web's by the parity file's `share`. */
    val share: Double get() = if (narrow) NARROW_SHARE else 1.0

    private companion object {
        const val NARROW_SHARE = 0.6
    }
}

/** figure-strip.ts's cell builders over a row's figures and evidence. */
internal object StripCells {
    /** figureCell: a figure under its head, "--" when not held. */
    fun figure(
        head: String,
        value: Double?,
        key: Boolean = false,
        narrow: Boolean = false,
    ): StripCell = StripCell(head, StartWords.number(value), key = key, narrow = narrow)

    /** oppCell: the opponent's rank against his position (of the clubs ranked), tinted, "--" without one
     * (a bye, a list). */
    fun opp(
        rank: Int?,
        of: Int?,
    ): StripCell =
        StripCell(
            head = Words.Box.oppRank,
            value = rank?.let { Format.ordinal(it) } ?: Words.Box.none,
            opp = true,
            ease = rank?.let { StartRows.ease(it, of) },
        )

    /** formCells: Avg and Last, the evidence every box score ends on. */
    fun form(
        avg: Double?,
        last: Double?,
    ): List<StripCell> = listOf(figure(Words.Box.avg, avg), figure(Words.Box.last, last))
}
