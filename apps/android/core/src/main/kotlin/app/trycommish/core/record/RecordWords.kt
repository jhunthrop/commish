package app.trycommish.core.record

import app.trycommish.api.models.RunRecordLine
import app.trycommish.api.models.RunRecordWeek
import app.trycommish.api.models.RunRecordWeekStatus
import app.trycommish.api.models.RunScore
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import java.math.BigDecimal
import java.time.Instant
import java.time.ZoneId

/** The record's words the web builds with a function (web/src/lib/run/record.ts, records.ts,
 * record-pair.ts and format/date.ts), ported over the generated words as iOS's RecordWords and held to
 * the web's page by shared/fixtures/parity/record.json. */
internal object RecordWords {
    /** format/date.ts: the site's dates on the Eastern clock, the one the NFL keeps. */
    private val eastern: ZoneId = ZoneId.of("America/New_York")

    /** format/day-time.ts BUILD_ZONE: the clock the record's set times are said on. */
    private val buildZone: ZoneId = ZoneId.of("America/Chicago")

    /** record.ts RATE_PLACES: order matched prints the run's two decimals. */
    const val RATE_PLACES = 2

    // Dates.

    /** date.ts dayLabel: "Oct 12". */
    fun day(at: String): String = instantOrNull(at)?.let { Format.shortDay(it, eastern) }.orEmpty()

    /** date.ts weekdayLabel: "Thu Oct 15". */
    fun weekdayDay(at: String): String = instantOrNull(at)?.let { Format.weekdayDay(it, eastern) }.orEmpty()

    /** date.ts weekdayWord: "Thursday". */
    fun weekdayWord(at: Instant): String = Format.weekdayName(at, eastern)

    /** day-time.ts dayTimeStamp on the build's clock: "Thu Oct 22, 1:00 pm Central". */
    fun dayTimeStamp(at: String): String {
        val instant = instantOrNull(at) ?: return ""
        return "${Format.weekdayDay(instant, buildZone)}, ${Format.timeOfDay(instant, buildZone)} ${Format.zoneWord(buildZone)}"
    }

    // Figures.

    /** record.ts capitalized. */
    fun capitalized(words: String): String = words.replaceFirstChar { it.uppercase() }

    /** record.ts printPlaces: a figure the run rounded, its places filled out, never rounded again. */
    fun printPlaces(
        value: BigDecimal,
        places: Int,
    ): String {
        val text = if (value.signum() == 0) "0" else value.stripTrailingZeros().toPlainString()
        val whole = text.substringBefore('.')
        val fraction = text.substringAfter('.', "")
        return "$whole.${fraction.padEnd(maxOf(places, fraction.length), '0')}"
    }

    /** record.ts figureWords: two decimals for order matched, one for places off, "50 of 84". */
    fun figure(
        score: RunScore?,
        figure: RecordFigure,
    ): String {
        if (score == null) return Words.RecordBox.none
        return when (figure) {
            RecordFigure.Agreement -> score.agreement?.let { printPlaces(it, RATE_PLACES) } ?: TOO_FEW
            RecordFigure.PlacesOff -> score.placesOff?.let { printPlaces(it, 1) } ?: Words.RecordBox.none
            RecordFigure.Starters -> if (score.startersOf == 0) Words.RecordBox.none else "${score.starters} of ${score.startersOf}"
        }
    }

    /** A source's head: Ours, ADP, ESPN, Published. */
    fun head(source: RecordSource): String =
        when (source) {
            RecordSource.Ours -> Words.RecordBox.ours
            RecordSource.Adp -> Words.RecordBox.adp
            RecordSource.Espn -> Words.RecordBox.espn
            RecordSource.Published -> Words.RecordBox.published
        }

    /** A line's score for an order. */
    fun score(
        line: RunRecordLine?,
        source: RecordSource,
    ): RunScore? =
        when (source) {
            RecordSource.Ours -> line?.ours
            RecordSource.Adp -> line?.adp
            RecordSource.Espn -> line?.espn
            RecordSource.Published -> line?.published
        }

    /** Ours pooled again over the weeks that graded a yardstick (record.ts OURS_ON). */
    fun oursOn(
        line: RunRecordLine?,
        source: RecordSource,
    ): RunScore? =
        when (source) {
            RecordSource.Espn -> line?.oursOnEspn
            RecordSource.Published -> line?.oursOnPublished
            RecordSource.Ours, RecordSource.Adp -> null
        }

    /** record.ts besideOf: a yardstick's figure with ours over the same weeks. */
    fun beside(
        line: RunRecordLine?,
        source: RecordSource,
        figure: RecordFigure,
    ): Pair<String, String?> = figure(score(line, source), figure) to oursOn(line, source)?.let { "${Words.RecordBox.ours} ${figure(it, figure)}" }

    // Weeks.

    /** "weeks 1 to 3", "week 1". */
    fun span(weeks: List<Int>): String {
        val first = weeks.firstOrNull() ?: return ""
        val last = weeks.last()
        return if (first == last) "week $first" else "weeks $first to $last"
    }

    /** records.ts spanLead: "Week 7", "Weeks 8 to 18". */
    fun spanLead(weeks: List<Int>): String {
        val first = weeks.firstOrNull() ?: 0
        val last = weeks.lastOrNull() ?: first
        return if (first == last) "Week $first" else "Weeks $first to $last"
    }

    fun lead(weeks: List<RunRecordWeek>): String = capitalized(span(weeks.map { it.week }))

    /** record.ts reason: a missed week's note as a clause. */
    fun reason(week: RunRecordWeek): String =
        week.note
            .orEmpty()
            .removeSuffix(".")
            .removeSuffix(" that week")
            .replaceFirstChar { it.lowercase() }

    /** record.ts runsOf with joins: every run of weeks with the same status, missed weeks with the same
     * reason, upcoming weeks together. */
    fun runs(weeks: List<RunRecordWeek>): List<List<RunRecordWeek>> =
        weeks.fold(emptyList()) { runs, week ->
            val last = runs.lastOrNull()
            if (last != null && joins(last.first(), week)) runs.dropLast(1) + listOf(last + week) else runs + listOf(listOf(week))
        }

    private fun joins(
        first: RunRecordWeek,
        week: RunRecordWeek,
    ): Boolean {
        if (first.status != week.status) return false
        if (week.status == RunRecordWeekStatus.missed) return reason(first) == reason(week)
        return week.status == RunRecordWeekStatus.upcoming
    }

    private const val TOO_FEW = "Too few"
}
