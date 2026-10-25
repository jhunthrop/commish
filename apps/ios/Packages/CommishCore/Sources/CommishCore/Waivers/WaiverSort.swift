import CommishAPI
import CommishDesign
import Foundation

/// The table's sortable columns (waivers.ts SortKey); the phone draws Player, Proj and Beats.
public enum WaiverSortKey: String, CaseIterable, Sendable {
    case name
    case game
    case proj
    case opp
    case avg
    case last
    case delta
    case rest
    case beats
}

/// A sort of the table (waivers.ts Sort): a column and whether highest first.
public struct WaiverSort: Equatable, Sendable {
    public let key: WaiverSortKey
    public let down: Bool

    public init(key: WaiverSortKey, down: Bool) {
        self.key = key
        self.down = down
    }

    /// waivers.ts DEFAULT_SORT: Beats, by the season Gain, the API's own order among the rows that gain.
    public static let initial = WaiverSort(key: .beats, down: true)

    /// waivers.ts nextSort: a column chosen again turns it around; a new column starts highest first, a
    /// name A to Z, a game soonest first.
    public func next(_ key: WaiverSortKey) -> WaiverSort {
        key == self.key ? WaiverSort(key: key, down: !down) : WaiverSort(key: key, down: key != .name && key != .game)
    }
}

/// A row's value for a column, nil when not held (always last, whichever way).
enum SortValue: Comparable {
    case number(Double)
    case text(String)
}

extension WaiverRows {
    /// waivers.ts valueOf.
    static func value(_ row: PoolRow, _ key: WaiverSortKey) -> SortValue? {
        let cells = row.cells.row
        let number: Double? = switch key {
        case .name: nil
        case .game: row.source.add.facts.kickoff?.timeIntervalSince1970
        case .proj: cells.proj
        case .opp: cells.oppRank.map(Double.init)
        case .avg: cells.avg
        case .last: cells.last
        case .delta: cells.delta
        case .rest: row.rest
        case .beats: row.order
        }
        return key == .name ? .text(cells.name) : number.map(SortValue.number)
    }

    /// waivers.ts sortRows: by a column, the not-held last, ties kept in the answer's order.
    static func sorted(_ rows: [PoolRow], by sort: WaiverSort) -> [PoolRow] {
        rows.enumerated().map { ($0.offset, $0.element, value($0.element, sort.key)) }.sorted { lhs, rhs in
            switch (lhs.2, rhs.2) {
            case (nil, nil): return lhs.0 < rhs.0
            case (nil, _): return false
            case (_, nil): return true
            case let (left?, right?):
                if left == right {
                    return lhs.0 < rhs.0
                }
                return sort.down ? left > right : left < right
            }
        }.map(\.1)
    }

    /// waivers.ts findRows: the rows whose name holds the search, any case; every row for an empty one.
    static func found(_ rows: [PoolRow], _ query: String) -> [PoolRow] {
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return wanted.isEmpty ? rows : rows.filter { $0.cells.row.name.lowercased().contains(wanted) }
    }
}
