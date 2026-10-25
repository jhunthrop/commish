package app.trycommish.core.reference

import app.trycommish.api.models.RunGame
import app.trycommish.api.models.RunGameLogRow
import app.trycommish.api.models.RunGameState
import app.trycommish.api.models.RunGameStatus
import app.trycommish.api.models.RunManifest
import app.trycommish.api.models.RunPlayer
import app.trycommish.api.models.RunSchedule
import app.trycommish.api.models.RunSlate
import app.trycommish.core.Format
import app.trycommish.core.board.RunWords
import app.trycommish.core.instantOrNull
import java.time.Instant

/** How far the season's figures reach (web/src/lib/run/reach.ts Reach): the last week whose games are all
 * in, then the next week's games in, named by their days. */
data class Reach(
    /** The last week whose games are all in, 0 before week 1's. */
    val complete: Int,
    val partial: Partial?,
) {
    data class Partial(
        val week: Int,
        /** Their days in kickoff order ("Thursday"), empty where the run does not place them. */
        val days: List<String>,
        val games: Int,
    )

    companion object {
        /** Nothing in yet: before the season's first kickoff. */
        val NONE = Reach(0, null)
    }
}

/** reach.ts and server/run.ts, ported over the run's schedule and the pages a screen read (the iOS RunReach;
 * named apart from the API's own RunReach model). */
object SeasonReach {
    private fun kickoff(game: RunGame): Instant = instantOrNull(game.kickoff) ?: Instant.EPOCH

    /** run.ts seasonUnderway: the run was written at or after the season's first kickoff. */
    fun underway(
        manifest: RunManifest,
        schedule: RunSchedule,
    ): Boolean {
        val first = schedule.slates.flatMap { it.games }.minOfOrNull(::kickoff) ?: return false
        val runAt = instantOrNull(manifest.runAt) ?: return false
        return !runAt.isBefore(first)
    }

    /** The game is final by the run's state. */
    fun final(game: RunGame): Boolean = game.state == RunGameState.`final`

    /** Each game of a week once (both clubs' sides are one game), keyed by its two clubs. */
    private fun key(
        club: String,
        opponent: String,
    ): String = listOf(club, opponent).sorted().joinToString("-")

    /** A partial week from its games' kickoffs: their days in kickoff order (US Eastern, the NFL's). */
    private fun partial(
        week: Int,
        kickoffs: Collection<Instant>,
    ): Reach.Partial {
        val days = kickoffs.sorted().map { Format.weekdayName(it, RunWords.eastern) }.distinct()
        return Reach.Partial(week, days, kickoffs.size)
    }

    /** reach.ts finalsReach: the complete week, then the next week's games final by their state. */
    fun finals(
        slates: List<RunSlate>,
        complete: Int,
    ): Reach {
        val week = complete + 1
        val kickoffs = mutableMapOf<String, Instant>()
        slates.forEach { slate ->
            slate.games.filter { it.week == week && final(it) }.forEach { kickoffs[key(slate.abbr, it.opponent)] = kickoff(it) }
        }
        return Reach(complete, if (kickoffs.isEmpty()) null else partial(week, kickoffs.values))
    }

    /** server/run.ts playedReach: what the schedule sets back, nothing before the first kickoff. */
    fun played(
        slates: List<RunSlate>,
        complete: Int,
        underway: Boolean,
    ): Reach = if (underway) finals(slates, complete) else Reach.NONE

    /** A week holding a game of his (reach.ts holdsAGame). */
    private fun holdsAGame(row: RunGameLogRow): Boolean =
        row.status == RunGameStatus.played ||
            (row.status == RunGameStatus.inactive && (row.opponent != null || row.unnamedGame == true))

    /** reach.ts countedReach over the pages read: the complete week, then the newest week some player's
     * counted game belongs to, its clubs' games named by their days. */
    fun counted(
        pages: List<RunPlayer>,
        slates: List<RunSlate>,
        complete: Int,
    ): Reach {
        val newest =
            pages.fold(0) { week, page ->
                page.season.log.fold(maxOf(week, page.season.through)) { most, row -> if (holdsAGame(row)) maxOf(most, row.week) else most }
            }
        if (newest <= complete) return Reach(complete, null)
        val clubs =
            pages
                .filter { page ->
                    page.season.log.any { it.week == newest && (it.status == RunGameStatus.played || it.status == RunGameStatus.inactive) }
                }.map { it.team }
                .toSet()
        val kickoffs = mutableMapOf<String, Instant>()
        var placed = true
        clubs.forEach { club ->
            val game = slates.firstOrNull { it.abbr == club }?.games?.firstOrNull { it.week == newest }
            if (game == null) placed = false else kickoffs[key(club, game.opponent)] = kickoff(game)
        }
        return Reach(complete, if (placed) partial(newest, kickoffs.values) else Reach.Partial(newest, emptyList(), 0))
    }

    private fun joinAnd(words: List<String>): String =
        if (words.size > 1) "${words.dropLast(1).joinToString(", ")} and ${words.last()}" else words.joinToString("")

    /** "week 6's Thursday game", "week 16's Thursday and Saturday games", "part of week 6". */
    private fun partialWords(partial: Reach.Partial): String {
        if (partial.days.isEmpty()) return "part of week ${partial.week}"
        return "week ${partial.week}'s ${joinAnd(partial.days)} ${if (partial.games == 1) "game" else "games"}"
    }

    /** reach.ts reachWords: "through week 5", "through week 5 and week 6's Thursday game", "" before week 1's
     * games. */
    fun words(reach: Reach): String {
        val whole = if (reach.complete == 0) "" else "week ${reach.complete}"
        val partial = reach.partial ?: return if (whole.isEmpty()) "" else "through $whole"
        return "through ${if (whole.isEmpty()) "" else "$whole and "}${partialWords(partial)}"
    }

    /** reach.ts playedThroughWords: "weeks 1 to 5 and week 6's Thursday game are played", "week 1 is played",
     * "" before any game is in. */
    fun playedThrough(reach: Reach): String {
        val complete = reach.complete
        val whole =
            when (complete) {
                0 -> ""
                1 -> "week 1"
                else -> "weeks 1 to $complete"
            }
        val parts = listOf(whole, reach.partial?.let(::partialWords).orEmpty()).filter { it.isNotEmpty() }
        if (parts.isEmpty()) return ""
        val many = complete > 1 || parts.size > 1 || (reach.partial?.games ?: 0) > 1
        return "${parts.joinToString(" and ")} ${if (many) "are" else "is"} played"
    }
}
