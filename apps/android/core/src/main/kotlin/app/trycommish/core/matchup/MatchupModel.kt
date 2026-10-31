package app.trycommish.core.matchup

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeagueMatchup
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.MatchupBox
import app.trycommish.api.models.MatchupBoxSide
import app.trycommish.api.models.MatchupSide
import app.trycommish.api.models.Scoreboard
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.core.leaguehome.readCell
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.RowCells
import app.trycommish.core.start.StartWords
import app.trycommish.core.start.TeamRow
import app.trycommish.core.start.UnlistedDrawn
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** One side of the Matchup's score bug (MatchupBug.svelte): You or Opponent (neither on another team's
 * game, Lane 207), the team, its big figure
 * with its label (Proj before the first kickoff, Pts from it), the small one under, and where its
 * starters stand while the game is under way. */
data class BugTeam(
    val label: String,
    val name: String,
    val initials: String,
    val me: Boolean,
    val big: String,
    val bigLabel: String,
    val small: String,
    val toPlay: String,
)

/** The Matchup's score bug: the week, the game's head and its words ("Next kickoff", "Sun 3:05 pm, ARI
 * at LAR"), the read beside a live score, both teams and the API's line on where the member stands. */
data class MatchupBug(
    val week: String,
    val mine: BugTeam,
    val opponent: BugTeam?,
    val head: String?,
    val words: String,
    /** "FFPC 4 min ago" beside a live score; null before kickoff and once final. */
    val read: String?,
    val standing: String?,
    val started: Boolean,
)

/** One team's box (BoxTable.svelte at 390): its name, its starters in the platform's slots, the Team row
 * lit like the bug, its bench; the sentence in place of starters the platform does not send. */
data class TeamBox(
    val id: Int,
    val team: String,
    val initials: String,
    val mine: Boolean,
    val empty: String?,
    val starters: List<RowCells>,
    val teamRow: TeamRow,
    val bench: List<RowCells>,
)

/** The week's matchup as the screen draws it. */
data class MatchupWeek(
    /** "Their game" with the way to the member's own, over another team's game; null over the member's. */
    val whose: GameWhose?,
    val week: String,
    val mine: String,
    val opponent: String?,
    val bug: MatchupBug,
    /** Said under the bug: an all-play week, a score the platform could not give. */
    val notes: List<String>,
    /** "No opponent this week", where the boxes' second would be. */
    val noOpponent: String?,
    val boxes: List<TeamBox>,
    val basis: String,
) {
    /** Whether his row is one of the member's own (MatchupPanel.svelte rowsOf(mine)): only those offer the
     * way to his lineup. */
    fun isMine(player: SheetPlayer): Boolean =
        boxes.filter { it.mine }.flatMap { it.starters + it.bench }.any { it.sheetPlayer?.id == player.id }

    /** Every player a row opens in the sheet, both teams'. */
    val sheetPlayers: List<SheetPlayer> get() = boxes.flatMap { it.starters + it.bench }.mapNotNull { it.sheetPlayer }
}

/** The Matchup screen at one read (MatchupScreen.svelte and MatchupPanel.svelte at 390): this week's game
 * as a box score, or the sentence where the league read holds no game for the member. */
sealed interface MatchupModel {
    data class Week(
        val week: MatchupWeek,
    ) : MatchupModel

    data class Gap(
        val sentence: String,
    ) : MatchupModel
}

/** The screen drawn at the league read's instant, as the web draws it (MatchupScreen passes the read's
 * time), the read beside a live score aged by `clock`, the screen's own clock. Another team's game, by the
 * box's own word, is drawn from the box and the scoreboard (`board`), its score unread where the
 * scoreboard was not read. Pure. */
fun matchupModel(
    sync: LeagueSync,
    box: MatchupBox?,
    clock: Instant,
    zone: ZoneId,
    board: Scoreboard? = null,
    /** The platform's words: the league's own, or the store graphics' neutral one (Lane 310). */
    host: HostWords = HostWords.of(sync.host),
): MatchupModel {
    val now = instantOrNull(sync.readAt) ?: clock
    val other = OtherGame.isOther(box)
    val matchup = (if (other) OtherGame.matchup(box, board) else sync.matchup) ?: return MatchupModel.Gap(MatchupWords.gap(sync, now))
    return MatchupModel.Week(MatchupDraw(sync, box, matchup, other, now, zone, host).week(clock))
}

