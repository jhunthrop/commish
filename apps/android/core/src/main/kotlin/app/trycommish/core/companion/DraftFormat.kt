package app.trycommish.core.companion

import app.trycommish.core.Format
import app.trycommish.core.start.StartRows
import kotlin.math.abs

/** The round and the seat of an overall pick in a snake draft. */
data class SnakeSlot(
    val round: Int,
    val seat: Int,
)

/** The web's words and labels for picks and chances (web/src/lib/format/draft.ts and number.ts), the iOS
 * DraftFormat's twin, so a pick and a chance read the same on the phone as on the site. */
object DraftFormat {
    /** draft.ts CHANCE_FLOOR and CHANCE_CEILING: under and over these a chance reads "<1%" and ">99%". */
    private const val CHANCE_FLOOR = 0.005
    private const val CHANCE_CEILING = 0.995
    private const val PERCENT = 100
    private const val TWO_DIGITS = 10

    /** format/number.ts MINUS: a negative figure's sign. */
    private const val MINUS = "−"

    /** draft.ts snakeSlot. */
    fun snakeSlot(
        pick: Int,
        teams: Int,
    ): SnakeSlot {
        val round = (pick - 1) / teams + 1
        val index = (pick - 1) % teams
        return SnakeSlot(round, if (round % 2 == 1) index + 1 else teams - index)
    }

    /** "5.08": the round and the pick within it (draft.ts pickLabel). */
    fun pickLabel(
        pick: Int,
        teams: Int,
    ): String {
        val round = (pick - 1) / teams + 1
        val within = (pick - 1) % teams + 1
        return "$round.${if (within < TWO_DIGITS) "0" else ""}$within"
    }

    /** "97%", "<1%", ">99%" (draft.ts chanceShort). */
    fun chanceShort(chance: Double): String =
        when {
            chance < CHANCE_FLOOR -> "<1%"
            chance > CHANCE_CEILING -> ">99%"
            else -> percent(chance)
        }

    /** A share of runs as a whole percent: "51%" (`Math.round(share * 100)`). */
    fun percent(share: Double): String = "${StartRows.jsRound(share * PERCENT)}%"

    /** "Williams" from "Jameson Williams", "Harrison" from "Marvin Harrison Jr." (draft.ts lastName). */
    fun lastName(name: String): String = StartRows.lastName(name)

    /** number.ts signed: "+113.9", "−12.5", "+0.0" for a figure that rounds to nothing; `decimals` 0 for a
     * whole count of picks, "+2". */
    fun signed(
        value: Double,
        decimals: Int = 1,
    ): String {
        val magnitude = Format.fixed(abs(value), decimals)
        return if (value < 0 && magnitude.toDouble() != 0.0) "$MINUS$magnitude" else "+$magnitude"
    }

    /** number.ts span: "212.3 to 407.3". */
    fun span(
        floor: Double,
        ceiling: Double,
    ): String = "${Format.fixed(floor)} to ${Format.fixed(ceiling)}"
}
