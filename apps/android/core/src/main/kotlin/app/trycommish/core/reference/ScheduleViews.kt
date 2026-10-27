package app.trycommish.core.reference

import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunGame
import app.trycommish.api.models.RunSchedule
import app.trycommish.api.models.RunSlate
import app.trycommish.core.Format
import app.trycommish.core.shell.headshotOf
import app.trycommish.design.Words
import kotlin.math.ceil

/** One week's cell of a club's row in the grid (ui/schedule-grid.ts ScheduleCell): the opponent, at or
 * against, his value, shaded among the strongest, set back once played; the bye with none. */
data class ScheduleCell(
    val week: Int,
    /** "vs DEN", "at LAR", null on the bye. */
    val opponent: String?,
    /** The opponent's club, the cell's way to his page; null on the bye. */
    val club: String?,
    val value: String,
    val hard: Boolean,
    val played: Boolean,
    /** The current week's game as the run read it: "Final", "Kicked off", "Sun 12:00 pm CT"; null on any
     * other week (schedule-state.ts, Lane 223). */
    val state: String? = null,
)

/** A club's row of the grid: its rank and strength pinned, its lead player's face and name, its weeks. */
data class ScheduleGridRow(
    val abbr: String,
    val name: String,
    /** The club's first player on the default board: his face and name, null for a club with none. */
    val face: String?,
    val faceName: String?,
    val rank: Int?,
    val strength: String?,
    val cells: List<ScheduleCell>,
)

/** A game on a club's page: the week, the opponent named in full at or against, his value, set back once
 * played. */
data class ClubGame(
    val week: Int,
    /** "Week 1". */
    val weekWords: String,
    /** "at Los Angeles Chargers". */
    val opponent: String,
    val club: String,
    val value: String,
    val played: Boolean,
    /** The current week's game as the run read it, after the opponent; null on any other week. */
    val state: String? = null,
)

/** A club's hero figures (schedule-view.ts ClubHero): its strength headed and read, and its rank. */
data class ClubHero(
    val value: String,
    val caption: String,
    val note: String,
    val hardest: String,
    val hardestCaption: String,
)

/** A club's schedule as its page draws it (schedule-view.ts ClubSchedule). */
class ClubSchedule(
    val hero: ClubHero?,
    val games: List<ClubGame>,
    val caption: String,
    /** The line under the games naming the run's read, null without a current week. */
    val asOf: String?,
)

/** The strength of schedule grid (schedule-view.ts scheduleGrid): every club by week, hardest first, the
 * strongest opponents shaded and the games in set back. */
data class ScheduleGridModel(
    val season: Int,
    val weeks: List<Int>,
    val lead: String,
    val strengthLabel: String?,
    /** The last complete week: its heads are set back. */
    val played: Int,
    val rows: List<ScheduleGridRow>,
    /** The week whose cells say the run's game state, the one the grid opens on; null without one. */
    val current: Int? = null,
    /** "Week 6's games as of Wed Oct 21, 7:00 am Central.", under the grid; null without a current week. */
    val asOf: String? = null,
)

/** The opponents counted strongest and the value they start at. */
data class StrongFloor(
    val count: Int,
    val floor: Double,
)

/** Each club's full name by its abbreviation ("Arizona Cardinals"), the abbreviation where the run names none. */
class ClubNames(
    clubs: List<RunClub>,
) {
    private val names = clubs.associate { it.abbr to "${it.city} ${it.nickname}" }

    fun full(abbr: String): String = names[abbr] ?: abbr
}

/** The run's schedule as the reference pages draw it (web/src/lib/run/schedule-view.ts), ported and held to
 * shared/fixtures/parity/reference.json. */
object ScheduleViews {
    /** schedule-view.ts STRONG_SHARE: the top quarter of the league's opponents are shaded. */
    private const val STRONG_SHARE = 0.25

    /** The strength each slate shows, by club. */
    fun views(
        schedule: RunSchedule,
        underway: Boolean,
    ): Map<String, StrengthView> =
        schedule.slates
            .mapNotNull { slate -> StrengthWords.view(slate, underway)?.let { slate.abbr to it } }
            .distinctBy { it.first }
            .toMap()

    /** strengthFigureOf: the figure and its head with its rank among the slates showing one. */
    fun figure(
        view: StrengthView?,
        count: Int,
    ): StrengthFigure? =
        view?.let {
            StrengthFigure(StrengthWords.figure(it.strength), "${it.kind.head}, ${StrengthWords.hardestWords(it.rank, count)}")
        }

    /** isPlayed: final by its state, or on a run from before the states its week complete. */
    fun played(
        game: RunGame,
        reach: Reach,
    ): Boolean = if (game.state == null) game.week <= reach.complete else SeasonReach.final(game)

