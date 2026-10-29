package app.trycommish.core.trades

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeMoves
import app.trycommish.api.models.TradeRow
import app.trycommish.core.Format
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import kotlin.math.abs

/** Which way a figure went, as its cell is inked: up a gain, down a loss, none even (trades.ts toneOf). */
enum class Tone(
    val word: String,
) {
    Gain("gain"),
    Loss("loss"),
    Even("even"),
}

/** The line under a pressed verb (TradeCopied.svelte): what happened, then where to propose it, the page
 * its link. */
data class CopiedLine(
    val said: String,
    val page: String,
) {
    /** "Copied. Propose it on FFPC's trade page." */
    val words: String get() = "$said ${Words.Trades.proposeItOn} $page."
}

/** The Trades screen's words a function builds (web/src/lib/league/box/trades.ts, inseason/words.ts and
 * builder.ts), each a port held to the web's output by shared/fixtures/parity/trades.json, as the iOS
 * port is. */
object TradesWords {
    internal const val MINUS = "−"
    private const val SHOWN_LEAST = 0.05
    private const val TENTH = 0.1

    /** The word between an idea's sides: "Rodgers for Waddle and Strong". */
    const val FOR = "for"

    /** format/list.ts listWords: "Skattebo and Strong", "A, B and C". */
    fun list(items: List<String>): String {
        if (items.size < 2) return items.joinToString("")
        return "${items.dropLast(1).joinToString(", ")} and ${items.last()}"
    }

    /** number.ts signed: "+5.7", "−0.3", "+0.0". */
    internal fun signed(value: Double): String {
        val magnitude = Format.fixed(abs(value), 1)
        return if (value < 0 && magnitude.toDouble() != 0.0) "$MINUS$magnitude" else "+$magnitude"
    }

    /** A figure to the tenth a cell prints: the number `Number(fixed(value, 1))` reads back. */
    internal fun shown(value: Double): Double = Format.fixed(value, 1).toDouble()

    /** trades.ts gainWord: "+5.7", "−0.3". */
    fun gain(value: Double): String = signed(shown(value))

    /** trades.ts weekWord: "+7.3", "−5.6", "0.0", "--" without one. */
    fun week(change: Double?): String {
        if (change == null) return Words.Box.none
        val figure = shown(change)
        return if (figure == 0.0) Format.fixed(0.0, 1) else signed(figure)
    }

    /** trades.ts toneOf. */
    fun tone(value: Double?): Tone {
        if (value == null) return Tone.Even
        val figure = shown(value)
        return when {
            figure == 0.0 -> Tone.Even
            figure > 0 -> Tone.Gain
            else -> Tone.Loss
        }
    }

    /** trades.ts shortSide: a side by last names, "Skattebo and Strong". */
    fun shortSide(side: List<PlayerLine>): String = list(side.map { StartRows.lastName(it.player.name) })

    /** trades.ts offerName: "Aaron Rodgers (QB PIT)". */
    private fun offerName(line: PlayerLine): String {
        val club = if (line.player.team.isEmpty()) "" else " ${line.player.team}"
        return "${line.player.name} (${line.player.position}$club)"
    }

    /** trades.ts offerText, the share text the verb copies: "Trade with Max_Jensen10: Aaron Rodgers (QB
     * PIT) for Cam Skattebo (RB NYG) and Pierre Strong (RB GB)." */
    fun offer(
        team: String,
        row: TradeRow,
    ): String = "Trade with $team: ${list(row.give.map(::offerName))} for ${list(row.get.map(::offerName))}."

    /** trades.ts proposeVerb: "Propose on Sleeper" where the platform takes a proposal from here, else
     * "Open FFPC trades", which copies the offer and opens its page. */
    fun verb(
        moves: TradeMoves,
        platform: String,
    ): String = if (moves.propose == TradeMoves.Propose.available) "Propose on $platform" else "Open $platform trades"

    /** TradeCopied's line: "Copied. Propose it on FFPC's trade page.", the page its link. */
    fun copied(
        done: Boolean,
        platform: String,
    ): CopiedLine = CopiedLine(if (done) Words.Trades.copied else Words.Trades.copyFailed, "$platform's trade page")

    /** words.ts gainAmount: "2.1", "under 0.1" for a gain under what a page shows. */
    fun gainAmount(gain: Double): String = if (gain > 0 && gain < SHOWN_LEAST) "under ${Format.fixed(TENTH, 1)}" else Format.fixed(gain, 1)

    /** builder.ts shareText, the trade as Share copies it in our words: the offer, then each lineup's
     * change and the drop. */
    fun share(
        team: String,
        row: TradeRow,
    ): String {
        val drop = row.drop?.let { " You drop ${it.player.name} to make room." }.orEmpty()
        return "${offer(team, row)} ${TradeChecks.change(row)}$drop"
    }
}
