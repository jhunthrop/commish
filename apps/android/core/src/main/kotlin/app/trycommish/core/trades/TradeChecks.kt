package app.trycommish.core.trades

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeRow
import app.trycommish.api.models.TradeSideTotals
import app.trycommish.core.Format
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import java.time.Instant
import kotlin.math.abs

/** One side of the check's scoreboard (TradeBug.svelte over trades.ts bugFigures): this week's Proj and
 * the rest-of-season strength, each before and after with the change, "--" without a projection. */
data class TradeFigures(
    val projBefore: String,
    val projAfter: String,
    val projChange: String,
    val projTone: Tone,
    val seasonBefore: String,
    val seasonAfter: String,
    val seasonChange: String,
    val seasonTone: Tone,
) {
    companion object {
        /** bugFigures: the totals, the side's gain and its change in this week's Proj as the API sends them,
         * "--" before an answer. */
        fun of(
            totals: TradeSideTotals?,
            gain: Double?,
            projChange: Double?,
        ): TradeFigures =
            TradeFigures(
                projBefore = word(totals?.projBefore),
                projAfter = word(totals?.projAfter),
                projChange = TradesWords.week(projChange),
                projTone = TradesWords.tone(projChange),
                seasonBefore = word(totals?.seasonBefore),
                seasonAfter = word(totals?.seasonAfter),
                seasonChange = gain?.let(TradesWords::gain) ?: Words.Box.none,
                seasonTone = TradesWords.tone(gain),
            )

        /** A strength below replacement with the typographic minus, as every signed figure prints. */
        private fun word(value: Double?): String {
            if (value == null) return Words.Box.none
            val shown = Format.fixed(abs(value), 1)
            return if (value < 0 && shown.toDouble() != 0.0) "${TradesWords.MINUS}$shown" else shown
        }
    }
}

/** One row of the verdict: You or With, the team, its figures, its room and its bar. */
data class TradeBugSide(
    val label: String,
    val name: String,
    val initials: String,
    val mine: Boolean,
    val figures: TradeFigures,
    val room: String,
    /** Its rest of season (Lane 277). */
    val rest: TradeRest,
    /** Its gain a week as a share of the longer side's, 0 to 1 (builder.ts gainBars). */
    val bar: Double = 0.0,
) {
    companion object {
        fun of(
            me: Boolean,
            name: String,
            totals: TradeSideTotals?,
            gain: Double?,
            projChange: Double?,
            room: String,
            rest: TradeRest,
            bar: Double = 0.0,
        ): TradeBugSide =
            TradeBugSide(
                label = if (me) Words.Trades.yourSide else Words.Trades.theirSide,
                name = name,
                initials = initialsOf(name),
                mine = me,
                figures = TradeFigures.of(totals, gain, projChange),
                room = room,
                rest = rest,
                bar = bar,
            )
    }
}

/** A side's rest-of-season cell (trades.ts restFigure, Lane 277): its change over the weeks the check
 * covers, toned, and whether that side would not take the trade. Before an answer the none mark; on an
 * answer without the figure (an older API) empty, never a figure we did not read. */
data class TradeRest(
    val text: String,
    val tone: Tone,
    val refuses: Boolean,
) {
    companion object {
        private val NONE = TradeRest(Words.Box.none, Tone.Even, false)

        fun of(
            check: TradeCheck?,
            mine: Boolean,
        ): TradeRest {
            if (check == null) return NONE
            val trade = check.trade
            val rest = (if (mine) trade.myRestOfSeason else trade.theirRestOfSeason) ?: return TradeRest("", Tone.Even, false)
            val takes = check.acceptable?.let { if (mine) it.yours else it.theirs }
            return TradeRest(TradesWords.gain(rest), TradesWords.tone(rest), takes == false)
        }
    }
}

/** The builder's scoreboard (TradeBug.svelte): each side's lineup before and after the trade. */
data class TradeBug(
    val yours: TradeBugSide,
    val theirs: TradeBugSide,
)

/** Each side's room after the trade (trades.ts checkRoom). */
data class TradeRoom(
    val yours: String,
    val theirs: String,
)

/** trades.ts heldCheck and checkRoom, and builder.ts checkWords. */
object TradeChecks {
    private const val PER_WEEK = "points over replacement a week"
    private val trailingNumber = Regex(" \\d+$")

    /** Every player the trade moves still to be played (trades.ts countsThisWeek). */
    fun countsThisWeek(
        row: TradeRow,
        now: Instant,
    ): Boolean = (row.give + row.get + listOfNotNull(row.drop)).none { LineRead.game(it, now).locked }

    /** trades.ts heldRow: no change this week once a player it moves has kicked off. */
    fun held(
        row: TradeRow,
        now: Instant,
    ): TradeRow = if (countsThisWeek(row, now)) row else row.copy(myProjChange = null, theirProjChange = null)

