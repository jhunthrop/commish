import CommishAPI
import CommishDesign
import Foundation

/// One row of the call (types/room.ts CallRow): the player and his chance of lasting.
public struct CallRow: Equatable, Sendable {
    public let player: RoomPlayer
    public let chance: Double?
}

/// Our call as the rooms show it (web/src/lib/room/call.ts CallView): the call first, then the next
/// two of the shortlist still in the pool, each with the chance the card recorded for him.
public struct CallView: Equatable, Sendable {
    public let player: RoomPlayer
    public let rows: [CallRow]
    /// The pick the call is for, "2.08".
    public let forLabel: String
    /// The pick the chances look to, "3.05", nil at your last pick.
    public let nextLabel: String?
    public let conditional: Bool

    /// call.ts CALL_ROWS.
    static let rowCount = 3

    /// call.ts callView: nil when the board does not hold the card's call.
    public init?(_ card: RoomCard, board: RoomBoardView, drafted: Set<String>, teams: Int) {
        guard let player = board.byID[card.call] else {
            return nil
        }
        let rest = card.shortlist.compactMap { board.byID[$0.playerId] }
            .filter { $0.id != player.id && !drafted.contains($0.id) }
            .prefix(Self.rowCount - 1)
        self.player = player
        rows = ([player] + rest).map { CallRow(player: $0, chance: card.stillThere.additionalProperties[$0.id]) }
        forLabel = DraftFormat.pickLabel(card.forPick, teams: teams)
        nextLabel = card.nextPick.map { DraftFormat.pickLabel($0, teams: teams) }
        conditional = card.conditional
    }

    /// call.ts callTag: "Our call at 2.08", or off the clock "If the board holds to 2.08".
    public var tag: String {
        conditional ? "If the board holds to \(forLabel)" : "Our call at \(forLabel)"
    }

    /// call.ts chanceHead: "Still there 3.05" on your clock, "Reaches 2.08" on a call that waits on the
    /// board, none at your last pick.
    public var chanceHead: String? {
        if conditional {
            return "Reaches \(forLabel)"
        }
        return nextLabel.map { "Still there \($0)" }
    }
}

/// The rooms' words that carry a figure (web/src/lib/room/words.ts and call.ts), ported; the plain
/// words are the generated `Words.Room`.
public enum RoomWords {
    /// words.ts presetWords: a scoring preset in a sentence, "PPR", "half PPR".
    public static func preset(_ preset: String) -> String {
        switch preset {
        case "ppr": Words.Scoring.ppr
        case "half_ppr": Words.Scoring.half_ppr
        case "standard": Words.Scoring.standard
        case "te_premium": Words.Scoring.te_premium
        default: preset
        }
    }

    /// words.ts scoringWords: the preset, or "your scoring" for a league's own rules.
    public static func scoring(_ settings: RoomSettings) -> String {
        guard let preset = settings.scoring.preset?.value1, let raw = preset.value1?.rawValue ?? preset.value2 else {
            return "your scoring"
        }
        return Self.preset(raw)
    }

    /// words.ts lineupWords: "superflex", "two flex", nil for the standard lineup.
    public static func lineup(_ settings: RoomSettings) -> String? {
        switch settings.lineup.value1?.rawValue ?? settings.lineup.value2 {
        case "superflex": "superflex"
        case "two_flex": "two flex"
        default: nil
        }
    }

    /// words.ts leagueLine: "12 teams · your scoring · two flex · slot 5".
    public static func leagueLine(_ settings: RoomSettings, slot: Int) -> String {
        (["\(settings.teams) teams", scoring(settings)] + (lineup(settings).map { [$0] } ?? []) + ["slot \(slot)"])
            .joined(separator: " · ")
    }

    /// call.ts poolBasis: the board's basis, then where the chances come from.
    public static func poolBasis(_ board: RoomBoardView, card: RoomCard?, teams: Int) -> String {
        "\(board.basis) \(stillThereBasis(card, teams: teams))"
    }

    private static func stillThereBasis(_ card: RoomCard?, teams: Int) -> String {
        guard let card else {
            return "Still there lands with our call."
        }
        let target = card.nextPick.map { DraftFormat.pickLabel($0, teams: teams) } ?? "your last pick"
        if card.source.value1?.rawValue == "advisor" {
            return "Still there at \(target): where drafters take each player and how far they stray from it."
        }
        return "Still there at \(target): \(card.runs) runs of this room, each seat drafting as it has so far."
    }

    /// words.ts poolLine: "1,447 left to draft, ranked by points over replacement".
    public static func poolLine(_ left: Int) -> String {
        "\(Formatting.grouped(left)) \(Words.Pool.room), ranked by points over replacement"
    }

    /// words.ts chanceMissing: under a row with no chance to show.
    public static func chanceMissing(gone: Bool, read: Bool) -> String {
        if gone {
            return "no call"
        }
        return read ? "not read" : "with our call"
    }

    /// words.ts poolEmpty: the pool's line when no row is left under the chip.
    public static func poolEmpty(filter: String) -> String {
        "Nobody left\(filter == "All" ? "" : " at \(filter)")."
    }

    /// words.ts showMore: "Show 25 more".
    public static func showMore(_ rows: Int) -> String {
        "Show \(rows) more"
    }

    /// words.ts wallRounds: "rounds 1 to 3 of 20".
    public static func wallRounds(_ shown: Int, of rounds: Int) -> String {
        "rounds 1 to \(shown) of \(rounds)"
    }

    /// words.ts teamCount: "3 of 20".
    public static func teamCount(_ drafted: Int, of rosterSize: Int) -> String {
        "\(drafted) of \(rosterSize)"
    }

    /// words.ts sinceLead, for your own draft: "went since your pick at 1.05", "went before your first
    /// pick".
    public static func sinceLead(_ since: Int?, teams: Int) -> String {
        guard let since else {
            return "went before your first pick"
        }
        return "went since your pick at \(DraftFormat.pickLabel(since, teams: teams))"
    }

    /// A value cell as the pool's row prints it (PoolRow.svelte): his points over replacement signed,
    /// or a kicker's or a defense's place in draft order, else "no projection".
    public static func value(_ player: RoomPlayer) -> String {
        if let vor = player.vor, player.vorRound != nil {
            return Formatting.signed(vor)
        }
        return player.isMarket ? "Draft order \(player.positionRank)" : "no projection"
    }

    /// A call row's value (CallPanel.svelte): a kicker's or a defense's place in draft order, his points
    /// over replacement signed, or nothing.
    public static func callValue(_ row: CallRow) -> String {
        if row.player.isMarket {
            return "Draft order \(row.player.positionRank)"
        }
        return row.player.vor.map { Formatting.signed($0) } ?? ""
    }
}
