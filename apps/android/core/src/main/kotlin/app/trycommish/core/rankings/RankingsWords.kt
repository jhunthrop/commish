package app.trycommish.core.rankings

import app.trycommish.api.models.WeekOrderAdvice
import app.trycommish.core.Format
import app.trycommish.design.Words

/** The Rankings' sentences the web builds with a function (order/words.ts, order/week.ts, week-head.ts,
 * run/week-names.ts, format/pool-words.ts), ported over the generated words as iOS's RankingsWords and
 * held to the web's output by shared/fixtures/parity/rankings.json. */
object RankingsWords {
    /** box.ts EXPECTED_SCORE: the expected score's label (Lane 139, C07). */
    const val EXPECTED_SCORE = "Expected score"

    /** week-names.ts: "Rankings" in season, "Players" before and after it. */
    fun name(inSeason: Boolean): String = if (inSeason) Words.PageName.rankings else Words.PageName.players

    /** words.ts playersLead: before the season the page's purpose; in season on our order's chips, whose
     * order it is with the week's game beside each player; on the K and D/ST chips none. */
    fun lead(
        inSeason: Boolean,
        onWeekChip: Boolean,
        week: Int?,
    ): String? {
        if (!inSeason) return Words.PagePurpose.players
        if (onWeekChip || week == null) return null
        return "Our rest-of-season order, with week $week's game beside each player"
    }

    /** pool-words.ts hitsWords: "121 on NFL rosters today" with no filter, "12 matches" with one. */
    fun hits(
        total: Int,
        filtered: Boolean,
        onClub: Int?,
    ): String = if (filtered) Format.plural(total, "match", "matches") else "${Format.count(onClub ?: total)} ${Words.Pool.rosters}"

    /** figure-words.ts weekHead: "Wk 6". */
    fun weekHead(week: Int): String = "${Words.Figure.week} $week"

    /** words.ts byeHead: "Bye in week 6". */
    fun byeHead(week: Int): String = "${Words.OrderWeek.byeIn} $week"

    /** The kickers' or defenses' plural: "kickers". */
    fun many(position: WeekPosition): String = if (position == WeekPosition.K) Words.WeekMany.K else Words.WeekMany.DEF

    /** week.ts WEEK_NOUNS' one: "kicker", "defense". */
    fun one(position: WeekPosition): String = if (position == WeekPosition.K) "kicker" else "defense"

    /** week-head.ts weekHeading: "Week 6 kickers". */
    fun weekHeading(
        position: WeekPosition,
        week: Int?,
    ): String = week?.let { "Week $it ${many(position)}" } ?: "This week's ${many(position)}"

    /** week.ts weekNone: "No defense matches." */
    fun weekNone(position: WeekPosition): String = "No ${one(position)} matches."

    /** week.ts weekStatus: before the week's projection is in, the line said in the table's place. */
    fun weekStatus(
        advice: WeekOrderAdvice,
        position: WeekPosition,
    ): String? {
        if (landed(advice)) return null
        val many = many(position)
        return "Week ${advice.week}'s projection for $many is not in yet. " +
            "Until it is, there is no ${Words.Box.proj}, and the $many below are in order of ${Words.Box.avg}."
    }

    /** week.ts landed: a row carries a Proj. */
    fun landed(advice: WeekOrderAdvice): Boolean = advice.rows.any { it.line.weekProjection != null }
}
