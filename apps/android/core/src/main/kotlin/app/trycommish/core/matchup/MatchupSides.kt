package app.trycommish.core.matchup

import app.trycommish.api.models.BoxStarter
import app.trycommish.api.models.LeaguePlayer
import app.trycommish.api.models.MatchupBox
import app.trycommish.api.models.MatchupBoxSide
import app.trycommish.api.models.MatchupSide
import app.trycommish.api.models.PlayerLine
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.GameState
import app.trycommish.core.leaguehome.Head
import app.trycommish.core.leaguehome.gameHead
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.GamesRead
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.LineupBoxes
import app.trycommish.core.start.LineupTotals
import app.trycommish.core.start.RowGame
import app.trycommish.core.start.RowStatuses
import app.trycommish.core.start.StartRow
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.StartWords
import app.trycommish.core.start.UnlistedDrawn
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId
import app.trycommish.api.models.GameState as ScheduleState

/** A side's rows and totals as its box draws them (matchup.ts SideBox). */
internal data class SideBox(
    val starters: List<StartRow>,
    val bench: List<StartRow>,
    val totals: LineupTotals,
    /** Every line the side's rows came from, for the basis. */
    val lines: List<PlayerLine>,
    val byPlayer: Boolean,
    val teamTotal: Boolean,
)

/** What a side's box reads besides its rows (matchup.ts SideRead). */
internal data class SideRead(
    /** The platform's total for the side as the screen shows it, null before it has started. */
    val platformTotal: Double?,
    /** The week's projection has landed. */
    val landed: Boolean,
    val week: Int,
    val now: Instant,
    /** The game has kicked off: the Team row's Pts are its big figure. */
    val started: Boolean,
    /** The bug's head is Final by the lines the screen holds. */
    val headFinal: Boolean,
)

/** The game's head as the bug says it: "Next kickoff" and "Sun 3:05 pm, ARI at LAR". */
data class KickoffWords(
    val head: String,
    val words: String,
)

/** A side's two figures as the bug prints them (matchup.ts bugFigures): the big one, its label, the
 * small one under. */
data class BugFigures(
    val big: String,
    val label: String,
    val small: String,
)

/**
 * matchup.ts, ported over the API's answers as the iOS port is: each side's box, the game's head by its
 * starters' lines (each line's `game_state` read, never computed), the bug's figures and the opponent's
 * best lineup.
 */
internal object MatchupSides {
    /** matchup.ts matchupRead: the starters with a game as one read, never final while a side the
     * platform lists no starters for is not final by the schedule; null when no starter has a game. */
    fun matchupRead(
        lines: List<PlayerLine>,
        now: Instant,
        unlisted: List<ScheduleState> = emptyList(),
    ): GamesRead? {
        val games = lines.filter { !it.facts.bye && it.facts.kickoff != null }
        if (games.isEmpty()) return null
        val read = LineRead.linesRead(games, now)
        val waiting = read.state == GameState.Final && unlisted.any { it != ScheduleState.final }
        return if (waiting) GamesRead(GameState.KickedOff, read.next) else read
    }

    private fun head(
        read: GamesRead,
        now: Instant,
    ): Head = gameHead(read.state, read.next, now)

    /** matchup.ts matchupStarted: any starter's game past its kickoff. */
    fun started(
        lines: List<PlayerLine>,
        now: Instant,
    ): Boolean = matchupRead(lines, now)?.let { head(it, now).state != GameState.Upcoming } ?: false

    /** matchup.ts matchupFinal. */
    fun final(
        lines: List<PlayerLine>,
        now: Instant,
        unlisted: List<ScheduleState>,
    ): Boolean = matchupRead(lines, now, unlisted)?.state == GameState.Final

    /** matchup.ts unlistedStates: the schedule's state of each side listing no starters. */
    fun unlistedStates(box: MatchupBox?): List<ScheduleState> = box?.sides.orEmpty().mapNotNull { it.scheduleState }

