package app.trycommish.core.matchup

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.ProjectionScoring
import app.trycommish.core.Format
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.core.start.BasisParts
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.LineupBasis
import app.trycommish.core.start.UnlistedDrawn
import app.trycommish.core.start.UnlistedForm
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/**
 * The Matchup's basis as a phone says it once under the boxes (basis.ts boxBasisParts with no Lineup,
 * drawnText for the phone): what Proj is, the Proj final, a Final of "--", the opponent's best lineup,
 * Our rank, Pts and Team, the Game cell, and when Final and the stats land while a row waits. A port of
 * the iOS one, held to the web's paragraph at every clock by the parity file.
 */
internal object MatchupBasis {
    /** The box's projection: when it was read and its scoring. */
    data class Projection(
        val readAt: Instant?,
        val scoring: ProjectionScoring,
    )

    data class Facts(
        val league: LeagueHost,
        /** The box's projection, null with no box answer. */
        val projection: Projection?,
        /** Every line both boxes draw. */
        val lines: List<PlayerLine>,
        val byPlayer: Boolean,
        val teamTotal: Boolean,
        /** The game has kicked off by the starters' lines. */
        val kicked: Boolean,
        val noFinal: Boolean,
        val allFinal: Boolean,
        val finalNone: Boolean,
        val unlisted: UnlistedDrawn,
        val zone: ZoneId,
        val now: Instant,
        /** The platform's words: the league's own, or the store graphics' neutral one (Lane 310). */
        val host: HostWords = HostWords.of(league),
    )

    fun phone(facts: Facts): String {
        val platform = facts.host.name
        // While the opponent's best-lineup words run long, the phone leaves the Proj's read time and when
        // Final lands to the desk (basis.ts unlistedLong).
        val long = facts.unlisted.long
        val parts =
            listOf(
                facts.projection?.let { proj(it, facts, crowded = long) },
                facts.projection?.let { BasisParts.teBonusSentence(it.scoring.teBonus, facts.league) },
                projFinalWords(facts.kicked && !facts.allFinal, facts.noFinal),
                if (facts.finalNone) BasisParts.finalNonePart(platform) else null,
                BasisParts.unlistedPart(platform, facts.unlisted, UnlistedForm.Full),
                Words.Basis.rankPart,
                pts(facts.byPlayer, platform, facts.teamTotal),
                LineupBasis.gamePart(facts.lines, facts.zone, facts.now),
                if (long) null else finalsPhone(facts.lines, facts.now, platform),
            )
        return parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(" ")
    }

    /** basis.ts projMatchupParts as the phone draws them: "Proj is this week's published projection, PPR
     * shown, nearest FFPC's rules, read Fri 9:00 pm.", and on a crowded phone without its read time. */
    private fun proj(
        projection: Projection,
        facts: Facts,
        crowded: Boolean,
    ): String {
        val read = projection.readAt?.let { "read ${Format.weekdayTime(it, facts.zone)}" } ?: "not in yet"
        val whenRead = if (crowded) "" else ", $read"
        return "${Words.Box.proj} is this week's published projection" +
            "${BasisParts.scoringWords(projection.scoring, facts.league)}$whenRead."
    }

    /** basis.ts projFinalWords: what Proj final is once a game has kicked off, and why one is "--". */
    private fun projFinalWords(
        started: Boolean,
        missing: Boolean,
    ): String? =
        when {
            !started -> null
            missing -> "${Words.Basis.projFinalPart} ${Words.Basis.noProjFinalPart}"
            else -> Words.Basis.projFinalPart
        }

    /** basis.ts ptsPart: the platform's points by player and what Team is, or its team points alone. */
    private fun pts(
        byPlayer: Boolean,
        platform: String,
        team: Boolean,
    ): String =
        when {
            !byPlayer -> "${Words.Box.pts} are $platform's team points, none by player."
            team -> "${Words.Box.pts} are $platform's points by player so far, each to a tenth, and Team is $platform's score."
            else -> "${Words.Box.pts} are $platform's points so far, Team adds the rows."
        }

    /** basis.ts finalsParts on a phone: when Final and the stats land while a row waits on either, and
     * where a row counts the platform's points for a final, what Avg and Last count meanwhile. */
    private fun finalsPhone(
        lines: List<PlayerLine>,
        now: Instant,
        platform: String,
    ): String? {
        val timing = LineupBasis.kickedOffPart(lines, now)
        val counted = lines.firstOrNull { LineupBasis.platformGame(it) != null } ?: return timing
        val game = LineupBasis.platformGame(counted) ?: return timing
        val (avg, last, stats) = Triple(Words.Box.avg, Words.Box.last, Words.Basis.statsByWednesday)
        return when {
            timing != null -> "$avg and $last count $platform's finals, our stats $stats"
            lines.any { LineRead.game(it, now) == GameRead.KickedOff } ->
                "${LineupBasis.finalLands}, $avg and $last then count $platform's points, our stats $stats"
            else ->
                "$avg and $last count ${LineupBasis.weeksWord(game.week, counted.facts.week)} finals from $platform's points, " +
                    "our stats $stats"
        }
    }
}
