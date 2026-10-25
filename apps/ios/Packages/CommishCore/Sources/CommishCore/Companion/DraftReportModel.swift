import CommishAPI
import CommishDesign
import Foundation

/// A cell of the report's head (ui/facts.ts FactCell): its label and value, the seat's own in the accent.
public struct ReportCell: Equatable, Sendable, Identifiable {
    public let label: String
    public let value: String
    public let mine: Bool

    public var id: String {
        label
    }
}

/// A Picks later figure and its tone (headline.ts Later): plus is later than his place, so green.
public struct ReportLater: Equatable, Sendable {
    public let text: String
    public let tone: GapTone
}

/// One pick of the drafter's as Pick by pick prints it at 390 (PickReview.svelte): the pick, the player,
/// his slot, Over repl (or a kicker's place in draft order), Picks later against the drafters and our
/// board, Still there, and who made it.
public struct ReportPickLine: Equatable, Sendable, Identifiable {
    public let pick: String
    public let player: RoomPlayer?
    public let name: String
    public let slot: String
    public let figure: String
    public let figureMuted: Bool
    public let adp: ReportLater?
    public let ours: ReportLater?
    public let still: String
    public let stillWait: Bool
    public let stillMuted: Bool
    /// Who made the pick: You, or Kept for a keeper.
    public let madeBy: String
    /// The drafter made it himself: its By in ink.
    public let mine: Bool

    public var id: String {
        pick
    }
}

/// The seat's finish: its points, its place, and its cells (headline.ts standingCells).
struct Standing {
    let points: Double
    let rank: Int
    let cells: [ReportCell]
}

/// The Still there cell (headline.ts stillThereCell): its words, tinted when he could have waited,
/// muted when there is no chance to show.
struct StillThere {
    let text: String
    let wait: Bool
    let muted: Bool
}

/// A team on the field (FieldBars.svelte): its place, its name, its points and its bar's share.
public struct FieldLine: Equatable, Sendable, Identifiable {
    public let rank: Int
    public let name: String
    public let points: String
    public let share: Double
    public let you: Bool

    public var id: Int {
        rank
    }
}

/// The same draft run again (RunsSection.svelte): the histogram's bars and its median, the three
/// figures, and how often each place came up.
public struct ReportRunsModel: Equatable, Sendable {
    public let title: String
    public let note: String
    public let bins: [Int]
    public let medianBin: Int
    public let low: String
    public let high: String
    public let median: String
    public let middle: String
    public let topShare: String
    public let topWords: String
    public let ranks: [Int]
    /// The draft's own place, ringed in the rank counts.
    public let rank: Int
}

/// Who the runs land (Exposure.svelte): each with his share of the runs.
public struct ExposureLine: Equatable, Sendable, Identifiable {
    public let player: RoomPlayer
    public let share: Double
    public let percent: String

    public var id: String {
        player.id
    }
}

/// The report on a finished draft from the drafter's seat as the web draws it (room/report/Report.svelte
/// with headline.ts), for the companion's seats: the one big number and its caption, the finish and
/// the draft as cells, the basis once, the field, pick by pick, the runs and who they land. Pure, held
/// to shared/fixtures/parity/companion.json.
public struct DraftReportModel: Equatable, Sendable {
    public let title: String
    public let points: String?
    public let caption: String
    public let cells: [ReportCell]
    public let basis: String
    public let fieldNote: String
    public let field: [FieldLine]
    public let picksNote: String
    public let picks: [ReportPickLine]
    public let runs: ReportRunsModel
    public let exposureTitle: String
    public let exposureAside: String
    public let exposure: [ExposureLine]

    /// RunsSection.svelte BINS and Exposure.svelte ROWS.
    static let bins = 12
    static let exposureRows = 8

