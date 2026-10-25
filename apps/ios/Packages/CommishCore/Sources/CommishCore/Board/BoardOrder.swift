import CommishAPI
import CommishDesign
import Foundation

/// The rows a view lists, in our order, as the web's board orders them (BoardView.svelte), over the
/// API's board, whose players come in the order drafters take them. Nothing here numbers a player: a
/// row's position number is the API's `position_rank`, whatever the view leaves out (plan Review
/// Focus 4).
enum BoardOrder {
    struct Section {
        let id: String
        let head: String?
        let players: [BoardPlayer]
    }

    /// The ranked positions, which the All view lists (a kicker and a defense have no points of ours).
    static let ranked: Set<BoardPosition> = [.quarterback, .runningBack, .receiver, .tightEnd]

    static func sections(_ players: [BoardPlayer], position: BoardPosition?) -> [Section] {
        guard let position else {
            return [Section(id: "all", head: nil, players: all(players))]
        }
        let listed = players.filter { BoardPosition($0.position) == position }
        guard !position.draftOrder else {
            // A kicker's or a defense's view is the drafts' order, the API's own.
            return [Section(id: position.rawValue, head: nil, players: listed)]
        }
        // A position view: its available players by their place at the position, then those on a
        // season-long list under a head of their own (BoardView's tiers, then heldRows).
        let available = listed.filter { !heldOut($0) }.enumerated()
            .sorted { ($0.element.positionRank, $0.offset) < ($1.element.positionRank, $1.offset) }
            .map(\.element)
        let held = listed.filter(heldOut)
        return [Section(id: position.rawValue, head: nil, players: available)]
            + (held.isEmpty ? [] : [Section(
                id: "\(position.rawValue)-held",
                head: Words.Board.heldHead,
                players: held
            )])
    }

    /// The All view: every ranked player by points over replacement, the API's board's own order
    /// (draftroom boardRanks), each on a season-long list after the last available player at his
    /// position (board-status.ts withStatuses).
    static func all(_ players: [BoardPlayer]) -> [BoardPlayer] {
        let valued = players.enumerated().filter { _, player in
            player.vor != nil && BoardPosition(player.position).map(ranked.contains) == true
        }
        let ordered = valued.sorted { lhs, rhs in
            precedes(lhs.element, rhs.element) ?? (lhs.offset < rhs.offset)
        }.map(\.element)
        return withStatuses(ordered)
    }

    /// Whether `lhs` comes first: the larger value over replacement; at the same tenth, the place the
    /// API's Gap gives each (his ADP less the Gap), which the API ranked on the unrounded value; nil
    /// when neither tells them apart.
    static func precedes(_ lhs: BoardPlayer, _ rhs: BoardPlayer) -> Bool? {
        guard let left = lhs.vor, let right = rhs.vor else {
            return nil
        }
        if left != right {
            return left > right
        }
        guard let leftPlace = place(lhs), let rightPlace = place(rhs), leftPlace != rightPlace else {
            return nil
        }
        return leftPlace < rightPlace
    }

    /// His place on our board as the API's Gap says it: the Gap is his ADP less the place, both to a
    /// tenth, so the place is exact.
    static func place(_ player: BoardPlayer) -> Int? {
        guard let adp = player.adp, let gap = player.gap else {
            return nil
        }
        return Int((adp - gap).rounded())
    }

    static func heldOut(_ player: BoardPlayer) -> Bool {
        player.status?.seasonLong == true
    }

    /// board-status.ts withStatuses: each player on a season-long list after the last available player
    /// at his position, in their order; a position with nobody available as it was.
    static func withStatuses(_ players: [BoardPlayer]) -> [BoardPlayer] {
        var lastAvailable: [String: Int] = [:]
        var waiting: [String: [BoardPlayer]] = [:]
        for (index, player) in players.enumerated() {
            let position = player.position.value1?.rawValue ?? player.position.value2 ?? ""
            if heldOut(player) {
                waiting[position, default: []].append(player)
            } else {
                lastAvailable[position] = index
            }
        }
        return players.enumerated().flatMap { index, player -> [BoardPlayer] in
            let position = player.position.value1?.rawValue ?? player.position.value2 ?? ""
            let last = lastAvailable[position]
            let here = !heldOut(player) || last == nil ? [player] : []
            return here + (index == last ? waiting[position] ?? [] : [])
        }
    }
}
