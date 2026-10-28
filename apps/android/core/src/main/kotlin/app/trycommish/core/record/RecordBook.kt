package app.trycommish.core.record

import app.trycommish.api.models.RunGame
import app.trycommish.api.models.RunGameState
import app.trycommish.api.models.RunRecord
import app.trycommish.api.models.RunRecordLine
import app.trycommish.api.models.RunRecordStatistic
import app.trycommish.api.models.RunRecordWeek
import app.trycommish.api.models.RunRecordWeekStatus
import app.trycommish.api.models.RunSchedule
import app.trycommish.api.models.RunWeeklyRecord
import app.trycommish.core.instantOrNull
import java.time.Duration
import java.time.Instant

/** A record in the one shape the record page reads (web/src/lib/run/records.ts weeklyAsRecord): the
 * run's own record, or its weekly record read in the run's own shape, so one set of functions says
 * either. */
internal data class RecordBook(
    val statistic: RunRecordStatistic,
    val scale: String,
    val startersBasis: String?,
    val method: String,
    val publishedFromWeek: Int?,
    val honest: String?,
    val weeks: List<RunRecordWeek>,
    val toDate: List<RunRecordLine>,
) {
    companion object {
        /** The run's own record. */
        fun own(run: RunRecord): RecordBook =
            RecordBook(run.statistic, run.scale, run.startersBasis, run.method, run.publishedFromWeek, run.honest, run.weeks, run.toDate)

        /** records.ts weeklyAsRecord: the weekly record, its published projection's first week the first
         * graded week whose lines carry it. */
        fun weekly(weekly: RunWeeklyRecord): RecordBook =
            RecordBook(
                statistic = weekly.statistic,
                scale = weekly.scale,
                startersBasis = weekly.startersBasis,
                method = weekly.method,
                publishedFromWeek =
                    weekly.weeks
                        .firstOrNull { week -> week.status == RunRecordWeekStatus.graded && week.lines.any { it.published != null } }
                        ?.week,
                honest = weekly.honest,
                weeks = weekly.weeks,
                toDate = weekly.toDate,
            )
    }
}

/** The orders a record row compares, ours first (record.ts RECORD_SOURCES). */
internal enum class RecordSource { Ours, Adp, Espn, Published }

/** The three figures a record row gives each order (record.ts RECORD_FIGURES), by the parity file's
 * names. */
enum class RecordFigure(
    val key: String,
) {
    Agreement("agreement"),
    PlacesOff("placesOff"),
    Starters("starters"),
}

/** A set week not played yet or under way at the screen's clock, by the run's schedule
 * (server/pages/week-state.ts weekStates, the one rule every screen reads). */
internal data class WeekStates(
    val unplayed: List<Int> = emptyList(),
    val underway: List<Int> = emptyList(),
) {
    /** One week's games as one read (kickoff.ts linesRead over each game's factsState). */
    enum class Read { Upcoming, Playing, Final }

    companion object {
        /** week-state.ts GAME_ENDS_AFTER_MS: a game the run has not marked final counts as final four hours
         * after its kickoff. */
        private val gameEndsAfter: Duration = Duration.ofHours(4)

        fun of(
            book: RecordBook,
            schedule: RunSchedule,
            now: Instant,
        ): WeekStates {
            val games = schedule.slates.flatMap { it.games }
            val frozen = book.weeks.filter { it.status == RunRecordWeekStatus.frozen }.map { it.week }
            val read = { week: Int -> read(games.filter { it.week == week }, now) }
            return WeekStates(frozen.filter { read(it) == Read.Upcoming }, frozen.filter { read(it) == Read.Playing })
        }

        /** null for a week with no game on the schedule. */
        fun read(
            games: List<RunGame>,
            now: Instant,
        ): Read? {
            if (games.isEmpty()) return null
            val states =
                games.map { game ->
                    val kickoff = instantOrNull(game.kickoff) ?: Instant.MAX
                    val ended = kickoff != Instant.MAX && !now.isBefore(kickoff.plus(gameEndsAfter))
                    when {
                        game.state == RunGameState.final || ended -> Read.Final
                        game.state == RunGameState.kicked_off -> Read.Playing
                        kickoff.isAfter(now) -> Read.Upcoming
                        else -> Read.Playing
                    }
                }
            if (states.all { it == Read.Final }) return Read.Final
            return if (states.any { it != Read.Upcoming }) Read.Playing else Read.Upcoming
        }
    }
}

/** The weekly record's next week to grade with its last kickoff from the schedule
 * (server/pages/record.ts nextGrade). */
internal data class NextGrade(
    val week: Int,
    val lastKickoff: Instant?,
) {
    companion object {
        fun of(
            book: RecordBook,
            schedule: RunSchedule,
        ): NextGrade? {
            val week =
                book.weeks
                    .firstOrNull { it.status != RunRecordWeekStatus.graded && it.status != RunRecordWeekStatus.missed }
                    ?.week ?: return null
            val last =
                schedule.slates
                    .flatMap { it.games }
                    .filter { it.week == week }
                    .mapNotNull { instantOrNull(it.kickoff) }
                    .maxOrNull()
            return NextGrade(week, last)
        }
    }
}
