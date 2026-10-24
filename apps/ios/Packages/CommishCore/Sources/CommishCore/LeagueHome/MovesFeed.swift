import CommishAPI
import CommishDesign
import Foundation

public struct MovePlayerLine: Sendable, Equatable {
    public let name: String
    public let position: String
    public let club: String
    /// The team that took him in a trade.
    public let to: String?

    /// "RB CHI": his position and club, beside the name.
    public var detail: String {
        "\(position) \(club)"
    }
}

/// One move as the feed draws it (home.ts FeedRow): its day and time, its kind, its teams, the players
/// in and out, a claim's bid.
public struct MoveLine: Sendable, Equatable, Identifiable {
    public let id: String
    public let when: String
    public let kind: String
    public let teams: [String]
    public let adds: [MovePlayerLine]
    public let drops: [MovePlayerLine]
    public let detail: String
    public let mine: Bool
}

public struct MovesSection: Sendable, Equatable {
    public let title: String
    public let aside: String
    public let rows: [MoveLine]
    /// Said in place of the rows: no moves this week or last, or a platform that gives none to us.
    public let note: String?
}

/// home.ts feedRows and movesBasis.
enum MovesFeed {
    typealias Home = CommishDesign.Words.LeagueHome

    static func section(_ sync: LeagueSync, zone: TimeZone) -> MovesSection {
        let rows = sync.movesRead ? lines(sync, zone: zone) : []
        let note: String? = if !sync.movesRead {
            "\(PortedWords.platform(sync.host)) gives no move history to us."
        } else if rows.isEmpty {
            Home.noMoves
        } else {
            nil
        }
        return MovesSection(title: Home.moves, aside: Home.movesAside, rows: rows, note: note)
    }

    static func lines(_ sync: LeagueSync, zone: TimeZone) -> [MoveLine] {
        let names = Dictionary(sync.teams.map { ($0.rosterId, $0.name) }, uniquingKeysWith: { first, _ in first })
        let name = { (id: Int) in names[id] ?? "Team \(id)" }
        return sync.moves.enumerated().map { index, move in
            let trade = move.kind == .trade
            let dropOnly = !trade && move.adds.isEmpty && !move.drops.isEmpty
            let player = { (moved: Components.Schemas.MovePlayer, to: String?) in
                MovePlayerLine(
                    name: moved.player.name,
                    position: moved.player.position == "DEF" ? "D/ST" : moved.player.position,
                    club: moved.player.team,
                    to: to
                )
            }
            return MoveLine(
                id: "\(move.at.timeIntervalSince1970)-\(index)",
                when: Formatting.weekdayTime(move.at, zone: zone),
                kind: dropOnly ? PortedWords.MoveKind.drop : kind(move.kind),
                teams: move.rosterIds.map(name),
                adds: move.adds.map { player($0, trade ? name($0.rosterId) : nil) },
                drops: trade ? [] : move.drops.map { player($0, nil) },
                detail: move.bid.map { "\(Home.budget) \(Formatting.dollars($0))" } ?? "",
                mine: move.rosterIds.contains(sync.me)
            )
        }
    }

    private static func kind(_ kind: Components.Schemas.LeagueMove.KindPayload) -> String {
        switch kind {
        case .add: PortedWords.MoveKind.add
        case .waiver: PortedWords.MoveKind.waiver
        case .trade: PortedWords.MoveKind.trade
        }
    }
}