/** MatchupPanel.svelte's reads over one answer. */
private class MatchupDraw(
    private val sync: LeagueSync,
    private val box: MatchupBox?,
    private val matchup: LeagueMatchup,
    /** Another team's game: none of the member's words, marks or verbs. */
    private val other: Boolean,
    private val now: Instant,
    private val zone: ZoneId,
    private val host: HostWords,
) {
    private val starterLines = box?.sides.orEmpty().flatMap { side -> side.starters.map { it.line } }
    private val started = MatchupSides.started(starterLines, now)
    private val unlisted = MatchupSides.unlistedStates(box)
    private val headFinal = MatchupSides.final(starterLines, now, unlisted)
    private val platform = host.name

    private fun boxSide(rosterId: Int): MatchupBoxSide? = box?.sides?.firstOrNull { it.rosterId == rosterId }

    /** matchup.ts showsTotal: a read score once the side has started, or at 0 in an all-play week. */
    private fun showsTotal(side: MatchupSide): Boolean {
        val begun = side.points != 0.0 || side.starters.any { (it.points ?: 0.0) != 0.0 }
        return side.pointsRead && (begun || sync.weekAllPlay)
    }

    private fun side(side: MatchupSide): SideBox =
        MatchupSides.sideBox(
            side,
            boxSide(side.rosterId),
            SideRead(
                platformTotal = if (showsTotal(side)) side.points else null,
                landed = box?.projectionReadAt != null,
                week = matchup.week,
                now = now,
                started = started,
                headFinal = headFinal,
            ),
            zone,
        )

    fun week(clock: Instant): MatchupWeek {
        val mine = side(matchup.mine)
        val opponentSide = matchup.opponent
        val theirs = opponentSide?.let(::side)
        val theirsUnlisted = theirs?.let { MatchupSides.unlisted(boxSide(opponentSide.rosterId), it.totals) } ?: UnlistedDrawn()
        val kickoff =
            MatchupSides.decided(
                MatchupSides.nextKickoff(starterLines, now, zone, unlisted),
                decided = box?.decided == true,
                started = started,
            )
        val read =
            if (started && kickoff?.head != Words.Kickoff.final) {
                instantOrNull(sync.readAt)?.let { readCell(host.stamp, it, clock) }
            } else {
                null
            }
        val week = "${Words.LeagueHome.week} ${matchup.week}"
        val mineName = MatchupWords.teamName(sync, matchup.mine.rosterId)
        val theirName = opponentSide?.let { MatchupWords.teamName(sync, it.rosterId) }
        val sides = listOfNotNull(mine, theirs)
        val hidden = if (sync.host == LeagueHost.ffpc) MatchupWords.yoursOnly(platform) else null
        val boxes =
            listOfNotNull(
                teamBox(matchup.mine.rosterId, mineName, mine, mine = !other, empty = if (other) hidden else null),
                if (opponentSide != null && theirs != null && theirName != null) {
                    teamBox(opponentSide.rosterId, theirName, theirs, mine = false, empty = hidden)
                } else {
                    null
                },
            )
        return MatchupWeek(
            whose = if (other) GameWhose.theirs else null,
            week = week,
            mine = mineName,
            opponent = theirName,
            bug =
                MatchupBug(
                    week = week,
                    mine = bugTeam(matchup.mine.rosterId, mineName, mine, me = !other),
                    opponent =
                        if (opponentSide != null && theirs != null) {
                            bugTeam(opponentSide.rosterId, theirName.orEmpty(), theirs, me = false)
                        } else {
                            null
                        },
                    head = kickoff?.head,
                    words = kickoff?.words.orEmpty(),
                    read = read,
                    standing = if (started) box?.standing else null,
                    started = started,
                ),
            notes = notes(),
            noOpponent = if (opponentSide == null && !sync.weekAllPlay) Words.Box.noOpponent else null,
            boxes = boxes,
            basis = basis(mine, theirs, sides, theirsUnlisted),
        )
    }

    private fun basis(
        mine: SideBox,
        theirs: SideBox?,
        sides: List<SideBox>,
        theirsUnlisted: UnlistedDrawn,
    ): String =
        MatchupBasis.phone(
            MatchupBasis.Facts(
                league = sync.host,
                projection = box?.let { MatchupBasis.Projection(instantOrNull(it.projectionReadAt), it.projectionScoring) },
                lines = sides.flatMap { it.lines },
                byPlayer = mine.byPlayer,
                teamTotal = mine.teamTotal,
                kicked = started,
                noFinal = MatchupSides.noFinal(mine.totals, theirs?.totals, theirsUnlisted),
                allFinal = sides.all { it.totals.allFinal },
                finalNone = sides.any { it.totals.live && it.totals.allFinal && it.totals.pts == null },
                unlisted = theirsUnlisted,
                zone = zone,
                now = now,
                host = host,
            ),
        )

    private fun notes(): List<String> =
        if (other) {
            emptyList()
        } else {
            listOfNotNull(
                if (sync.weekAllPlay) MatchupWords.allPlay(platform) else null,
                if (!matchup.mine.pointsRead) MatchupWords.scoreGap(sync, now) else null,
            )
        }

    private fun bugTeam(
        rosterId: Int,
        name: String,
        side: SideBox,
        me: Boolean,
    ): BugTeam {
        val figures = MatchupSides.bugFigures(side.totals, started)
        return BugTeam(
            label =
                when {
                    other -> ""
                    me -> Words.Box.you
                    else -> Words.Box.opponent
                },
            name = name,
            initials = initialsOf(name),
            me = me,
            big = figures.big,
            bigLabel = figures.label,
            small = figures.small,
            toPlay = if (started) boxSide(rosterId)?.toPlay.orEmpty() else "",
        )
    }

    private fun teamBox(
        rosterId: Int,
        name: String,
        side: SideBox,
        mine: Boolean,
        empty: String?,
    ): TeamBox {
        val small = StartWords.teamSmall(side.totals)
        return TeamBox(
            id = rosterId,
            team = name,
            initials = initialsOf(name),
            mine = mine,
            empty = if (side.starters.isEmpty()) empty else null,
            starters = side.starters.map { RowCells.of(null, it, null) },
            teamRow =
                TeamRow(
                    note = side.totals.note,
                    live = side.totals.live,
                    caption = small?.first,
                    proj = StartWords.number(if (small != null) small.second else side.totals.proj),
                    pts = StartWords.number(side.totals.pts),
                ),
            bench = side.bench.map { RowCells.of(null, it, null) },
        )
    }
}
