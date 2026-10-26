package app.trycommish.core.companion

import app.trycommish.api.models.MockReport
import app.trycommish.api.models.ReportPick
import app.trycommish.api.models.ReportRuns
import app.trycommish.core.Format
import app.trycommish.core.board.GapTone
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import kotlin.math.floor

/** A cell of the report's head (ui/facts.ts FactCell): its label and value, the seat's own in the accent. */
data class ReportCell(
    val label: String,
    val value: String,
    val mine: Boolean,
)

/** A Picks later figure and its tone (headline.ts Later): plus is later than his place, so green. */
data class ReportLater(
    val text: String,
    val tone: GapTone,
)

/** A figure cell's words and whether it is muted (a kicker's place in draft order, no projection). */
data class ReportFigure(
    val text: String,
    val muted: Boolean,
)

/** The Still there cell (headline.ts stillThereCell): its words, tinted when he could have waited, muted
 * when there is no chance to show. */
data class StillThere(
    val text: String,
    val wait: Boolean,
    val muted: Boolean,
)

/** One pick of the drafter's as Pick by pick prints it at 390 (PickReview.svelte): the pick, the player, his
 * slot, Over repl (or a kicker's place in draft order), Picks later against the drafters and our board,
 * Still there, and who made it. */
data class ReportPickLine(
    val pick: String,
    val player: RoomPlayer?,
    val name: String,
    val slot: String,
    val figure: ReportFigure,
    val adp: ReportLater?,
    val ours: ReportLater?,
    val still: StillThere,
    /** Who made the pick: You, or Kept for a keeper. */
    val madeBy: String,
    /** The drafter made it himself: its By in ink. */
    val mine: Boolean,
)

/** A team on the field (FieldBars.svelte): its place, its name, its points and its bar's share. */
data class FieldLine(
    val rank: Int,
    val name: String,
    val points: String,
    val share: Double,
    val you: Boolean,
)

/** The same draft run again (RunsSection.svelte): the histogram's bars and its median, the three figures,
 * and how often each place came up. */
data class ReportRunsModel(
    val title: String,
    val note: String,
    val bins: List<Int>,
    val medianBin: Int,
    val low: String,
    val high: String,
    val median: String,
    val middle: String,
    val topShare: String,
    val topWords: String,
    val ranks: List<Int>,
    /** The draft's own place, ringed in the rank counts. */
    val rank: Int,
)

/** Who the runs land (Exposure.svelte): each with his share of the runs. */
data class ExposureLine(
    val player: RoomPlayer,
    val share: Double,
    val percent: String,
)

/** The seat's finish: its points, its place, and its cells (headline.ts standingCells). */
private data class Standing(
    val points: Double,
    val rank: Int,
    val cells: List<ReportCell>,
)

/**
 * The report on a finished draft from the drafter's seat as the web draws it (room/report/Report.svelte with
 * headline.ts), for the companion's seats, the iOS DraftReportModel's: the one big number and its caption,
 * the finish and the draft as cells, the basis once, the field, pick by pick, the runs and who they land.
 * Pure, held to shared/fixtures/parity/companion.json.
 */