    /** strongFloor: the opponents' values counted strongest, ties kept in. */
    fun strongFloor(values: Collection<Double>): StrongFloor {
        val sorted = values.sortedDescending()
        val index = maxOf(0, ceil(sorted.size * STRONG_SHARE).toInt() - 1)
        val floor = sorted.getOrNull(index) ?: Double.POSITIVE_INFINITY
        return StrongFloor(sorted.count { it >= floor }, floor)
    }

    private fun value(
        schedule: RunSchedule,
        abbr: String,
    ): Double = schedule.opponentValues[abbr] ?: 0.0

    private fun at(home: Boolean): String = if (home) Words.ClubPage.home else Words.ClubPage.away

    /** clubSchedule: the hero's figures, every game and the table's caption. */
    fun club(
        club: RunClub,
        schedule: RunSchedule,
        clubs: List<RunClub>,
        played: Reach,
        underway: Boolean,
        states: StatedWeek,
    ): ClubSchedule {
        val views = views(schedule, underway)
        val hero =
            views[club.abbr]?.let { view ->
                val (hardest, caption) = StrengthWords.hardestFigure(view.rank, views.size)
                ClubHero(StrengthWords.figure(view.strength), view.kind.head, StrengthWords.read(view), hardest, caption)
            }
        val names = ClubNames(clubs)
        val games =
            schedule.slates.firstOrNull { it.abbr == club.abbr }?.games.orEmpty().map { game ->
                ClubGame(
                    week = game.week,
                    weekWords = "${Words.ClubPage.week} ${game.week}",
                    opponent = "${at(game.home)} ${names.full(game.opponent)}",
                    club = game.opponent,
                    value = Format.fixed(value(schedule, game.opponent)),
                    played = played(game, played),
                    state = states.word(game),
                )
            }
        val faded = StrengthWords.played(played)
        return ClubSchedule(hero, games, "${schedule.season} schedule${if (faded.isEmpty()) "" else ", $faded"}", states.asOf)
    }

    /** The grid's slates: hardest first by the strength shown, else in the clubs' order. */
    private fun order(
        schedule: RunSchedule,
        views: Map<String, StrengthView>,
    ): List<RunSlate> {
        if (views.isEmpty()) return schedule.slates.sortedBy { it.abbr }
        return schedule.slates.sortedWith(compareBy({ views[it.abbr]?.rank ?: Int.MAX_VALUE }, { it.abbr }))
    }

    /** scheduleGrid: every club by week, hardest first, the strongest opponents shaded and the games in set back. */
    fun grid(
        schedule: RunSchedule,
        clubs: List<RunClub>,
        rows: List<RunBoardRow>,
        played: Reach,
        underway: Boolean,
        states: StatedWeek,
    ): ScheduleGridModel {
        val lastWeek = schedule.slates.flatMap { it.games }.maxOfOrNull { it.week } ?: 0
        val weeks = (1..lastWeek).toList()
        val strong = strongFloor(schedule.opponentValues.values)
        val views = views(schedule, underway)
        val slates = order(schedule, views)
        val first = slates.firstNotNullOfOrNull { views[it.abbr] }
        val names = ClubNames(clubs)
        return ScheduleGridModel(
            season = schedule.season,
            weeks = weeks,
            lead = StrengthWords.scheduleLead(first, strong.count, Format.fixed(strong.floor), played),
            strengthLabel = first?.kind?.column,
            played = played.complete,
            rows =
                slates.map { slate ->
                    val lead = rows.firstOrNull { it.team == slate.abbr }
                    val view = views[slate.abbr]
                    ScheduleGridRow(
                        abbr = slate.abbr,
                        name = names.full(slate.abbr),
                        face = lead?.let { headshotOf(it.headshot) },
                        faceName = lead?.name,
                        rank = view?.rank,
                        strength = view?.let { StrengthWords.figure(it.strength) },
                        cells = weeks.map { week -> cell(slate, week, schedule, strong.floor, played, states) },
                    )
                },
            current = states.current?.week,
            asOf = states.asOf,
        )
    }

    private fun cell(
        slate: RunSlate,
        week: Int,
        schedule: RunSchedule,
        strong: Double,
        played: Reach,
        states: StatedWeek,
    ): ScheduleCell {
        val game =
            slate.games.firstOrNull { it.week == week }
                ?: return ScheduleCell(week, null, null, "", hard = false, played = week <= played.complete)
        val value = value(schedule, game.opponent)
        return ScheduleCell(
            week = week,
            opponent = "${at(game.home)} ${game.opponent}",
            club = game.opponent,
            value = Format.fixed(value),
            hard = value >= strong,
            played = played(game, played),
            state = states.word(game),
        )
    }
}