    /** trades.ts heldCheck: the trade held, and no Proj before or after on either side. */
    fun held(
        check: TradeCheck,
        now: Instant,
    ): TradeCheck {
        if (countsThisWeek(check.trade, now)) return check
        val totals = check.totals
        return check.copy(
            trade = held(check.trade, now),
            totals =
                totals.copy(
                    yours = totals.yours.copy(projBefore = null, projAfter = null),
                    theirs = totals.theirs.copy(projBefore = null, projAfter = null),
                ),
        )
    }

    /** trades.ts checkRoom: "Drop Dart", "Has room", "No one to drop". */
    fun room(check: TradeCheck): TradeRoom {
        val fills = check.fills
        val yours =
            when {
                !fills.yoursRoom -> Words.Trades.noOneToDrop
                else ->
                    check.trade.drop?.let { "${Words.Trades.sideDrop} ${StartRows.lastName(it.player.name)}" }
                        ?: Words.Trades.hasRoom
            }
        return TradeRoom(yours, if (fills.theirsRoom) Words.Trades.hasRoom else Words.Trades.noOneToDrop)
    }

    /** builder.ts slotPlace: "RB2", "the flex", "every slot". */
    fun slotPlace(label: String?): String {
        if (label == null) return "every slot"
        if (!label.contains("flex", ignoreCase = true)) return label
        return "the ${label.replace(trailingNumber, "").lowercase()}"
    }

    private enum class Direction { Gains, Loses, None }

    private fun direction(gain: Double): Direction =
        when {
            Format.fixed(abs(gain), 1) == Format.fixed(0.0, 1) -> Direction.None
            gain > 0 -> Direction.Gains
            else -> Direction.Loses
        }

    private fun amount(gain: Double): String = if (gain > 0) TradesWords.gainAmount(gain) else Format.fixed(abs(gain), 1)

    private fun verb(direction: Direction): String = if (direction == Direction.Gains) "gains" else "loses"

    /** builder.ts changeWords: the two lineups' change in one sentence. */
    fun change(row: TradeRow): String {
        val mine = direction(row.myGain)
        val theirs = direction(row.theirGain)
        val my = amount(row.myGain)
        val their = amount(row.theirGain)
        return when {
            mine == Direction.None && theirs == Direction.None -> "Neither lineup changes on our order."
            mine == Direction.Gains && theirs == Direction.Gains -> "Both lineups gain: yours $my $PER_WEEK, theirs $their."
            mine == Direction.None -> "Your lineup does not change, theirs ${verb(theirs)} $their $PER_WEEK."
            theirs == Direction.None -> "Your lineup ${verb(mine)} $my $PER_WEEK, theirs does not change."
            else -> "Your lineup ${verb(mine)} $my $PER_WEEK, theirs ${verb(theirs)} $their."
        }
    }

    /** builder.ts figuredName: "Kyren Williams (14.2 a game)". */
    private fun figuredName(line: PlayerLine): String {
        val perGame = line.restOfSeasonPerGame ?: return line.player.name
        return "${line.player.name} (${Format.fixed(perGame, 1)} ${Words.InSeason.aGame})"
    }

    /** builder.ts playersWords: " You give ... for ....", "" when no player has the figure. */
    private fun players(row: TradeRow): String {
        if ((row.give + row.get).none { it.restOfSeasonPerGame != null }) return ""
        val side = { lines: List<PlayerLine> -> TradesWords.list(lines.map(::figuredName)) }
        return " You give ${side(row.give)} for ${side(row.get)}."
    }

    /** trades.ts refusalWords (Lane 277): the answer line's lead when a side would not take the trade on
     * its rest of season, null when both would or the answer does not say (an older API). */
    fun refusal(check: TradeCheck): String? {
        val acceptable = check.acceptable ?: return null
        return when {
            !acceptable.yours && !acceptable.theirs -> Words.Trades.bothGiveUp
            !acceptable.theirs -> Words.Trades.theyGiveUp
            !acceptable.yours -> Words.Trades.youGiveUp
            else -> null
        }
    }

    /** builder.ts fillsBoth: a trade both rosters can make. */
    fun fillsBoth(check: TradeCheck): Boolean {
        val fills = check.fills
        return fills.yours && fills.theirs && fills.yoursRoom && fills.theirsRoom
    }

    /** builder.ts checkWords: a roster the trade leaves short, a roster with no one to drop, then a side
     * that would not take it in place of the lineups' change, else each lineup's change; the players
     * with their points a game, and the drop. */
    fun words(check: TradeCheck): String {
        val fills = check.fills
        val trade = check.trade
        return when {
            !fills.yours -> "Your roster would not fill ${slotPlace(fills.yoursOpen)}."
            !fills.theirs -> "Their roster would not fill ${slotPlace(fills.theirsOpen)}."
            !fills.yoursRoom -> "Your roster has no one to drop to make room."
            !fills.theirsRoom -> "Their roster has no one to drop to make room."
            else -> {
                val reason = trade.dropReason?.let { " $it" }.orEmpty()
                val drop = trade.drop?.let { " You drop ${it.player.name} to make room.$reason" }.orEmpty()
                "${refusal(check) ?: change(trade)}${players(trade)}$drop"
            }
        }
    }
}
