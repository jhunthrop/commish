import CommishAPI
import CommishDesign
import Foundation

/// A side's numbers in the compared format (schema.ts PlayerFormat), from his page or, for a page the
/// run held with no copy, the leading board's row.
struct CompareNumbers: Equatable, Sendable {
    let ourRank: Int
    let positionRank: Int
    let projected: Double
    let vor: Double
    let adp: Double?
    let gap: Double?
    let floor: Double?
    let median: Double?
    let ceiling: Double?

    init(_ format: RunPlayerFormat) {
        ourRank = format.ourRank
        positionRank = format.positionRank
        projected = format.projected
        vor = format.vor
        adp = format.adp
        gap = format.gap
        floor = format.floor
        median = format.median
        ceiling = format.ceiling
    }

    init(_ row: RunBoardRow) {
        ourRank = row.ourRank
        positionRank = row.positionRank
        projected = row.projected
        vor = row.vor
        adp = row.adp
        gap = row.gap
        floor = row.floor
        median = row.median
        ceiling = row.ceiling
    }

    /// compare-rows.ts sideRange: all three, or none.
    var range: CompareRange? {
        guard let floor, let median, let ceiling else {
            return nil
        }
        return CompareRange(floor: floor, median: median, ceiling: ceiling)
    }
}

/// A side's floor, median and ceiling, and the scale the pair's bars share.
public struct CompareRange: Equatable, Sendable {
    public let floor: Double
    public let median: Double
    public let ceiling: Double
}

/// One player as Compare reads him (site/player-data.ts PlayerData): who he is, his numbers in every
/// format the run gives him, his status on the capture, his season so far and last season's line.
struct ComparePlayer: Equatable, Sendable {
    let id: String
    let slug: String
    let name: String
    let position: String
    let team: String
    let headshot: URL?
    let formats: [String: CompareNumbers]
    let status: RunPlayerStatus?
    let seasonSoFar: (games: Int, pointsPerGame: Double?)?
    let lastSeasonPerGame: Double?
    let priorSeasons: [Components.Schemas.RunPriorSeason]

    static func == (lhs: ComparePlayer, rhs: ComparePlayer) -> Bool {
        lhs.id == rhs.id && lhs.formats == rhs.formats && lhs.status == rhs.status
    }

    /// The word a season-long list gives his ranks ("IR"), nil for anyone else.
    var heldRank: String? {
        guard let status, status.seasonLong, let known = status.status.value1 else {
            return nil
        }
        return RowStatuses.rankWord(known)
    }
}

/// One side of the table: the player, his numbers in the compared format, his club's bye.
struct CompareSide: Equatable, Sendable {
    let player: ComparePlayer
    let numbers: CompareNumbers
    let bye: Int?
}

/// A cell of the table: its words, whether it is the better of the two (nil where the row has no
/// better) and a signed gap's tone.
public struct CompareCell: Equatable, Sendable {
    public let text: String
    public let wins: Bool?
    public let tone: GapTone?
}

/// A row of the table: its label and the two cells, the leader's first; a range row draws bars.
public struct CompareRow: Equatable, Sendable, Identifiable {
    public let label: String
    public let cells: [CompareCell]
    public let range: Bool

    public var id: String {
        label
    }
}

/// Compare's table row by row (web/src/lib/site/compare-rows.ts), ported and held to
/// shared/fixtures/parity/reference.json.
enum CompareRows {
    /// The Gap row's label, which the basis reads to say the Gap's sentence only beside it.
    static let gapLabel = "Gap"

    /// Which figure is better: the higher or the lower.
    enum Better {
        case higher
        case lower
    }

    static func figures(
        _ label: String, _ values: (Double?, Double?), text: (Double) -> String, better: Better?
    ) -> CompareRow {
        let (lhs, rhs) = values
        var judged = false
        var leftWins = false
        if let better, let lhs, let rhs, lhs != rhs {
            judged = true
            leftWins = better == .higher ? lhs > rhs : lhs < rhs
        }
        func cell(_ value: Double?, _ wins: Bool) -> CompareCell {
            CompareCell(text: value.map(text) ?? Words.Box.none, wins: judged ? wins : nil, tone: nil)
        }
        return CompareRow(label: label, cells: [cell(lhs, leftWins), cell(rhs, judged && !leftWins)], range: false)
    }

    /// A rank row: the lower rank wins, unless a side is on a season-long list.
    static func rank(_ label: String, _ ranks: (Int, Int), words: (String, String), judged: Bool) -> CompareRow {
        let row = figures(
            label,
            (Double(ranks.0), Double(ranks.1)),
            text: { String(Int($0)) },
            better: judged ? .lower : nil
        )
        return CompareRow(
            label: label,
            cells: [
                CompareCell(text: words.0, wins: row.cells[0].wins, tone: nil),
                CompareCell(text: words.1, wins: row.cells[1].wins, tone: nil),
            ],
            range: false
        )
    }

