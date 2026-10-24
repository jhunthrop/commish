package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.LeagueTeam
import app.trycommish.api.models.Scoreboard
import app.trycommish.api.models.ScoreboardGame
import app.trycommish.api.models.ScoreboardSide
import app.trycommish.core.Format
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import app.trycommish.api.models.GameState as SideScheduleState

/*
 * The scoreboard's reader, ported from web/src/lib/league/home/home.ts (bugsOf and its helpers) and
 * web/src/lib/league/box/kickoff.ts (gameHead). The API serves the game's state; the page's clock only
 * decides whether a next kickoff is still to come. Once the API serves game_state per line (spec §5.1)
 * this reads that field instead.
 */

private const val MINUTE_SECONDS = 60L
private const val HOUR_SECONDS = 3600L

/** A game's head and its next kickoff still to come at the page's clock. */
internal data class Head(
    val state: GameState,
    val next: Instant?,
)

internal fun gameHead(
    state: ScoreboardGame.State,
    next: String?,
    now: Instant,
): Head {
    if (state == ScoreboardGame.State.final) return Head(GameState.Final, null)
    val kickoff = next?.let(Instant::parse)
    val ahead = kickoff?.takeIf { it.isAfter(now) }
    return when {
        state == ScoreboardGame.State.playing -> Head(GameState.KickedOff, ahead)
        kickoff == null -> Head(GameState.Upcoming, null)
        ahead == null -> Head(GameState.KickedOff, null)
        else -> Head(GameState.Upcoming, ahead)
    }
}

/** A read's age as a cell says it: "just now", "4 min ago", "2 hr ago". */
internal fun agoCell(seconds: Long): String =
    when {
        seconds < MINUTE_SECONDS -> Words.LeagueHome.justNow
        seconds < HOUR_SECONDS -> "${seconds / MINUTE_SECONDS} ${Words.LeagueHome.minAgo}"
        else -> "${seconds / HOUR_SECONDS} ${Words.LeagueHome.hrAgo}"
    }

/** Every side's starters with a game are final; never before the first kickoff. */
private fun sideFinal(
    side: ScoreboardSide,
    state: GameState,
): Boolean {
    if (state == GameState.Upcoming) return false
    side.startersFinal?.let { return it }
    val schedule = side.scheduleState
    return if (schedule != null) schedule == SideScheduleState.final else state == GameState.Final
}

private fun standsOf(
    game: ScoreboardGame,
    side: ScoreboardSide,
    started: Boolean,
): Stands {
    val other = game.sides.firstOrNull { it.rosterId != side.rosterId }
    return when {
        !started || other == null || !side.pointsRead || !other.pointsRead -> Stands.Level
        side.points == other.points -> Stands.Level
        side.points > other.points -> Stands.Ahead
        else -> Stands.Behind
    }
}

/** A side's figures: its Proj before kickoff; its Pts from it, with its projected final while it
 * plays, its total once final (with Final said in the cell unless the column's head says it). */
private fun sideFigures(
    side: ScoreboardSide,
    state: GameState,
    final: Boolean,
    headFinal: Boolean,
): Pair<String, String> {
    val proj = side.projection?.let { Format.fixed(it) } ?: LeagueHomeWords.none
    if (state == GameState.Upcoming) return "" to proj
    val pts = if (side.pointsRead) Format.fixed(side.points) else LeagueHomeWords.none
    if (!final) return (side.projectedFinal?.let { Format.fixed(it) } ?: LeagueHomeWords.none) to pts
    return (if (headFinal) pts else "${Words.LeagueHome.final} $pts") to pts
}

/** "5-0", "5-0-1" with a tie, as a score bug prints a record. */
private fun bugRecord(team: LeagueTeam?): String {
    if (team == null) return ""
    val base = "${team.wins}-${team.losses}"
    return if (team.ties > 0) "$base-${team.ties}" else base
}

private fun headWords(
    head: Head,
    readCell: String,
    zone: ZoneId,
): Pair<String, String> =
    when (head.state) {
        GameState.Final -> Words.LeagueHome.final to ""
        GameState.KickedOff -> LeagueHomeWords.kickedOff to readCell
        GameState.Upcoming ->
            head.next?.let { Format.weekdayTime(it, zone) to Words.LeagueHome.nextKickoff } ?: ("" to "")
    }

/** Every game of the week as a score bug, read at `now`. */
internal fun gameBugs(
    board: Scoreboard,
    sync: LeagueSync,
    now: Instant,
    zone: ZoneId,
): List<GameBug> {
    val teams = sync.teams.associateBy { it.rosterId }
    val seconds = Duration.between(Instant.parse(board.readAt), now).seconds.coerceAtLeast(0)
    val readCell = "${LeagueHomeWords.platform(sync.host)} ${agoCell(seconds)}"
    return board.games.mapIndexed { i, game ->
        val head = gameHead(game.state, game.nextKickoff, now)
        val finals = game.sides.map { sideFinal(it, head.state) }
        val allFinal = finals.isNotEmpty() && finals.all { it }
        val (smallHead, bigHead) =
            when {
                head.state == GameState.Upcoming -> "" to LeagueHomeWords.proj
                allFinal -> Words.LeagueHome.final to LeagueHomeWords.pts
                else -> LeagueHomeWords.projFinal to LeagueHomeWords.pts
            }
        val (title, words) = headWords(head, readCell, zone)
        GameBug(
            key = "$i-${game.sides.joinToString("-") { it.rosterId.toString() }}",
            mine = game.sides.any { it.rosterId == sync.me },
            state = head.state,
            head = title,
            words = words,
            smallHead = smallHead,
            bigHead = bigHead,
            sides =
                game.sides.mapIndexed { s, side ->
                    val team = teams[side.rosterId]
                    val (small, big) = sideFigures(side, head.state, finals[s], smallHead == Words.LeagueHome.final)
                    BugSide(
                        rosterId = side.rosterId,
                        name = team?.name ?: "Team ${side.rosterId}",
                        record = bugRecord(team),
                        me = side.rosterId == sync.me,
                        final = finals[s],
                        big = big,
                        small = small,
                        toPlay = if (head.state == GameState.KickedOff) side.toPlay.orEmpty() else "",
                        stands = standsOf(game, side, head.state != GameState.Upcoming),
                    )
                },
        )
    }
}

/** Each team's projection this week by roster: its projected final once its game has started, its
 * Proj before. */
internal fun projections(
    board: Scoreboard?,
    now: Instant,
): Map<Int, Double?> =
    board
        ?.games
        .orEmpty()
        .flatMap { game ->
            val upcoming = gameHead(game.state, game.nextKickoff, now).state == GameState.Upcoming
            game.sides.map { it.rosterId to if (upcoming) it.projection else it.projectedFinal }
        }.toMap()
