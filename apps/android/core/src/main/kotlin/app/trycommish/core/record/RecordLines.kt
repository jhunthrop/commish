package app.trycommish.core.record

import app.trycommish.api.models.OrderBasis
import app.trycommish.api.models.RunRecordPosition
import app.trycommish.api.models.RunRecordWeek
import app.trycommish.api.models.RunRecordWeekStatus
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words

/** One line of the week list: a week, or a run of missed or upcoming weeks said once (record.ts
 * WeekLine). */
internal data class WeekLine(
    val lead: String,
    val text: String,
    val week: RunRecordWeek?,
)

/** The record's sentences over its weeks (record.ts and records.ts), ported as iOS's RecordLines. */
internal object RecordLines {
    private val graded = RunRecordWeekStatus.graded
    private val frozen = RunRecordWeekStatus.frozen
    private val missed = RunRecordWeekStatus.missed
    private val upcoming = RunRecordWeekStatus.upcoming

    /** record.ts standingWords: "Graded 2 of 5 weeks played", null before any week is played. */
    fun standing(book: RecordBook): String? {
        val gradedCount = book.weeks.count { it.status == graded }
        val played = gradedCount + book.weeks.count { it.status == missed }
        return if (played == 0) null else "Graded $gradedCount of ${Format.plural(played, "week", "weeks")} played"
    }

    /** record.ts gapWords: why the played weeks not graded are not. */
    fun gaps(
        book: RecordBook,
        unplayed: List<Int>,
    ): String {
        val missedLines =
            RecordWords.runs(book.weeks).filter { it.first().status == missed }.map { run ->
                val lead = RecordWords.lead(run)
                if (run.size == 1) {
                    "$lead was not set before kickoff, so it cannot be graded."
                } else {
                    "$lead were not set before kickoff, so they cannot be graded."
                }
            }
        val waiting =
            book.weeks.filter { it.status == frozen && it.week !in unplayed }.map { week ->
                val lead = RecordWords.lead(listOf(week))
                "$lead ${gradesWhen(week.gradesFrom?.let(::weekdayWordOf))}."
            }
        return (missedLines + waiting).joinToString(" ")
    }

    private fun weekdayWordOf(at: String): String = instantOrNull(at)?.let(RecordWords::weekdayWord).orEmpty()

    /** record.ts gradesWhen: the rule a set week waits on, with the day it usually holds when the run
     * names one: "grades once every game's stats are in, usually Wednesday". */
    fun gradesWhen(day: String?): String = day?.let { "${Words.Record.gradesRule}, ${Words.Record.usually} $it" } ?: Words.Record.gradesRule

    /** record.ts recordHeadline: the one figure and its caption. */
    fun headline(book: RecordBook): Pair<String, String> {
        val gradedWeeks = book.weeks.filter { it.status == graded }
        val overall = book.toDate.firstOrNull { it.position == RunRecordPosition.All }
        val agreement = overall?.ours?.agreement
        if (overall != null && agreement != null && gradedWeeks.isNotEmpty()) {
            val part =
                listOf(RecordSource.Adp, RecordSource.Espn, RecordSource.Published)
                    .firstNotNullOfOrNull { source -> RecordWords.score(overall, source)?.let { source to it } }
                    ?.let { (source, score) ->
                        score.agreement?.let {
                            ". ${RecordWords.head(source)} ${RecordWords.printPlaces(it, RecordWords.RATE_PLACES)} on the same players"
                        }
                    }.orEmpty()
            return RecordWords.printPlaces(agreement, RecordWords.RATE_PLACES) to
                "${RecordWords.capitalized(book.statistic.agreement)}, ours over " +
                "${RecordWords.span(gradedWeeks.map { it.week })} and " +
                "${Format.plural(overall.ours.graded, "player", "players")}$part."
        }
        val set = book.weeks.count { it.status == graded || it.status == frozen }
        return gradedWeeks.size.toString() to if (set == 0) Words.Record.noneSet else "of ${Format.plural(set, "week", "weeks")} set graded"
    }

    /** record.ts weekLines: each run of missed weeks one line, every week still to come one line. */
    fun weekLines(
        weeks: List<RunRecordWeek>,
        unplayed: List<Int>,
        underway: List<Int>,
    ): List<WeekLine> =
        RecordWords.runs(weeks).map { run ->
            val first = run.first()
            if (first.status == missed || first.status == upcoming) {
                WeekLine(RecordWords.lead(run), runWords(run), null)
            } else {
                WeekLine(RecordWords.lead(run), frozenWords(first, unplayed, underway), first)
            }
        }

    /** record.ts runWords. */
    private fun runWords(run: List<RunRecordWeek>): String {
        val first = run.first()
        if (first.status == missed) return "${RecordWords.reason(first)}, so ${if (run.size == 1) "it" else "they"} cannot be graded"
        return first.frozenAt?.let { "set before kickoff ${RecordWords.weekdayDay(it)}" }
            ?: "our first order is set before its first kickoff"
    }

