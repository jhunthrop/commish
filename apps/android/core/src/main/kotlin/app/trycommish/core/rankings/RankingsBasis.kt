package app.trycommish.core.rankings

import app.trycommish.api.models.OrderAdvice
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.ProjectionScoring
import app.trycommish.api.models.WeekOrderAdvice
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.start.BasisParts
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.LineupBasis
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** The Rankings' bases as a phone says them with no league (order.ts orderBasis and week.ts weekBasis,
 * drawnText for the phone), ported as iOS's RankingsBasis and held to the web's paragraphs by the parity
 * file. */
internal object RankingsBasis {
    /** orderBasis with no league: the API's basis, the week column and what its Proj is, Opp, and when
     * Final and the stats land while a row waits on either. */
    fun order(
        advice: OrderAdvice,
        zone: ZoneId,
        now: Instant,
    ): String {
        val lines = advice.rows.map { it.line }
        val week =
            "${RankingsWords.weekHead(advice.week)} is ${Words.Box.pts} once final, " +
                "${Words.Box.none} until his stats land, ${Words.Box.proj} before."
        val projected = proj(instantOrNull(advice.projectionReadAt), advice.projectionScoring, lines, zone, now)
        return said(advice.basis, "$week $projected", Words.Basis.oppPhone, LineupBasis.kickedOffPart(lines, now))
    }

    /** basis.ts projPart for a reader with no league: "Proj is this week's published projection in PPR,
     * read Fri 9:00 pm Central, as of kickoff once started." */
    private fun proj(
        readAt: Instant?,
        scoring: ProjectionScoring,
        lines: List<PlayerLine>,
        zone: ZoneId,
        now: Instant,
    ): String {
        val read = readAt?.let { "read ${stamp(it, zone)}" } ?: "not in yet"
        val kicked = if (LineRead.anyKicked(lines, now)) ", ${Words.Basis.asOfKickoff}" else ""
        return "${Words.Box.proj} is this week's published projection in ${ValueWords.format(scoring.format)}, $read$kicked."
    }

    /** basis.ts stamp with the zone said: "Fri 9:00 pm Central". */
    fun stamp(
        instant: Instant,
        zone: ZoneId,
    ): String = "${Format.weekdayTime(instant, zone)} ${Format.zoneWord(zone)}"

    /** weekBasis with no league, the phone's parts: the order with the model we lack, Opp rank, Avg and
     * Last in the scoring the rows are in, and the Game cell's read. */
    fun week(
        advice: WeekOrderAdvice,
        position: WeekPosition,
        boardScoring: String,
        zone: ZoneId,
        now: Instant,
    ): String {
        val many = RankingsWords.many(position)
        val whose = if (position == WeekPosition.K) "his" else "its"
        val scoring = if (position == WeekPosition.DEF) Words.DefenseScoring.standard else "in $boardScoring"
        return said(
            orderSentence(advice, position, boardScoring, zone),
            "${Words.Box.oppRank} is points allowed to $many this season, 1st the fewest.",
            "${Words.Box.avg} and ${Words.Box.last} are $whose points a game and last game, $scoring.",
            gameSentence(advice, position, zone, now),
        )
    }

    /** week.ts orderSentence for a reader with no league. */
    private fun orderSentence(
        advice: WeekOrderAdvice,
        position: WeekPosition,
        boardScoring: String,
        zone: ZoneId,
    ): String {
        val capital = RankingsWords.many(position).replaceFirstChar { it.uppercase() }
        if (!RankingsWords.landed(advice)) return "$capital are in order of ${Words.Box.avg} until this week's published projection is in."
        val how = if (position == WeekPosition.DEF) Words.DefenseScoring.standard else "in $boardScoring scoring"
        val whenRead = instantOrNull(advice.projectionReadAt)?.let { ", read ${stamp(it, zone)}" }.orEmpty()
        return "$capital are in order of ${Words.Box.proj}, this week's published projection $how$whenRead, " +
            "as we have no ${RankingsWords.one(position)} model of our own."
    }

    /** week.ts gameSentence: the Game cell's read, or that its figures come later; none with no game to
     * play. */
    private fun gameSentence(
        advice: WeekOrderAdvice,
        position: WeekPosition,
        zone: ZoneId,
        now: Instant,
    ): String? {
        if (advice.rows.none { RankingsRows.section(it, now) == WeekSection.ToPlay }) return null
        val read =
            advice.rows
                .map { it.line }
                .filter { LineRead.game(it, now).toPlay }
                .flatMap { listOfNotNull(it.facts.gameTotal?.readAt, it.facts.weather?.readAt) }
                .mapNotNull(::instantOrNull)
                .minOrNull()
                ?: return "The ${Words.Box.game} cell shows the opponent and kickoff. Expected points and weather come later in the week."
        val first = if (position == WeekPosition.K) "his first" else "the defense's first"
        return "${Words.Box.game} is each club's expected points, $first, and the kickoff weather, read ${stamp(read, zone)}."
    }

    /** week.ts rulesLeftOut: the rules Avg and Last leave out, in the frame every league screen says them. */
    fun rules(advice: WeekOrderAdvice): String? =
        BasisParts.uncounted(advice.basisNote, advice.basisNoteList, advice.rows.map { it.line }).takeIf { it.isNotEmpty() }

    /** The parts said, in order, the empty ones left out. */
    private fun said(vararg parts: String?): String = parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(" ")
}