    /// `names` are the seats' names, slot 1 first; `seats` who the other seats are ("Your league on
    /// Sleeper"); `reshuffled` who stands in for them in the runs.
    public init(_ report: MockReport, names: [String], seats: String, reshuffled: String) {
        let board = RoomBoardView(report.board.value1, teams: report.teams)
        let head = Self.standing(report)
        title = "Your draft from slot \(report.slot)"
        points = head.map { Formatting.count($0.points) }
        caption = "points from your QB, RB, WR and TE starters"
        cells = (head?.cells ?? []) + Self.settings(report, seats: seats)
        basis = Self.basis(board.basis, couldWaitFrom: report.couldWaitFrom)
        fieldNote = "projected starting points, \(report.teams) teams"
        let top = max(report.standings.map(\.points).max() ?? 1, 1)
        field = report.standings.map { team in
            FieldLine(
                rank: team.rank, name: team.seat - 1 < names.count ? names[team.seat - 1] : "Seat \(team.seat)",
                points: Formatting.count(team.points), share: team.points / top, you: team.seat == report.slot
            )
        }
        picksNote = "\(report.picks.count) picks, starters by slot"
        picks = Self.picks(report, board: board)
        runs = Self.runs(report.runs, teams: report.teams, rank: head?.rank ?? 0, reshuffled: reshuffled)
        exposureTitle = "Who you end up with"
        exposureAside = "share of \(report.runs.runs) runs"
        exposure = report.runs.exposure.prefix(Self.exposureRows).compactMap { entry in
            board.byID[entry.playerId].map {
                ExposureLine(player: $0, share: entry.share, percent: DraftFormat.percent(entry.share))
            }
        }
    }

    /// headline.ts standingCells: the seat's place of the field, the team just ahead (or just behind,
    /// for the leader), and the leader; nil when the standings do not hold the seat.
    static func standing(_ report: MockReport) -> Standing? {
        guard let mine = report.standings.first(where: { $0.seat == report.slot }) else {
            return nil
        }
        let byRank = report.standings.sorted { $0.rank < $1.rank }
        var cells = [ReportCell(label: "of \(report.teams)", value: Formatting.ordinal(mine.rank), mine: true)]
        let leader = byRank.first
        let near = byRank.first { $0.rank == (mine.rank == 1 ? 2 : mine.rank - 1) }
        if let near, near.seat != leader?.seat {
            cells.append(ReportCell(
                label: Formatting.ordinal(near.rank),
                value: Formatting.count(near.points),
                mine: false
            ))
        }
        if let leader, leader.seat != report.slot {
            cells.append(ReportCell(label: "Leader", value: Formatting.count(leader.points), mine: false))
        }
        return Standing(points: mine.points, rank: mine.rank, cells: cells)
    }

    /// headline.ts settingCells: teams, scoring, rounds and who the other seats are.
    static func settings(_ report: MockReport, seats: String) -> [ReportCell] {
        [
            ReportCell(label: "Teams", value: String(report.teams), mine: false),
            ReportCell(label: "Scoring", value: RoomWords.scoring(report.settings), mine: false),
            ReportCell(label: "Rounds", value: String(report.rounds), mine: false),
            ReportCell(label: "Other seats", value: seats, mine: false),
        ]
    }

    /// headline.ts reportBasis: every figure's basis, said once.
    static func basis(_ boardBasis: String, couldWaitFrom: Double) -> String {
        let from = StartRows.jsRound(couldWaitFrom * 100)
        return "\(boardBasis) Picks later: the pick less his ADP, or less his place on our board (no kickers or "
            + "defenses there), plus is later. Still there: the room's read at that pick, tinted from \(from)%."
    }

    static func picks(_ report: MockReport, board: RoomBoardView) -> [ReportPickLine] {
        let slotOf = Dictionary(
            report.starters.compactMap { starter in starter.playerId.map { ($0, Self.slotLabel(starter.slot)) } },
            uniquingKeysWith: { first, _ in first }
        )
        let last = report.picks.last { $0.chip.value1 != .kept }?.pick
        return report.picks.map { pick in
            let player = board.byID[pick.playerId]
            let kept = pick.chip.value1 == .kept
            let figure = Self.figure(pick.overReplacement, player: player)
            let still = Self.still(pick, last: last, couldWaitFrom: report.couldWaitFrom)
            return ReportPickLine(
                pick: DraftFormat.pickLabel(pick.pick, teams: report.teams), player: player,
                name: player?.name ?? pick.playerId, slot: slotOf[pick.playerId] ?? Words.Report.bench,
                figure: figure.text, figureMuted: figure.muted,
                adp: kept ? nil : pick.adpGap.map { Self.later($0, decimals: 1) },
                ours: kept ? nil : pick.boardGap.map { Self.later(Double($0), decimals: 0) },
                still: still.text, stillWait: still.wait, stillMuted: still.muted, madeBy: Self.madeBy(pick),
                mine: pick.madeBy.value1 == .you
            )
        }
    }