    /** matchup.ts nextKickoff: "First kickoff" before any starter's game, "Next kickoff" once one has
     * started with another to come, then "Kicked off" and "Final"; null when no starter has a game. */
    fun nextKickoff(
        lines: List<PlayerLine>,
        now: Instant,
        zone: ZoneId,
        unlisted: List<ScheduleState>,
    ): KickoffWords? {
        val games = lines.filter { !it.facts.bye && it.facts.kickoff != null && it.facts.opponent != null }
        val read = matchupRead(lines, now, unlisted)
        if (games.isEmpty() || read == null) return null
        val gameHead = head(read, now)
        if (gameHead.state == GameState.Final) return KickoffWords(Words.Kickoff.final, "")
        val next = games.firstOrNull { instantOrNull(it.facts.kickoff) == gameHead.next }
        val kickoff = next?.let { instantOrNull(it.facts.kickoff) }
        if (next == null || kickoff == null) {
            return if (gameHead.state == GameState.KickedOff) KickoffWords(Words.Kickoff.kickedOff, "") else null
        }
        val side = if (next.facts.home == false) "at" else "vs"
        val words = "${Format.weekdayTime(kickoff, zone)}, ${next.player.team} $side ${next.facts.opponent.orEmpty()}"
        return KickoffWords(if (gameHead.state == GameState.KickedOff) Words.Kickoff.next else Words.Kickoff.first, words)
    }

    /** matchup.ts decidedHead: "Decided" in place of the state while the game plays and the API says so. */
    fun decided(
        kickoff: KickoffWords?,
        decided: Boolean,
        started: Boolean,
    ): KickoffWords? =
        if (kickoff != null && decided && started && kickoff.head != Words.Kickoff.final) {
            KickoffWords(Words.Kickoff.decided, "")
        } else {
            kickoff
        }

    /** matchup.ts sideBox: the API's rows when it answered for the side, else the league read's starters
     * with their points so far when the platform gives them. */
    fun sideBox(
        side: MatchupSide,
        box: MatchupBoxSide?,
        read: SideRead,
        zone: ZoneId,
    ): SideBox {
        if (box == null) return readSide(side, read, zone)
        val starters = box.starters.map { StartRows.row(it.line, slotWord(it.slot), zone, read.now) }
        val allFinal =
            if (box.starters.isEmpty()) {
                unlistedFinal(box, read)
            } else {
                LineRead.setState(box.starters.map { it.line }, read.now) == GameRead.Final
            }
        return SideBox(
            starters = starters,
            bench = box.bench.map { StartRows.row(it, "", zone, read.now) },
            totals =
                LineupTotals(
                    proj = sideProj(box, starters),
                    pts = score(starters, box.playerPoints, box.teamTotal, read.platformTotal),
                    final = box.projectedFinal,
                    live = read.started,
                    allFinal = allFinal,
                    note = LineupBoxes.totalsNote(starters, read.landed, read.week),
                ),
            lines = box.starters.map { it.line } + box.bench,
            byPlayer = box.playerPoints,
            teamTotal = box.teamTotal,
        )
    }

    /** The league read's side alone: its starters by position, their points where the platform gives
     * each player's, no Proj; Final as the bug's head says it. */
    private fun readSide(
        side: MatchupSide,
        read: SideRead,
        zone: ZoneId,
    ): SideBox {
        val starters = side.starters.map { readRow(it.player, if (side.playerPoints) it.points else null, zone) }
        return SideBox(
            starters = starters,
            bench = emptyList(),
            totals =
                LineupTotals(
                    proj = null,
                    pts = score(starters, side.playerPoints, side.teamTotal, read.platformTotal),
                    final = null,
                    live = read.started,
                    allFinal = read.headFinal,
                    note = null,
                ),
            lines = emptyList(),
            byPlayer = side.playerPoints,
            teamTotal = side.teamTotal,
        )
    }

