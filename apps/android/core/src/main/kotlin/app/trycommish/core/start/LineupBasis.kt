package app.trycommish.core.start

import app.trycommish.api.models.GamePoints
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LineupAdvice
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.ProjectionScoring
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** The basis sentences' shared parts (web basis.ts and league/names.ts). */
internal object BasisParts {
    /** basis.ts leagueScoringWords: " on your rules", ", PPR nearest your rules", or for a league whose
     * rules add a tight end's extra ", PPR shown, nearest FFPC's rules". */
    fun scoringWords(
        scoring: ProjectionScoring,
        league: LeagueHost?,
    ): String {
        val format = ValueWords.format(scoring.format)
        return when {
            scoring.leagueOwn -> " on your rules"
            scoring.teBonus == null -> ", $format nearest your rules"
            else -> ", $format shown, nearest ${rulesOwner(league)}'s rules"
        }
    }

    /** basis.ts teBonusSentence: "FFPC adds 0.5 a catch for TEs.", null without one. */
    fun teBonusSentence(
        bonus: Double?,
        league: LeagueHost?,
    ): String? = bonus?.let { "${rulesOwner(league).replaceFirstChar { c -> c.uppercase() }} adds ${Format.number(it)} a catch for TEs." }

    /** names.ts rulesOwner: FFPC fixes its own rules; on any other platform, and with none named, the
     * league's commissioner does. */
    fun rulesOwner(league: LeagueHost?): String = if (league == LeagueHost.ffpc) ValueWords.platform(LeagueHost.ffpc) else "your league"

    /** basis.ts uncountedPart: the rules our stats lack, framed by whether any row counts the platform's
     * points; an answer without the list says its note as sent. */
    fun uncounted(
        note: String,
        list: String?,
        lines: List<PlayerLine>,
    ): String {
        val names = list.orEmpty()
        if (names.isEmpty()) return note
        return if (lines.any { LineupBasis.platformGame(it) != null }) {
            "Our stats omit $names."
        } else {
            "${Words.Box.avg} and ${Words.Box.last} are our stats, which omit $names."
        }
    }

    /** basis.ts projFinalPhone: why the Proj final is "--" where it is, else what it adds; nothing before
     * kickoff. */
    fun projFinalPhone(
        started: Boolean,
        missing: Boolean,
    ): String =
        when {
            !started -> ""
            missing -> Words.Basis.noProjFinalPart
            else -> Words.Basis.projFinalPart
        }

    /** basis.ts finalNonePart: why a side's Final reads "--". */
    fun finalNonePart(platform: String): String = "A ${Words.Box.final} of ${Words.Box.none} is a score $platform does not send us."

    /** basis.ts unlistedPart: what the teams a platform sends no lineup for draw, said once. */
    fun unlistedPart(
        platform: String,
        drawn: UnlistedDrawn,
        form: UnlistedForm,
    ): String {
        val from = if (drawn.skipped) Words.BestLineupFrom.projected else Words.BestLineupFrom.rosters
        val paceWords = if (form == UnlistedForm.Full) Words.Basis.paceClause else Words.Basis.paceClauseShort
        val pace = if (drawn.paced) ", $paceWords" else ""
        if (form == UnlistedForm.One && drawn.bestLineup && drawn.noRoster) {
            return "Teams $platform sends no lineup for show our best lineup from $from$pace, or ${Words.Box.none} with none."
        }
        val best =
            if (drawn.bestLineup) "${Words.Box.proj} for teams $platform sends no lineup for is our best lineup from $from$pace." else ""
        val none = if (drawn.noRoster) "Teams $platform sends no lineup or roster for show ${Words.Box.none}." else ""
        return listOf(best, none).filter { it.isNotEmpty() }.joinToString(" ")
    }
}

/** How much of the unlisted sides' words a basis says (basis.ts UnlistedForm). */
enum class UnlistedForm { Full, Short, One }

/** What the sides a platform lists no starters for draw (basis.ts UnlistedDrawn). */
data class UnlistedDrawn(
    val bestLineup: Boolean = false,
    val noRoster: Boolean = false,
    val paced: Boolean = false,
    val skipped: Boolean = false,
) {
    /** basis.ts unlistedLong. */
    val long: Boolean get() = bestLineup && (paced || skipped || noRoster)
}

/**
 * The Lineup's basis as a phone says it once under the rows (basis.ts boxBasisParts on the Lineup,
 * drawnText for the phone): the rule our pick follows with what Proj is, the Proj final, the Game cell,
 * when Final and the stats land while a row waits on either, Our rank and Opp, Pts and the rules our
 * stats lack. A port, held to the web's paragraph at every clock by the parity file.
 */
internal object LineupBasis {
    data class Facts(
        val advice: LineupAdvice,
        val league: LeagueHost,
        /** Every line on the screen: each slot's player and the starter a change sits, the bench, the
         * injured reserve. */
        val lines: List<PlayerLine>,
        val totals: LineupTotals,
        val zone: ZoneId,
        val now: Instant,
        /** The platform's words: the league's own, or the store graphics' neutral one (Lane 310). */
        val host: HostWords = HostWords.of(league),
    )

