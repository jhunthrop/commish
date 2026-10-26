import CommishDesign
import Foundation

/// One cell of the wall (Wall.svelte): the pick, who it took, or, on the clock, whose pick it is.
public struct WallCell: Equatable, Sendable, Identifiable {
    /// The overall pick.
    public let id: Int
    public let seat: Int
    public let player: RoomPlayer?
    /// His last name, as the cell prints it.
    public let name: String?
    /// "WR · DAL" over the name.
    public let line: String?
    /// A pick the drafter made, on the accent's wash.
    public let mine: Bool
    /// On the clock: whose pick it is, with the pick under it.
    public let now: WallClock?
}

/// The wall's cell on the clock: "Your pick" or "On the clock", and "2.08".
public struct WallClock: Equatable, Sendable {
    public let words: String
    public let pick: String
}

/// The wall (Wall.svelte): each seat's name across the top, the drafter's in the accent, then each
/// round through the one on the clock, seat by seat.
public struct RoomWall: Equatable, Sendable {
    public let title: String
    /// "rounds 1 to 3 of 20".
    public let label: String
    public let names: [String]
    /// The drafter's seat, 1-based.
    public let you: Int
    public let rows: [[WallCell]]

    /// model.ts wallRows through `shown` rounds of `rounds`; `now` is the pick on the clock, nil once
    /// the draft is over; `shared` for a reader of someone else's draft (Wall.svelte's whose), whose
    /// drafter's turn reads "Their pick".
    public init(
        picks: [PlacedPick], board: RoomBoardView, names: [String], you: Int, teams: Int, rounds: Int, shown: Int,
        now: Int?, shared: Bool = false
    ) {
        let byPick = Dictionary(picks.map { ($0.pick, $0.playerID) }, uniquingKeysWith: { first, _ in first })
        title = Words.Room.wall
        self.names = names
        self.you = you
        rows = (0 ..< max(shown, 0)).map { index in
            (1 ... max(teams, 1)).map { seat in
                let pick = index % 2 == 0 ? index * teams + seat : index * teams + (teams - seat + 1)
                let player = byPick[pick].flatMap { board.byID[$0] }
                let onClock = player == nil && pick == now
                return WallCell(
                    id: pick, seat: seat, player: player, name: player.map { DraftFormat.lastName($0.name) },
                    line: player.map { "\($0.position) · \($0.team)" }, mine: player != nil && seat == you,
                    now: onClock ? WallClock(
                        words: seat == you ? (shared ? Words.Room.theirPick : Words.Room.yourPick) : Words.Room
                            .onTheClock,
                        pick: DraftFormat.pickLabel(pick, teams: teams)
                    ) : nil
                )
            }
        }
        label = RoomWords.wallRounds(rows.count, of: rounds)
    }
}