    /** record.ts frozenWords: "set Tue Sep 8, graded Wed Oct 14". */
    private fun frozenWords(
        week: RunRecordWeek,
        unplayed: List<Int>,
        underway: List<Int>,
    ): String {
        val set = "set ${week.frozenAt?.let(RecordWords::weekdayDay).orEmpty()}"
        return when {
            week.status == graded -> "$set, graded ${week.gradedAt?.let(RecordWords::weekdayDay).orEmpty()}"
            week.week in unplayed -> "$set, ${Words.Record.notPlayed}"
            week.week in underway -> "$set, ${Words.Record.underway}"
            else -> "$set, ${gradesWhen(week.gradesFrom?.let(RecordWords::weekdayDay))}"
        }
    }

    /** records.ts weeklyLines: each set week with its own set time, the missed weeks as the record says
     * them, the next week to set on its own line and the rest once. */
    fun weeklyLines(
        weeks: List<RunRecordWeek>,
        unplayed: List<Int>,
        underway: List<Int>,
    ): List<WeekLine> {
        val coming = weeks.filter { it.status == upcoming }
        val lines =
            weekLines(weeks.filter { it.status != upcoming }, unplayed, underway).map { line ->
                line.week?.let { WeekLine(line.lead, setWeekText(it, unplayed, underway), it) } ?: line
            }
        val next = coming.firstOrNull() ?: return lines
        val nextLine =
            WeekLine(
                RecordWords.spanLead(listOf(next.week)),
                next.frozenAt?.let { "set before kickoff ${RecordWords.weekdayDay(it)}" } ?: Words.Records.setUnknown,
                null,
            )
        val rest = coming.drop(1).map { it.week }
        val restLine = if (rest.isEmpty()) emptyList() else listOf(WeekLine(RecordWords.spanLead(rest), Words.Records.setEach, null))
        return lines + nextLine + restLine
    }

    /** records.ts setWeekText: "set Thu Oct 22, 1:00 pm Central, graded Wed Oct 28". */
    private fun setWeekText(
        week: RunRecordWeek,
        unplayed: List<Int>,
        underway: List<Int>,
    ): String {
        val set = "set ${week.frozenAt?.let(RecordWords::dayTimeStamp).orEmpty()}"
        val gradedAt = week.gradedAt
        val then =
            when {
                week.status == graded && gradedAt != null -> "graded ${RecordWords.weekdayDay(gradedAt)}"
                week.week in unplayed -> Words.Records.notPlayed
                week.week in underway -> Words.Records.underway
                else -> gradesWhen(week.gradesFrom?.let(RecordWords::weekdayDay))
            }
        return "$set, $then"
    }

    /** records.ts weeklyPending: "Week 7 not graded yet", "Grades once every game's stats are in, usually
     * Wed Oct 28."; null once a week is graded. */
    fun pending(
        book: RecordBook,
        next: NextGrade?,
    ): Pair<String, String>? {
        if (next == null || book.weeks.any { it.status == graded }) return null
        val day =
            book.weeks
                .firstOrNull { it.week == next.week }
                ?.gradesFrom
                ?.let(RecordWords::weekdayDay)
        val game = next.lastKickoff?.let(RecordWords::weekdayWord)
        val whenSaid =
            if (day == null && game != null) {
                "${RecordWords.capitalized(Words.Record.gradesRule)}, after $game's game."
            } else {
                "${RecordWords.capitalized(gradesWhen(day))}."
            }
        return "Week ${next.week} not graded yet" to whenSaid
    }

    /** record.ts gradedOrders: "Our preseason order, then our rest-of-season order". */
    fun gradedOrders(book: RecordBook): String =
        book.weeks
            .filter { it.status == graded }
            .mapNotNull { week -> week.order?.let(::orderWords) }
            .distinct()
            .mapIndexed { index, order -> if (index == 0) order else "our" + order.removePrefix("Our") }
            .joinToString(", then ")

    /** record.ts ORDER_WORDS. */
    private fun orderWords(order: OrderBasis): String? =
        when (order) {
            OrderBasis.preseason -> Words.RecordOrder.preseason
            OrderBasis.rest_of_season -> Words.RecordOrder.rest_of_season
            else -> null
        }

    /** record.ts weekOrderWords: "Our rest-of-season order, refreshed Oct 22". */
    fun weekOrder(week: RunRecordWeek): String? {
        val order = week.order ?: return null
        val named = orderWords(order) ?: return null
        val asOf = week.orderAsOf
        return if (order == OrderBasis.rest_of_season && asOf != null) "$named, refreshed ${RecordWords.day(asOf)}" else named
    }

    /** records.ts weeklyOrderWords: "Our rest-of-season order, set Oct 22", the date from the week's frozen
     * stamp, never the clock (Lane 223, B188). */
    fun weeklyOrder(week: RunRecordWeek): String? {
        val frozenAt = week.frozenAt
        return if (week.order == null || frozenAt == null) null else "${Words.RecordOrder.rest_of_season}, set ${RecordWords.day(frozenAt)}"
    }

    /** records.ts beforeLine: the weeks before the weekly record with the set rule said once. */
    fun before(fromWeek: Int): Pair<String, String>? {
        if (fromWeek <= 1) return null
        return (if (fromWeek <= 2) "Week 1" else "Weeks 1 to ${fromWeek - 1}") to
            "${Words.RecordOrder.rest_of_season} is graded week by week from week $fromWeek. " +
            "Each week's order is set before its first kickoff " +
            "and graded as set, never as refreshed after, so a player put on IR later keeps the rank we set. " +
            "Before that the site shipped the draft board, graded under ${Words.Records.draft}."
    }
}
