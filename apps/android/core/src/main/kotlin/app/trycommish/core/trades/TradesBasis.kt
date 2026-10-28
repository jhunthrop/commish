package app.trycommish.core.trades

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeAdvice
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.start.BasisParts
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.LineupBasis
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/**
 * The Trades' basis as a phone says it once under the rows (trades.ts tradeBasis, drawnText for the
 * phone): which trades are listed and who decides, what a game is while a trade is opened, what Proj is
 * or the day it arrives, when Final and the stats land, what Opp is while a trade is opened, and the
 * rules our stats lack; the record's link follows it. A port of the iOS one, held to the web's paragraph
 * at every clock by the parity file.
 */
internal object TradesBasis {
    /** basis.ts DEFENSES_CLAUSE: the Proj sentence's clause where a defense is drawn. */
    private const val DEFENSES_CLAUSE = ", defenses on default scoring"

    class Facts(
        val advice: TradeAdvice,
        val host: LeagueHost,
        /** Every line the finder and its opened trades can show (TradeScreen's lines). */
        val lines: List<PlayerLine>,
        /** What is open: a trade's players' columns, or the builder's rosters, are on the screen. */
        val opened: TradesOpened,
        val zone: ZoneId,
        val now: Instant,
    )

    fun phone(facts: Facts): String {
        val advice = facts.advice
        val open = facts.opened != TradesOpened.None
        val parts =
            listOf(
                advice.basis,
                // What the verdict's rest-of-season cells are, with the builder open (Lane 277).
                if (facts.opened == TradesOpened.Builder) Words.Trades.restBasis else null,
                if (open) advice.perGameBasis else null,
                arrives(facts) ?: proj(facts),
                finals(facts),
                // The builder's phone rows draw no Opp rank (TradeBox), so its sentence is the desk's there.
                if (facts.opened == TradesOpened.Trade) Words.Basis.oppPhone else null,
                if (open) BasisParts.uncounted(advice.basisNote, advice.basisNoteList, facts.lines) else null,
            )
        return parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(" ")
    }

    /** next-week.ts arrivesPart: "Week 7 projections expected Thursday.", before the week's projection is
     * read. */
    private fun arrives(facts: Facts): String? {
        val advice = facts.advice
        if (advice.projectionReadAt != null) return null
        val arrives = instantOrNull(advice.projectionArrivesAt) ?: return null
        return "Week ${advice.forWeek ?: advice.week} projections expected ${Format.weekdayName(arrives, facts.zone)}."
    }

    /** basis.ts projPart as the trades say it (no platform named, so the rules' owner is the league's):
     * "Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm." */
    private fun proj(facts: Facts): String {
        val advice = facts.advice
        val scoring = advice.projectionScoring
        val week = LineupBasis.weeksWord(advice.forWeek ?: advice.week, advice.week)
        val read = instantOrNull(advice.projectionReadAt)?.let { "read ${Format.weekdayTime(it, facts.zone)}" } ?: "not in yet"
        // The builder's boxes draw a defense; a trade never holds one (Lane 66g).
        val defense =
            if (facts.opened == TradesOpened.Builder && facts.lines.any { it.player.position == "DEF" }) DEFENSES_CLAUSE else ""
        val said = "${Words.Box.proj} is $week published projection${BasisParts.scoringWords(scoring, null)}$defense, $read."
        return BasisParts.teBonusSentence(scoring.teBonus, null)?.let { "$said $it" } ?: said
    }

    /** basis.ts finalsParts on a phone over the trades' rows: the one sentence where nothing waits on
     * Final, else the phone's short sentence of what Avg and Last count; with a trade opened, when Final
     * lands is left to the desk. */
    private fun finals(facts: Facts): String? {
        val timing = LineupBasis.kickedOffPart(facts.lines, facts.now)
        val full = finalsAt(facts) ?: return null
        if (timing == null || full == timing) {
            return if (facts.opened != TradesOpened.None && full == Words.Basis.kickedOffPart) null else full
        }
        return "${Words.Box.avg} and ${Words.Box.last} count ${ValueWords.platform(facts.host)}'s finals, " +
            "our stats ${Words.Basis.statsByWednesday}"
    }

    /** basis.ts finalsPartAt over the league's rosters. */
    private fun finalsAt(facts: Facts): String? {
        val lines = facts.lines
        val counted = lines.firstOrNull { LineupBasis.platformGame(it) != null }
        val game = counted?.let(LineupBasis::platformGame) ?: return LineupBasis.kickedOffPart(lines, facts.now)
        val platform = ValueWords.platform(facts.host)
        val avg = Words.Box.avg
        val last = Words.Box.last
        if (lines.any { LineRead.game(it, facts.now) == GameRead.KickedOff }) {
            return "${LineupBasis.finalLands}, $avg and $last then count $platform's points, our stats ${Words.Basis.statsByWednesday}"
        }
        val weeks = LineupBasis.weeksWord(game.week, counted.facts.week)
        return "$avg and $last count $weeks finals from $platform's points, our stats ${Words.Basis.statsByWednesday}"
    }
}