    static func rows(_ first: CompareSide, _ second: CompareSide, season: Int, underway: Bool) -> [CompareRow] {
        func pair<T>(_ read: (CompareSide) -> T) -> (T, T) {
            (read(first), read(second))
        }
        let held = pair { $0.player.heldRank }
        let judged = held.0 == nil && held.1 == nil
        let gapRow = Self.gapRow(pair { $0.player.heldRank == nil ? $0.numbers.gap : nil })
        let rangeRow = Self.rangeRow(pair { $0.numbers.range != nil })
        let fixed = { (value: Double) in Formatting.fixed(value) }
        let whole = { (value: Double) in String(Int(value)) }
        var rows = [
            rank(
                "Our rank", pair { $0.numbers.ourRank },
                words: pair { $0.player.heldRank ?? String($0.numbers.ourRank) }, judged: judged
            ),
            rank(
                "Position rank", pair { $0.numbers.positionRank },
                words: pair { "\($0.player.position) \($0.player.heldRank ?? String($0.numbers.positionRank))" },
                judged: judged
            ),
            figures(Words.Figure.projected, pair { $0.numbers.projected }, text: fixed, better: .higher),
            figures("Over replacement", pair { $0.numbers.vor }, text: BoardFigures.signed, better: .higher),
        ]
        rows += rangeRow
        rows.append(figures(Words.Board.adp, pair { $0.numbers.adp }, text: fixed, better: nil))
        rows += gapRow
        rows.append(figures(Words.Board.bye, pair { $0.bye.map(Double.init) }, text: whole, better: nil))
        if underway {
            rows.append(figures(
                Words.Figure.avg, pair { $0.player.seasonSoFar?.pointsPerGame }, text: fixed, better: .higher
            ))
            rows.append(figures(
                "GP",
                pair { $0.player.seasonSoFar.map { Double($0.games) } },
                text: whole,
                better: nil
            ))
        }
        rows.append(figures(
            "\(season - 1) \(Words.Figure.avg)", pair { $0.player.lastSeasonPerGame }, text: fixed, better: .higher
        ))
        return rows
    }

    /// The Gap row, only when one of the pair carries the run's gap; none for a held side.
    private static func gapRow(_ gaps: (Double?, Double?)) -> [CompareRow] {
        let cell = { (value: Double?) in CompareCell(text: BoardFigures.gap(value), wins: nil, tone: GapTone(value)) }
        return gaps.0 != nil || gaps.1 != nil
            ? [CompareRow(label: gapLabel, cells: [cell(gaps.0), cell(gaps.1)], range: false)] : []
    }

    /// The Floor to ceiling row, only when one of the pair carries a range: bars, or the empty mark.
    private static func rangeRow(_ ranged: (Bool, Bool)) -> [CompareRow] {
        guard ranged.0 || ranged.1 else {
            return []
        }
        let cells = [ranged.0, ranged.1].map { CompareCell(text: $0 ? "" : Words.Box.none, wins: nil, tone: nil) }
        return [CompareRow(label: "Floor to ceiling", cells: cells, range: true)]
    }
}

/// Our call between two players (web/src/lib/site/verdict.ts), ported: the table's head cell and its
/// one evidence line.
enum Verdict {
    case same
    case call(leader: CompareSide, other: CompareSide, leaderName: String, call: String, evidence: String)

    static func between(_ lhs: CompareSide, _ rhs: CompareSide, formatLabel: String) -> Verdict {
        if lhs.player.id == rhs.player.id {
            return .same
        }
        let lhsHeld = held(lhs)
        let rhsHeld = held(rhs)
        if lhsHeld != nil || rhsHeld != nil {
            return heldCall(lhs, rhs, formatLabel: formatLabel)
        }
        let (leader, other) = lhs.numbers.ourRank <= rhs.numbers.ourRank ? (lhs, rhs) : (rhs, lhs)
        let names = Self.names(leader, other)
        return called(
            leader, other, names: names,
            evidence: "\(names.leader) is \(Formatting.ordinal(leader.numbers.ourRank)) on our \(formatLabel) board "
                + "and \(names.other) \(Formatting.ordinal(other.numbers.ourRank)), with "
                + "\(BoardFigures.signed(leader.numbers.vor)) over replacement against "
                + "\(BoardFigures.signed(other.numbers.vor))."
        )
    }

    /// His season-long designation, nil when he is available.
    private static func held(_ side: CompareSide) -> RowStatuses.Status? {
        guard let status = side.player.status, status.seasonLong else {
            return nil
        }
        return status.status.value1
    }

    private static func names(_ leader: CompareSide, _ other: CompareSide) -> (leader: String, other: String) {
        let shared = StartRows.lastName(leader.player.name) == StartRows.lastName(other.player.name)
        return shared
            ? (leader.player.name, other.player.name)
            : (StartRows.lastName(leader.player.name), StartRows.lastName(other.player.name))
    }

    private static func called(
        _ leader: CompareSide, _ other: CompareSide, names: (leader: String, other: String), evidence: String
    ) -> Verdict {
        .call(
            leader: leader, other: other, leaderName: names.leader, call: "We would take \(names.leader)",
            evidence: evidence
        )
    }

    private static func heldCall(_ lhs: CompareSide, _ rhs: CompareSide, formatLabel: String) -> Verdict {
        let lhsHeld = held(lhs)
        let rhsHeld = held(rhs)
        if lhsHeld != nil, rhsHeld != nil {
            let (leader, other) = lhs.numbers.vor >= rhs.numbers.vor ? (lhs, rhs) : (rhs, lhs)
            let names = Self.names(leader, other)
            return called(
                leader, other, names: names,
                evidence: "Both are on season-long lists, so neither sits above the available players on our "
                    + "\(formatLabel) board. If both play, \(names.leader) has "
                    + "\(BoardFigures.signed(leader.numbers.vor)) "
                    + "over replacement against \(BoardFigures.signed(other.numbers.vor))."
            )
        }
        let status = lhsHeld ?? rhsHeld
        let (leader, other) = lhsHeld != nil ? (rhs, lhs) : (lhs, rhs)
        let names = Self.names(leader, other)
        let word = status.map(RowStatuses.word) ?? ""
        return called(
            leader, other, names: names,
            evidence: "\(names.other) is \(word.prefix(1).lowercased())\(word.dropFirst()), so he sits below the "
                + "available players on our \(formatLabel) board."
        )
    }
}