data class DraftReportModel(
    val title: String,
    val points: String?,
    val caption: String,
    val cells: List<ReportCell>,
    val basis: String,
    val fieldNote: String,
    val field: List<FieldLine>,
    val picksNote: String,
    val picks: List<ReportPickLine>,
    val runs: ReportRunsModel,
    val exposureTitle: String,
    val exposureAside: String,
    val exposure: List<ExposureLine>,
) {
    companion object {
        /** RunsSection.svelte BINS and Exposure.svelte ROWS. */
        private const val BINS = 12
        private const val EXPOSURE_ROWS = 8
        private const val PERCENT = 100

        /** `names` are the seats' names, slot 1 first; `seats` who the other seats are ("Your league on
         * Sleeper"); `reshuffled` who stands in for them in the runs. */
        fun of(
            report: MockReport,
            names: List<String>,
            seats: String,
            reshuffled: String,
        ): DraftReportModel {
            val board = RoomBoardView.of(report.board, report.teams)
            val head = standing(report)
            val top = maxOf(report.standings.maxOfOrNull { it.points } ?: 1.0, 1.0)
            return DraftReportModel(
                title = "Your draft from slot ${report.slot}",
                points = head?.let { Format.whole(it.points) },
                caption = "points from your QB, RB, WR and TE starters",
                cells = head?.cells.orEmpty() + settings(report, seats),
                basis = basis(board.basis, report.couldWaitFrom),
                fieldNote = "projected starting points, ${report.teams} teams",
                field =
                    report.standings.map { team ->
                        FieldLine(
                            team.rank,
                            names.getOrNull(team.seat - 1) ?: "Seat ${team.seat}",
                            Format.whole(team.points),
                            team.points / top,
                            team.seat == report.slot,
                        )
                    },
                picksNote = "${report.picks.size} picks, starters by slot",
                picks = picks(report, board),
                runs = runs(report.runs, report.teams, head?.rank ?: 0, reshuffled),
                exposureTitle = "Who you end up with",
                exposureAside = "share of ${report.runs.runs} runs",
                exposure =
                    report.runs.exposure.take(EXPOSURE_ROWS).mapNotNull { entry ->
                        board.byId[entry.playerId]?.let { ExposureLine(it, entry.share, DraftFormat.percent(entry.share)) }
                    },
            )
        }

        /** headline.ts standingCells: the seat's place of the field, the team just ahead (or just behind, for
         * the leader), and the leader; null when the standings do not hold the seat. */
        private fun standing(report: MockReport): Standing? {
            val mine = report.standings.firstOrNull { it.seat == report.slot } ?: return null
            val byRank = report.standings.sortedBy { it.rank }
            val leader = byRank.firstOrNull()
            val near = byRank.firstOrNull { it.rank == (if (mine.rank == 1) 2 else mine.rank - 1) }
            val cells =
                listOfNotNull(
                    ReportCell("of ${report.teams}", Format.ordinal(mine.rank), mine = true),
                    near?.takeIf { it.seat != leader?.seat }?.let {
                        ReportCell(
                            Format.ordinal(it.rank),
                            Format.whole(it.points),
                            mine = false,
                        )
                    },
                    leader?.takeIf { it.seat != report.slot }?.let { ReportCell("Leader", Format.whole(it.points), mine = false) },
                )
            return Standing(mine.points, mine.rank, cells)
        }

        /** headline.ts settingCells: teams, scoring, rounds and who the other seats are. */
        private fun settings(
            report: MockReport,
            seats: String,
        ): List<ReportCell> =
            listOf(
                ReportCell("Teams", report.teams.toString(), mine = false),
                ReportCell("Scoring", RoomWords.scoring(report.settings), mine = false),
                ReportCell("Rounds", report.rounds.toString(), mine = false),
                ReportCell("Other seats", seats, mine = false),
            )

        /** headline.ts reportBasis: every figure's basis, said once. */
        private fun basis(
            boardBasis: String,
            couldWaitFrom: Double,
        ): String {
            val from = StartRows.jsRound(couldWaitFrom * PERCENT)
            return "$boardBasis Picks later: the pick less his ADP, or less his place on our board (no kickers or " +
                "defenses there), plus is later. Still there: the room's read at that pick, tinted from $from%."
        }

        private fun picks(
            report: MockReport,
            board: RoomBoardView,
        ): List<ReportPickLine> {
            val slotOf =
                report.starters
                    .mapNotNull { starter -> starter.playerId?.let { it to slotLabel(starter.slot) } }
                    .groupBy({ it.first }, { it.second })
                    .mapValues { it.value.first() }
            val last = report.picks.lastOrNull { it.chip != ReportPick.Chip.kept }?.pick
            return report.picks.map { pick ->
                val player = board.byId[pick.playerId]
                val kept = pick.chip == ReportPick.Chip.kept
                ReportPickLine(
                    pick = DraftFormat.pickLabel(pick.pick, report.teams),
                    player = player,
                    name = player?.name ?: pick.playerId,
                    slot = slotOf[pick.playerId] ?: Words.Report.bench,
                    figure = figure(pick.overReplacement, player),
                    adp = if (kept) null else pick.adpGap?.let { later(it, decimals = 1) },
                    ours = if (kept) null else pick.boardGap?.let { later(it.toDouble(), decimals = 0) },
                    still = still(pick, last, report.couldWaitFrom),
                    madeBy = madeBy(pick),
                    mine = pick.madeBy == ReportPick.MadeBy.you,
                )
            }
        }

        /** words.ts slotLabel: DEF is DST, SUPERFLEX is SFLX. */
        private fun slotLabel(slot: String): String =
            when (slot) {
                "DEF" -> "DST"
                "SUPERFLEX" -> "SFLX"
                else -> slot
            }

        /** headline.ts pickFigure: a kicker's or a defense's place in draft order, else his points over
         * replacement signed, else "no projection". */
        private fun figure(
            overReplacement: Double?,
            player: RoomPlayer?,
        ): ReportFigure {
            if (player != null && player.isMarket) return ReportFigure(RoomWords.draftOrder(player), muted = true)
            return overReplacement?.let { ReportFigure(DraftFormat.signed(it), muted = false) }
                ?: ReportFigure("no projection", muted = true)
        }

        /** headline.ts later: the API's figure signed, "0" at zero, and its tone. */
        private fun later(
            gap: Double,
            decimals: Int,
        ): ReportLater =
            ReportLater(
                if (gap == 0.0) "0" else DraftFormat.signed(gap, decimals),
                when {
                    gap > 0 -> GapTone.Gain
                    gap < 0 -> GapTone.Loss
                    else -> GapTone.Even
                },
            )

        /** headline.ts stillThereCell: the chance he was there at your next turn, tinted when he could have
         * waited; empty for a pick nobody chose. */
        private fun still(
            pick: ReportPick,
            last: Int?,
            couldWaitFrom: Double,
        ): StillThere {
            if (pick.madeBy != ReportPick.MadeBy.you || pick.chip == ReportPick.Chip.kept) return StillThere("", wait = false, muted = true)
            val chance =
                pick.stillThere ?: return StillThere(if (pick.pick == last) "last pick" else "not read", wait = false, muted = true)
            return StillThere(DraftFormat.chanceShort(chance), wait = chance >= couldWaitFrom, muted = false)
        }

        /** headline.ts byWords, for your own draft: who made the pick, or Kept for a keeper. */
        private fun madeBy(pick: ReportPick): String {
            if (pick.chip == ReportPick.Chip.kept) return "Kept"
            return when (pick.madeBy) {
                ReportPick.MadeBy.you -> "You"
                ReportPick.MadeBy.for_you -> "Pick for me"
                ReportPick.MadeBy.queue -> "Your queue"
                ReportPick.MadeBy.clock -> "Your clock"
                ReportPick.MadeBy.unknown_default_open_api -> pick.madeBy.value
            }
        }

        /** RunsSection.svelte: the histogram over the runs' points in twelve bars, its median's bar, and the
         * figures whole. */
        private fun runs(
            runs: ReportRuns,
            teams: Int,
            rank: Int,
            reshuffled: String,
        ): ReportRunsModel {
            val low = runs.points.firstOrNull() ?: 0.0
            val high = runs.points.lastOrNull() ?: 0.0
            val width = ((high - low) / BINS).takeIf { it != 0.0 } ?: 1.0
            val bin = { points: Double -> minOf(BINS - 1, floor((points - low) / width).toInt()) }
            val counts = runs.points.groupingBy(bin).eachCount()
            return ReportRunsModel(
                title = "The same draft, ${runs.runs} more times",
                note = "your picks on autopick from the board, $reshuffled reshuffled each run",
                bins = (0 until BINS).map { counts[it] ?: 0 },
                medianBin = bin(runs.median),
                low = Format.whole(low),
                high = Format.whole(high),
                median = Format.whole(runs.median),
                middle = "${Format.whole(runs.middleLow)} to ${Format.whole(runs.middleHigh)}",
                topShare = DraftFormat.percent(runs.topShare),
                topWords = "of runs finish top ${runs.topFinish} of $teams",
                ranks = runs.rankCounts,
                rank = rank,
            )
        }
    }
}
