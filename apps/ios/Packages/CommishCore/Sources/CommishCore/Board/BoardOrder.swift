import CommishAPI
import Foundation

/// A row a board places: his id, his position and his place at it.
protocol PlacedRow {
    var id: String { get }
    var positionRank: Int { get }
    var positionName: String { get }
}

extension RunBoardRow: PlacedRow {
    var positionName: String {
        position.value1?.rawValue ?? position.value2 ?? ""
    }
}

extension RunMarketRow: PlacedRow {
    var positionName: String {
        position.value1?.rawValue ?? position.value2 ?? ""
    }
}

/// A position's tier as the web draws it (run/tiers.ts TierGroup): its number, the players shown in
/// it, and its drop to the next tier as the run writes it, nil where the drop is not said.
struct TierGroup {
    let tier: Int
    let rows: [RunBoardRow]
    let drop: Double?
}

/// The rows a view lists as the web's board page lists them (server/pages/board.ts, BoardView.svelte),
/// over the run's board, whose ranked rows come in our order: the All view the run's order, a
/// position's view by his place at it in tiers, and a kicker's or a defense's the drafts' order; each
/// player on a season-long list after the last available player at his position. Nothing here numbers
/// a player: every number is the run's.
enum BoardOrder {
    typealias Statuses = [String: RunPlayerStatus]

    /// derive.ts rowsAt and market.ts marketAt: a position's rows by their place, ties as listed.
    static func at<Row: PlacedRow>(_ rows: [Row], position: BoardPosition) -> [Row] {
        rows.enumerated()
            .filter { $0.element.positionName == position.rawValue }
            .sorted { ($0.element.positionRank, $0.offset) < ($1.element.positionRank, $1.offset) }
            .map(\.element)
    }

    static func heldOut(_ row: some PlacedRow, _ statuses: Statuses) -> Bool {
        statuses[row.id]?.seasonLong == true
    }

    /// board-status.ts withStatuses: each player on a season-long list after the last available player
    /// at his position, in their order; a position with nobody available as it was.
    static func withStatuses<Row: PlacedRow>(_ rows: [Row], _ statuses: Statuses) -> [Row] {
        var lastAvailable: [String: Int] = [:]
        var waiting: [String: [Row]] = [:]
        for (index, row) in rows.enumerated() {
            if heldOut(row, statuses) {
                waiting[row.positionName, default: []].append(row)
            } else {
                lastAvailable[row.positionName] = index
            }
        }
        return rows.enumerated().flatMap { index, row -> [Row] in
            let last = lastAvailable[row.positionName]
            let here = !heldOut(row, statuses) || last == nil ? [row] : []
            return here + (index == last ? waiting[row.positionName] ?? [] : [])
        }
    }

    /// run/tiers.ts tierGroups: a position's tiers in order, its players on a season-long list left
    /// out, each tier's drop said only where neither its last player nor the next tier's first is.
    static func tiers(_ rows: [RunBoardRow], position: BoardPosition, _ statuses: Statuses) -> [TierGroup] {
        let all = at(rows, position: position)
        let out = { (row: RunBoardRow) in heldOut(row, statuses) }
        var groups: [(tier: Int, rows: [RunBoardRow])] = []
        for row in all where !out(row) {
            if groups.last?.tier == row.tier {
                groups[groups.count - 1].rows.append(row)
            } else {
                groups.append((row.tier, [row]))
            }
        }
        return groups.map { group in
            let end = all.last { $0.tier == group.tier }
            let start = all.first { $0.tier == group.tier + 1 }
            let shown = end.map { !out($0) } == true && start.map { !out($0) } == true
            return TierGroup(tier: group.tier, rows: group.rows, drop: shown ? end?.tierDrop : nil)
        }
    }
}