    private val pickPhone = "Our pick is each slot's highest ${Words.Box.proj},"
    val finalLands = "${Words.Box.final} lands the hour after a game"

    fun phone(facts: Facts): String {
        val advice = facts.advice
        val kicked = LineRead.anyKicked(facts.lines, facts.now)
        val projFinal = kicked && !facts.totals.allFinal
        val noFinal = facts.totals.live && facts.totals.final == null
        val parts =
            listOf(
                pickProj(facts, kicked),
                BasisParts.projFinalPhone(projFinal, noFinal),
                gamePart(facts.lines, facts.zone, facts.now),
                if (drawsFacts(facts)) null else finalsPhone(facts),
                Words.Basis.rankOppPhone,
                ptsPhone(advice.playerPoints, facts.host.name),
                BasisParts.uncounted(advice.basisNote, advice.basisNoteList, facts.lines),
            )
        return parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(" ")
    }

    /** basis.ts pickProjPart: "Our pick is each slot's highest Proj, this week's published projection,
     * PPR shown, nearest FFPC's rules, read Fri 9:00 pm, as of kickoff once started." and the tight
     * end's extra after it. */
    private fun pickProj(
        facts: Facts,
        kicked: Boolean,
    ): String {
        val scoring = facts.advice.projectionScoring
        val read = instantOrNull(facts.advice.projectionReadAt)?.let { "read ${Format.weekdayTime(it, facts.zone)}" } ?: "not in yet"
        val asOf = if (kicked) ", ${Words.Basis.asOfKickoff}" else ""
        val said = "$pickPhone this week's published projection${BasisParts.scoringWords(scoring, facts.league)}, $read$asOf."
        return BasisParts.teBonusSentence(scoring.teBonus, facts.league)?.let { "$said $it" } ?: said
    }

    /** basis.ts gamePart 'full': the oldest read of any game still to be played. */
    fun gamePart(
        lines: List<PlayerLine>,
        zone: ZoneId,
        now: Instant,
    ): String? =
        lines
            .filter { LineRead.game(it, now).toPlay }
            .flatMap { listOfNotNull(it.facts.gameTotal?.readAt, it.facts.weather?.readAt) }
            .mapNotNull(::instantOrNull)
            .minOrNull()
            ?.let { "${Words.Box.game} is each club's expected points, his first, and weather, read ${Format.weekdayTime(it, zone)}." }

    /** Whether a row still to be played draws its expected score or weather (basis.ts drawsFacts): the
     * phone then keeps those cells' sentence and leaves when Final lands to the desk. */
    private fun drawsFacts(facts: Facts): Boolean =
        facts.lines.any { line ->
            LineRead.game(line, facts.now).toPlay && (StartRows.expected(line.facts) != null || StartRows.weather(line.facts) != null)
        }

    /** basis.ts finalsParts as the phone draws them: when Final and the stats land while a row waits, the
     * platform's points named where a row counts them. */
    private fun finalsPhone(facts: Facts): String? {
        val timing = kickedOffPart(facts.lines, facts.now)
        val counted = facts.lines.firstOrNull { platformGame(it) != null } ?: return timing
        val game = platformGame(counted) ?: return timing
        val platform = facts.host.name
        val stats = Words.Basis.statsByWednesday
        val (avg, last) = Words.Box.avg to Words.Box.last
        if (timing != null) return "$avg and $last count $platform's finals, our stats $stats"
        return if (facts.lines.any { LineRead.game(it, facts.now) == GameRead.KickedOff }) {
            "$finalLands, $avg and $last then count $platform's points, our stats $stats"
        } else {
            "$avg and $last count ${weeksWord(game.week, counted.facts.week)} finals from $platform's points, our stats $stats"
        }
    }

    /** basis.ts kickedOffPartAt: when Final and the stats land, while a row is in play or final with the
     * week's stats not in his games yet. */
    fun kickedOffPart(
        lines: List<PlayerLine>,
        now: Instant,
    ): String? {
        val waiting =
            lines.any { line ->
                val read = LineRead.game(line, now)
                val ours = line.facts.lastGames.any { it.week == line.facts.week && !fromPlatform(it) }
                read == GameRead.KickedOff || (read == GameRead.Final && !ours)
            }
        return if (waiting) Words.Basis.kickedOffPart else null
    }

    /** The first game a line counts from the platform's points, null with none. */
    fun platformGame(line: PlayerLine): GamePoints? = line.facts.lastGames.firstOrNull(::fromPlatform)

    private fun fromPlatform(game: GamePoints): Boolean = game.source == GamePoints.Source.platform

    /** basis.ts weeksWord: "this week's", or "week 7's" on a page turned past the platform's week. */
    fun weeksWord(
        week: Int,
        platformWeek: Int,
    ): String = if (week == platformWeek) "this week's" else "week $week's"

    /** basis.ts ptsPhonePart. */
    private fun ptsPhone(
        byPlayer: Boolean,
        platform: String,
    ): String =
        if (byPlayer) {
            "${Words.Box.pts} are $platform's points so far."
        } else {
            "${Words.Box.pts} are $platform's team points alone."
        }
}
