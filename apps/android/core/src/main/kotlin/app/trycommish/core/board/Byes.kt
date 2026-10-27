package app.trycommish.core.board

import app.trycommish.design.Words

/** A club's bye as the web says it (web/src/lib/format/bye.ts), ported: a bye ahead of the week a
 * rest-of-season board ranks from prints its week, a bye already played draws nothing (Lane 223, B190),
 * since it costs him no game the board counts. `fromWeek` is null on a board of the full season, where
 * every bye counts. */
object Byes {
    /** bye.ts byeAhead: the bye still ahead, null once played or where the run names none. */
    fun ahead(
        bye: Int?,
        fromWeek: Int?,
    ): Int? = if (bye == null || (fromWeek != null && bye < fromWeek)) null else bye

    /** bye.ts BYE_WORDS.week: "Bye week 11". */
    fun week(week: Int): String = "Bye week $week"

    /** bye.ts byeCell, the narrow Bye column's cell: the week while ahead, nothing once played, the empty
     * figure where the run names none. */
    fun cell(
        bye: Int?,
        fromWeek: Int?,
    ): String {
        if (bye == null) return Words.Box.none
        return ahead(bye, fromWeek)?.toString().orEmpty()
    }

    /** bye.ts byeLine, a phone row's bye beside his club: "Bye week 11" while ahead, null once played or
     * where the run names none. */
    fun line(
        bye: Int?,
        fromWeek: Int?,
    ): String? = ahead(bye, fromWeek)?.let(::week)

    /** Whether the run names a bye and it is played. */
    fun played(
        bye: Int?,
        fromWeek: Int?,
    ): Boolean = bye != null && ahead(bye, fromWeek) == null
}
