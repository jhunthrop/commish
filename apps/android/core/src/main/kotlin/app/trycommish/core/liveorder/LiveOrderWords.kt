package app.trycommish.core.liveorder

import app.trycommish.api.models.OrderAdvice
import app.trycommish.api.models.RunFormat
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** Why the formats table's footnote names a format whose rank reads none (live-figures.ts
 * UnrankedReason): an answer from before the per-format ranks places him in its own format alone; our
 * order in that format does not place him. */
enum class UnrankedReason { Unread, Unplaced }

/** The words a screen says about the clock its figures are on (Lane 226, the iOS LiveOrderWords'): the
 * order's lead once its rows stand, the run's stamp while they do not, the Board's reach and the
 * every-format table's rank footnote. The tables' function members ported (shared/words/live-strip.json,
 * live-order.json and formats-rank.json name them), held to shared/fixtures/parity/one-value.json. */
object LiveOrderWords {
    /** live-board.ts liveLeadPart with no league: the order's first sentence, the board's shape and when
     * it was read. "Our rest-of-season order from week 6's games left, by points over replacement for 12
     * teams, read 1:56 pm Central." */
    fun lead(
        answer: OrderAdvice,
        teams: Int,
        readAt: Instant,
        zone: ZoneId,
    ): String =
        "${orderLead(answer.basis)}, by points over replacement for $teams teams, read " +
            "${Format.timeOfDay(readAt, zone)} ${Format.zoneWord(zone)}."

    /** The order's first sentence without its stop. */
    internal fun orderLead(basis: String): String {
        val end = basis.indexOf(". ")
        return (if (end < 0) basis else basis.substring(0, end)).removeSuffix(".")
    }

    /** live-board.ts inSeasonStamp and STRIP_WORDS.updated: the run's day and time on a screen in season
     * that shows the run's rows, "Projected updated Thu Oct 15, 8:50 am Central."; null before the season
     * or on a run that says no refresh. */
    fun runStamp(
        format: RunFormat,
        zone: ZoneId,
    ): String? {
        if (format.rosFromWeek == null) return null
        val refreshed = instantOrNull(format.refreshedAt) ?: return null
        return "Projected updated ${Format.weekdayDay(refreshed, zone)}, ${Format.timeOfDay(refreshed, zone)} ${Format.zoneWord(zone)}."
    }

    /** live-order.ts LIVE_ORDER_WORDS.reach: the Board's count when one read of the order reaches fewer of
     * its players than it ranks, "The first 400 of the 627 players on our board, in our order." */
    fun reach(
        shown: Int,
        total: Int,
    ): String = "The first $shown of the $total players on our board, in our order."

    /** live-order.ts LIVE_ORDER_WORDS.fromRunLine (Lane 280, B257): the run's players an uncut order omits,
     * counted once, "2 players from the run, not in the live order."; null with none. */
    fun fromRun(count: Int): String? = if (count > 0) "${Format.plural(count, "player", "players")} ${Words.LiveOrder.fromRun}." else null

    /** formats-words.ts FORMATS_RANK.unranked: under the table when a format's rank cell reads "--", the
     * reason for those formats alone (Lane 234, B211). */
    fun unranked(
        labels: List<String>,
        reason: UnrankedReason,
    ): String {
        val named = joined(labels)
        val one = labels.size == 1
        val show = if (one) "shows" else "show"
        val their = if (one) "its" else "their"
        return when (reason) {
            UnrankedReason.Unread -> "$named $show no position rank at this read, only $their points."
            UnrankedReason.Unplaced -> "Our order in $named does not place him at his position."
        }
    }

    /** "Half PPR", "Half PPR and Standard", "Half PPR, Standard and Superflex". */
    private fun joined(labels: List<String>): String {
        if (labels.size <= 1) return labels.joinToString("")
        return "${labels.dropLast(1).joinToString(", ")} and ${labels.last()}"
    }
}