    /** box.ts hostRow: a player the box has no line for, his name, club and position, and his points. */
    fun readRow(
        player: LeaguePlayer,
        pts: Double?,
        zone: ZoneId,
    ): StartRow {
        val mark = player.position == "DEF" && player.team.isNotEmpty()
        val position = StartRows.positionWord(player.position)
        return StartRow(
            id = player.hostId,
            slot = position,
            name = player.name,
            fit = if (mark) StartRows.lastName(StartRows.withoutDefense(player.name)) else StartRows.initialName(player.name),
            slug = null,
            clubMark = mark,
            headshot = null,
            club = player.team,
            position = position,
            rank = null,
            status = RowStatuses.of(null, player.injuredReserve, zone),
            reserve = player.injuredReserve,
            game = RowGame.None,
            expected = null,
            weather = null,
            proj = null,
            pts = pts,
            read = GameRead.NoGame,
            oppRank = null,
            oppOf = null,
            avg = null,
            last = null,
            delta = null,
        )
    }

    /** box.ts slotWord over a box starter's slot. */
    fun slotWord(slot: BoxStarter.Slot): String =
        LineupBoxes.slotWord(if (slot == BoxStarter.Slot.unknown_default_open_api) "" else slot.value)

    /** matchup.ts sideScore: the platform's own total where it sends one or gives no player's points,
     * else the printed rows added. */
    fun score(
        rows: List<StartRow>,
        byPlayer: Boolean,
        teamTotal: Boolean,
        platformTotal: Double?,
    ): Double? = if (byPlayer && !teamTotal) LineupBoxes.printedSum(rows.map { it.pts }) else platformTotal

    /** matchup.ts sideProj: the starters' rows added, or our best lineup's figure for a side listing none. */
    private fun sideProj(
        box: MatchupBoxSide,
        rows: List<StartRow>,
    ): Double? =
        if (box.starters.isEmpty() && box.projectionBestLineup == true) {
            box.projection
        } else {
            LineupBoxes.printedSum(rows.map { it.proj })
        }

    /** matchup.ts unlistedFinal: a side listing no starters is Final by the schedule's state, an answer
     * without it by the bug's head. */
    private fun unlistedFinal(
        box: MatchupBoxSide,
        read: SideRead,
    ): Boolean = box.scheduleState?.let { it == ScheduleState.final } ?: read.headFinal

    /** matchup.ts matchupUnlisted: what an opponent the platform lists no starters for draws from our best
     * lineup of his roster, said once in the basis. */
    fun unlisted(
        box: MatchupBoxSide?,
        totals: LineupTotals,
    ): UnlistedDrawn {
        if (box == null || box.starters.isNotEmpty() || (totals.live && totals.allFinal)) return UnlistedDrawn()
        val figure = if (totals.live) totals.final else totals.proj
        return when {
            box.projectionBestLineup != true -> if (figure == null) UnlistedDrawn(noRoster = true) else UnlistedDrawn()
            figure == null -> UnlistedDrawn()
            else ->
                UnlistedDrawn(
                    bestLineup = true,
                    paced = totals.live && box.projectedFinalPaced == true,
                    skipped = box.bestLineupSkipped == true,
                )
        }
    }

    /** matchup.ts matchupNoFinal: a Team row under way draws its Proj final "--" the key explains. */
    fun noFinal(
        mine: LineupTotals,
        theirs: LineupTotals?,
        theirsUnlisted: UnlistedDrawn,
    ): Boolean {
        fun missing(totals: LineupTotals?): Boolean = totals?.let { it.live && it.final == null } ?: false
        return missing(mine) || (missing(theirs) && !theirsUnlisted.noRoster)
    }

    /** matchup.ts bugFigures: before kickoff the Proj big and nothing under; from it the Pts big with the
     * Team row's small figure under ("Proj final 73.2", "Final 63.5"). */
    fun bugFigures(
        totals: LineupTotals,
        started: Boolean,
    ): BugFigures {
        val small =
            StartWords.teamSmall(totals.copy(live = started))
                ?: return BugFigures(StartWords.number(totals.proj), Words.Box.proj, "")
        return BugFigures(StartWords.number(totals.pts), Words.Box.pts, "${small.first} ${StartWords.number(small.second)}")
    }
}
