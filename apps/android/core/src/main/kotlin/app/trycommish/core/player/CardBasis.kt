package app.trycommish.core.player

import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.ProjectionScoring
import app.trycommish.api.models.RunWeekRead
import app.trycommish.core.Format
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.start.LineupBasis
import app.trycommish.design.Words
import java.time.Instant

/** The card's basis lines once the week is read (web/src/lib/player/week-words.ts liveBasis), said once
 * each under the figures: what the week's figure is with what its change is measured from, then what Opp
 * rank, Avg and Last count, and while his game waits on its final, when it lands. */
internal object CardBasis {
    fun lines(
        week: PlayerWeek,
        league: Boolean,
        now: Instant,
        listed: Boolean,
        read: RunWeekRead?,
    ): List<String> {
        val scoring = week.projectionScoring
        val said = if (league) "your scoring" else "${ValueWords.format(scoring.format)} scoring"
        if (listed) return listOf("${Words.Card.listedWeek} ${avgLast(said)}")
        val proj = listOfNotNull(projUnstamped(week, league), changePart(week, read)).joinToString(" ")
        val evidence = "${Words.Basis.oppPart} ${avgLast(said)}"
        val facts = LineupBasis.kickedOffPart(listOf(week.line), now)
        return listOf(proj, facts?.let { "$evidence $it" } ?: evidence)
    }

    /** basis.ts projUnstampedPart over the card's week: "Wk 6 is this week's published projection, PPR
     * nearest your rules." in a league (its tight end's extra after it), "... in PPR." with none. The card
     * names no platform here, so a league's rules are "your league's". */
    fun projUnstamped(
        week: PlayerWeek,
        league: Boolean,
    ): String {
        val scoring = week.projectionScoring
        val format = ValueWords.format(scoring.format)
        val whose = if (league) leagueScoring(scoring, format) else " in $format"
        val said = "${CardTiles.weekHead(week.week)} is this week's published projection$whose."
        val bonus = scoring.teBonus
        if (!league || bonus == null) return said
        return "$said Your league adds ${Format.number(bonus)} a catch for TEs."
    }

    /** basis.ts leagueScoringWords with no platform named. */
    private fun leagueScoring(
        scoring: ProjectionScoring,
        format: String,
    ): String =
        when {
            scoring.leagueOwn -> " on your rules"
            scoring.teBonus == null -> ", $format nearest your rules"
            else -> ", $format shown, nearest your league's rules"
        }

    /** week-words.ts changePartOf: what the change is measured from, none on his bye. */
    private fun changePart(
        week: PlayerWeek,
        read: RunWeekRead?,
    ): String? {
        if (week.line.facts.bye && week.afterBye != null) return null
        if (CardTiles.moveOf(week, read).basis == ProjectionMove.Basis.Read) return Words.WeekTile.changePartRead
        return if (week.projectionPreviousReadAt == null) null else Words.WeekTile.changePart
    }

    /** basis.ts avgLastPart: "Avg and Last are his points a game and last game, PPR scoring." */
    private fun avgLast(scoring: String): String = "${Words.Box.avg} and ${Words.Box.last} are his points a game and last game, $scoring."
}