    /// words.ts slotLabel: DEF is DST, SUPERFLEX is SFLX.
    static func slotLabel(_ slot: String) -> String {
        switch slot {
        case "DEF": "DST"
        case "SUPERFLEX": "SFLX"
        default: slot
        }
    }

    /// headline.ts pickFigure: a kicker's or a defense's place in draft order, else his points over
    /// replacement signed, else "no projection".
    static func figure(_ overReplacement: Double?, player: RoomPlayer?) -> (text: String, muted: Bool) {
        if let player, player.isMarket {
            return ("Draft order \(player.positionRank)", true)
        }
        guard let overReplacement else {
            return ("no projection", true)
        }
        return (Formatting.signed(overReplacement), false)
    }

    /// headline.ts later: the API's figure signed, "0" at zero, and its tone.
    static func later(_ gap: Double, decimals: Int) -> ReportLater {
        ReportLater(
            text: gap == 0 ? "0" : Formatting.signed(gap, decimals: decimals),
            tone: gap > 0 ? .gain : gap < 0 ? .loss : .even
        )
    }

    /// headline.ts stillThereCell: the chance he was there at your next turn, tinted when he could have
    /// waited; empty for a pick nobody chose.
    static func still(
        _ pick: Components.Schemas.ReportPick, last: Int?, couldWaitFrom: Double
    ) -> StillThere {
        if pick.madeBy.value1 != .you || pick.chip.value1 == .kept {
            return StillThere(text: "", wait: false, muted: true)
        }
        guard let chance = pick.stillThere else {
            return StillThere(text: pick.pick == last ? "last pick" : "not read", wait: false, muted: true)
        }
        return StillThere(text: DraftFormat.chanceShort(chance), wait: chance >= couldWaitFrom, muted: false)
    }

    /// headline.ts byWords, for your own draft: who made the pick, or Kept for a keeper.
    static func madeBy(_ pick: Components.Schemas.ReportPick) -> String {
        if pick.chip.value1 == .kept {
            return "Kept"
        }
        switch pick.madeBy.value1 {
        case .you?: return "You"
        case .forYou?: return "Pick for me"
        case .queue?: return "Your queue"
        case .clock?: return "Your clock"
        case nil: return pick.madeBy.value2 ?? ""
        }
    }

    /// RunsSection.svelte: the histogram over the runs' points in twelve bars, its median's bar, and
    /// the figures whole.
    static func runs(
        _ runs: Components.Schemas.ReportRuns,
        teams: Int,
        rank: Int,
        reshuffled: String
    ) -> ReportRunsModel {
        let low = runs.points.first ?? 0
        let high = runs.points.last ?? 0
        let width = (high - low) / Double(bins) == 0 ? 1 : (high - low) / Double(bins)
        var counts = Array(repeating: 0, count: bins)
        for point in runs.points {
            counts[min(bins - 1, Int(((point - low) / width).rounded(.down)))] += 1
        }
        return ReportRunsModel(
            title: "The same draft, \(runs.runs) more times",
            note: "your picks on autopick from the board, \(reshuffled) reshuffled each run",
            bins: counts, medianBin: min(bins - 1, Int(((runs.median - low) / width).rounded(.down))),
            low: Formatting.count(low), high: Formatting.count(high), median: Formatting.count(runs.median),
            middle: "\(Formatting.count(runs.middleLow)) to \(Formatting.count(runs.middleHigh))",
            topShare: DraftFormat.percent(runs.topShare),
            topWords: "of runs finish top \(runs.topFinish) of \(teams)", ranks: runs.rankCounts, rank: rank
        )
    }
}
