package app.trycommish.core.waivers

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.start.BasisParts
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.LineupBasis
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/**
 * The Waivers basis as a phone says it once under the table (waivers.ts waiverBasis, drawnText for the
 * phone): the API's pickup rule, its Gain sentence without the A game head the line under the heads
 * says, what Proj is (none before the week's projection is read), when Final and the stats land or what
 * free agents' Avg and Last are, Opp, and the rules our stats lack. A port, held to the web's paragraph
 * at every clock by the parity file.
 */
internal object WaiverBasis {
    private val sentenceEnd = Regex("(?<=\\.)\\s+")

    fun phone(
        advice: WaiverAdvice,
        zone: ZoneId,
        now: Instant,
    ): String {
        val lines = advice.rows.map { it.add } + advice.roster
        val arrives = WaiverWords.arrives(advice, zone)
        val parts =
            listOf(
                advice.basis,
                seasonWords(advice.seasonBasis),
                if (arrives == null) proj(advice, lines, zone, now) else null,
                finals(lines, now),
                Words.Basis.oppPhone,
                BasisParts.uncounted(advice.basisNote, advice.basisNoteList, lines),
            )
        return parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(" ")
    }

    /** waivers.ts seasonBasisWords: the API's season basis without its sentence for the A game head. */
    fun seasonWords(basis: String): String {
        val head = "${Words.Waivers.rest} is "
        return basis
            .split(sentenceEnd)
            .filter { it.isNotEmpty() && !it.startsWith(head) }
            .joinToString(" ")
    }

    /** basis.ts projPhonePart on a league's rows: "Proj is this week's published projection, PPR nearest
     * your rules, read Fri 9:00 pm, as of kickoff once started.", "week 7's" on a page turned to week 7,
     * with no platform named (waiverBasis names none), and the tight end's extra after it. */
    private fun proj(
        advice: WaiverAdvice,
        lines: List<PlayerLine>,
        zone: ZoneId,
        now: Instant,
    ): String {
        val scoring = advice.projectionScoring
        val week = LineupBasis.weeksWord(advice.forWeek ?: advice.week, advice.week)
        val read = instantOrNull(advice.projectionReadAt)?.let { "read ${Format.weekdayTime(it, zone)}" } ?: "not in yet"
        val asOf = if (LineRead.anyKicked(lines, now)) ", ${Words.Basis.asOfKickoff}" else ""
        val said = "${Words.Box.proj} is $week published projection${BasisParts.scoringWords(scoring, null)}, $read$asOf."
        return BasisParts.teBonusSentence(scoring.teBonus, null)?.let { "$said $it" } ?: said
    }

    /** basis.ts waiverFinalsParts: once a row counts the platform's points, the free agents' own state;
     * else when Final and the stats land. */
    private fun finals(
        lines: List<PlayerLine>,
        now: Instant,
    ): String? {
        val game = lines.firstNotNullOfOrNull(LineupBasis::platformGame) ?: return LineupBasis.kickedOffPart(lines, now)
        return "Free agents' ${Words.Box.avg} and ${Words.Box.last} are our stats, week ${game.week}'s ${Words.Basis.statsByWednesday}"
    }
}
