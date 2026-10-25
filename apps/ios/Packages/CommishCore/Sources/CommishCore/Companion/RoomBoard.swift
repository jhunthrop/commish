import CommishAPI
import Foundation

/// A board player as the rooms draw him (web/src/lib/room/model.ts RoomPlayer): the engine's DEF as
/// the site's DST, his points over replacement and the round they rank in, for the value cell's tint.
public struct RoomPlayer: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// QB, RB, WR, TE, K or DST.
    public let position: String
    public let positionRank: Int
    public let team: String
    public let headshot: String
    public let adp: Double?
    public let points: Double?
    public let vor: Double?
    public let gap: Double?
    /// The round his points over replacement rank in on this board, nil with none.
    public let vorRound: Int?
    public let bye: Int?

    /// A kicker or a defense, ranked in draft order with no projection (run/market.ts isMarketPosition).
    public var isMarket: Bool {
        position == "K" || position == "DST"
    }

    /// His pill: "WR 6".
    public var pill: String {
        "\(position) \(positionRank)"
    }

    /// The player sheet's player: his page by the site's slug rule, his board id to read him by.
    public var sheetPlayer: SheetPlayer {
        SheetPlayer(
            id: id, slug: PlayerSlug.of(name), name: name, position: position, rank: String(positionRank),
            club: team, boardID: id
        )
    }
}

/// The site's slug rule for a player's page (research/nightly/build/pages.py slug_of, the web's
/// run-from-mock-data.ts): accents dropped, lower case, words joined by hyphens. A shared name's page
/// carries his position and club too, which the sheet then reads by his board id.
public enum PlayerSlug {
    public static func of(_ name: String) -> String {
        let plain = name.folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US")).lowercased()
        let joined = plain.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        return joined.replacingOccurrences(of: "^-|-$", with: "", options: .regularExpression)
    }
}

/// The board as the rooms read it (model.ts Board): players in the order drafters take them, by id.
public struct RoomBoardView: Equatable, Sendable {
    public let players: [RoomPlayer]
    public let byID: [String: RoomPlayer]
    public let basis: String

    /// model.ts boardOf: each player's value round counted over the players who carry a value, best
    /// first, by the league's team count.
    public init(_ board: RoomBoard, teams: Int) {
        let valued = board.players.enumerated()
            .compactMap { index, player in player.vor.map { (index, player.id, $0) } }
            .sorted { $0.2 != $1.2 ? $0.2 > $1.2 : $0.0 < $1.0 }
        var valueRank: [String: Int] = [:]
        for (place, entry) in valued.enumerated() {
            valueRank[entry.1] = place + 1
        }
        let players = board.players.map { player in
            RoomPlayer(
                id: player.id, name: player.name, position: Self.position(player.position),
                positionRank: player.positionRank, team: player.team, headshot: player.headshot, adp: player.adp,
                points: player.points, vor: player.vor, gap: player.gap,
                vorRound: valueRank[player.id].map { ($0 + teams - 1) / teams }, bye: player.bye
            )
        }
        self.players = players
        byID = Dictionary(players.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        basis = board.basis
    }

    /// The engine's DEF is the site's DST.
    static func position(_ position: Components.Schemas.PlayerPosition) -> String {
        if position.value1 == .def {
            return "DST"
        }
        return position.value1?.rawValue ?? position.value2 ?? ""
    }
}

/// A pick placed on our board (room/api.ts RoomPick): who made it and whom it took.
public struct PlacedPick: Equatable, Sendable {
    public let pick: Int
    public let round: Int
    public let seat: Int
    public let playerID: String
}

/// The rooms' readers over a draft (web/src/lib/room/model.ts): whose turn, the pool, the strip since
/// your last pick and your team by slot. Pure.
public enum RoomDraft {
    /// The chips a pool is filtered by, All first.
    public static let filters = ["All", "QB", "RB", "WR", "TE", "K", "DST"]

    /// The seat on the clock at a pick.
    public static func seatAt(_ pick: Int, teams: Int) -> Int {
        DraftFormat.snakeSlot(pick, teams: teams).seat
    }

    /// The seat's last pick before a pick, or nil before its first.
    public static func turnBefore(_ pick: Int, seat: Int, teams: Int) -> Int? {
        stride(from: pick - 1, through: 1, by: -1).first { seatAt($0, teams: teams) == seat }
    }

    /// The players a pick list took.
    public static func drafted(_ picks: [PlacedPick]) -> Set<String> {
        Set(picks.map(\.playerID))
    }

    /// Every pick after `since`, each with the board's player.
    public static func wentSince(_ picks: [PlacedPick], since: Int, board: RoomBoardView) -> [(RoomPlayer, Int)] {
        picks.filter { $0.pick > since }.compactMap { pick in board.byID[pick.playerID].map { ($0, pick.pick) } }
    }

    /// model.ts poolRows: the players left under a chip, by points over replacement, the players
    /// without one after in the order drafters take them (a stable sort, as the web's).
    public static func pool(_ board: RoomBoardView, drafted: Set<String>, filter: String) -> [RoomPlayer] {
        board.players.enumerated()
            .filter { !drafted.contains($0.element.id) && (filter == "All" || $0.element.position == filter) }
            .sorted { lhs, rhs in
                let left = lhs.element.vor ?? -.infinity
                let right = rhs.element.vor ?? -.infinity
                return left != right ? left > right : lhs.offset < rhs.offset
            }
            .map(\.element)
    }

    /// model.ts rosterSlots: the roster as slots in the order the engine fills them, each with the
    /// positions it takes.
    public static func rosterSlots(_ settings: RoomSettings) -> [(slot: String, takes: Set<String>)] {
        let roster = settings.roster
        let lineup = settings.lineup.value1?.rawValue ?? settings.lineup.value2 ?? ""
        let flex: Set = ["RB", "WR", "TE"]
        func repeated(_ slot: String, _ count: Int, _ takes: Set<String>) -> [(slot: String, takes: Set<String>)] {
            Array(repeating: (slot, takes), count: max(0, count))
        }
        return repeated("QB", roster.qb, ["QB"]) + repeated("RB", roster.rb, ["RB"]) + repeated("WR", roster.wr, ["WR"])
            + repeated("TE", roster.te, ["TE"]) + repeated("FLEX", lineup == "two_flex" ? 2 : 1, flex)
            + repeated("SFLX", lineup == "superflex" ? 1 : 0, flex.union(["QB"])) + repeated("K", roster.k, ["K"])
            + repeated("DST", roster.dst, ["DST"])
            + repeated("BN", roster.bench, ["QB", "RB", "WR", "TE", "K", "DST"])
    }

    /// model.ts teamSlots: your team by slot, each pick in the first open slot that takes him; the
    /// bench shows only who is on it.
    public static func team(_ settings: RoomSettings, mine: [PlacedPick], board: RoomBoardView) -> [TeamSlot] {
        let takes = rosterSlots(settings)
        var slots = takes.map { TeamSlot(slot: $0.slot, player: nil, pick: nil) }
        for pick in mine {
            guard let player = board.byID[pick.playerID] else {
                continue
            }
            if let open = slots.indices
                .first(where: { slots[$0].player == nil && takes[$0].takes.contains(player.position) }) {
                slots[open] = TeamSlot(slot: slots[open].slot, player: player, pick: pick.pick)
            }
        }
        return slots.filter { $0.slot != "BN" || $0.player != nil }
    }
}

/// One line of your roster: a slot and who fills it, with the pick that took him.
public struct TeamSlot: Equatable, Sendable {
    public let slot: String
    public let player: RoomPlayer?
    public let pick: Int?
}
