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
    private val countWords = listOf("No", "One", "Two")
    private const val SHOWN_LEAST = 0.05
    private const val TENTH = 0.1

    /** TradeStrip's words between a card's parts: "with Max_Jensen10", "Rodgers for Skattebo". */
    const val WITH = "with"
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

    /** trades.ts worthTitle: "Two trades worth proposing", "One trade worth proposing". */
    fun worthTitle(count: Int): String {
        val number = countWords.getOrNull(count) ?: count.toString()
        return "$number ${if (count == 1) "trade" else "trades"} worth proposing"
    }

    /** trades.ts shortSide: a side by last names, "Skattebo and Strong". */
    fun shortSide(side: List<PlayerLine>): String = list(side.map { StartRows.lastName(it.player.name) })

    /** trades.ts weekLine: "+10.1 Proj this week for your lineup, +2.5 for theirs", null without a
     * projection read. */
    fun weekLine(row: TradeRow): String? {
        val mine = row.myProjChange ?: return null
        val theirs = row.theirProjChange ?: return null
        return "${week(mine)} ${Words.Trades.projForYou}, ${week(theirs)} ${Words.Trades.forTheirs}"
    }

    /** trades.ts dropName: "Dart", "Williams, a starter". */
    private fun dropName(row: TradeRow): String {
        val name = row.drop?.let { StartRows.lastName(it.player.name) }.orEmpty()
        return if (row.dropReason == null) name else "$name, ${Words.Trades.aStarter}"
    }

    /** trades.ts roomWords' yours: "You drop Dart", else "You have room". */
    fun yourRoom(row: TradeRow): String = if (row.drop == null) Words.Trades.youHaveRoom else "You drop ${dropName(row)}"

    /** trades.ts phoneWith: "with Max_Jensen10, you drop Dart". */
    fun phoneWith(
        team: String,
        row: TradeRow,
    ): String {
        val drop = if (row.drop == null) "" else ", you drop ${dropName(row)}"
        return "with $team$drop"
    }

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

    /** trades.ts fromWords: "From McConkey Kong Country, you", "From Max_Jensen10". */
    fun from(
        team: String,
        mine: Boolean,
    ): String = if (mine) "From $team, you" else "From $team"

    /** words.ts noTradeWith: "No trade we found includes Josh Downs." */
    fun noTradeWith(name: String): String = "No trade we found includes $name."

    /** words.ts gainAmount: "2.1", "under 0.1" for a gain under what a page shows. */
    fun gainAmount(gain: Double): String = if (gain > 0 && gain < SHOWN_LEAST) "under ${Format.fixed(TENTH, 1)}" else Format.fixed(gain, 1)

    /** words.ts tradeDecision: "Trade Aaron Rodgers to Max_Jensen10 for Cam Skattebo and Pierre Strong, and
     * drop Jaxson Dart to make room. Your lineup gains 5.7 points over replacement a week, theirs 0.7.",
     * or that no trade we found helps both lineups. */
    fun decision(
        row: TradeRow?,
        team: String,
    ): String {
        if (row == null) return "No trade we found helps both lineups."
        val names = { side: List<PlayerLine> -> list(side.map { it.player.name }) }
        val drop = row.drop?.let { ", and drop ${it.player.name} to make room" }.orEmpty()
        return "Trade ${names(row.give)} to $team for ${names(row.get)}$drop. " +
            "Your lineup gains ${gainAmount(row.myGain)} points over replacement a week, " +
            "theirs ${gainAmount(row.theirGain)}."
    }
}
