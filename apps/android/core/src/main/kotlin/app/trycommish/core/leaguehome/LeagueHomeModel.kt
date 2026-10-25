package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.Scoreboard
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** A week game's head at the page's clock (web kickoff.ts gameHead). */
enum class GameState { Upcoming, KickedOff, Final }

/** How a side reads against the other once its game has started; level before kickoff. */
enum class Stands { Ahead, Behind, Level }

/** One side of a score bug: its team, its record, its two figures, its starters still to play. */
data class BugSide(
    val rosterId: Int,
    val name: String,
    val record: String,
    val me: Boolean,
    val final: Boolean,
    /** Proj before kickoff, Pts from it. */
    val big: String,
    /** Proj final while it plays, its total once final, nothing before kickoff. */
    val small: String,
    val toPlay: String,
    val stands: Stands,
)

/** A game of the league's week as the scoreboard draws it. */
data class GameBug(
    val key: String,
    val mine: Boolean,
    val state: GameState,
    /** "Sun 12:00 pm" before kickoff, "Kicked off", "Final". */
    val head: String,
    /** "Next kickoff" before it, the read beside a live score ("FFPC 4 min ago"), else nothing. */
    val words: String,
    val smallHead: String,
    val bigHead: String,
    val sides: List<BugSide>,
) {
    /** The roster the bug opens the game of (game.ts bugRoster, Lane 204): none for the member's game,
     * which is the Matchup's own, else its first side's. */
    val roster: Int? get() = if (mine) null else sides.firstOrNull()?.rosterId
}

data class StandingsRow(
    val rosterId: Int,
    val rank: Int,
    val name: String,
    val me: Boolean,
    val record: String,
    val pointsFor: String,
    val pointsAgainst: String,
    val streak: String,
    val waiver: String,
    val proj: String,
)

data class Standings(
    /** FAAB in a budget league, Waiver in an order league, null where the platform says neither. */
    val waiverHead: String?,
    /** The week's Proj column is drawn: the scoreboard answered. */
    val projected: Boolean,
    val rows: List<StandingsRow>,
    /** What the numbers are, said once under the table. */
    val basis: String,
)

data class LineupLine(
    val key: String,
    val position: String,
    val name: String,
    val club: String,
)

/** The member's starters as the platform has them set, and the bench as a count. */
data class LineupSummary(
    val team: String,
    val starters: List<LineupLine>,
    val bench: String,
)

data class FeedPlayer(
    val key: String,
    val name: String,
    val position: String,
    val club: String,
    /** The team that took him in a trade. */
    val to: String?,
)

data class MoveRow(
    val key: String,
    val whenText: String,
    val kind: String,
    val teams: List<String>,
    val mine: Boolean,
    val adds: List<FeedPlayer>,
    val drops: List<FeedPlayer>,
    val detail: String,
)

/** The league's moves, newest first, or the sentence a quiet league reads. */
data class MovesFeed(
    val rows: List<MoveRow>,
    val empty: String?,
)

/** The League home as the screen draws it, in the web's section order: the scoreboard, the standings,
 * the member's lineup, the moves (web/src/lib/league/LeaguePage.svelte). */
data class LeagueHomeModel(
    val leagueId: String,
    val name: String,
    val platform: String,
    val week: String,
    val games: List<GameBug>,
    val standings: Standings,
    val lineup: LineupSummary,
    /** Null where the platform gives no move history. */
    val moves: MovesFeed?,
)

/** The League home from the league's sync answer and its scoreboard (null when the API gives none) at
 * the page's clock, the times in the member's zone. Pure: the same answers at the same clock draw the
 * same page. Ports the web's reader (web/src/lib/league/home/home.ts) until the API serves game state. */
fun leagueHomeModel(
    sync: LeagueSync,
    board: Scoreboard?,
    now: Instant,
    zone: ZoneId,
): LeagueHomeModel =
    LeagueHomeModel(
        leagueId = sync.id.toString(),
        name = sync.name,
        platform = ValueWords.platform(sync.host),
        week = "${Words.LeagueHome.week} ${board?.week ?: sync.week}",
        games = board?.let { gameBugs(it, sync, now, zone) }.orEmpty(),
        standings = standings(sync, board, now),
        lineup = lineupSummary(sync),
        moves = if (sync.movesRead) movesFeed(sync, zone) else null,
    )
