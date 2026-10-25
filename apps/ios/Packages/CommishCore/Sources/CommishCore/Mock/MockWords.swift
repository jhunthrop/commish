import CommishAPI
import CommishDesign
import Foundation

/// A cell of a fact strip (web/src/lib/ui/facts.ts FactCell): its label, its value, and whether the
/// value is a word, drawn in the words' face, rather than a figure.
public struct MockCell: Equatable, Sendable, Identifiable {
    public let label: String
    public let value: String
    public let word: Bool

    public var id: String {
        label
    }
}

/// Whose draft the room is told for: the drafter's own, or one read through its link.
public enum Whose: String, Equatable, Sendable {
    case your
    case their
}

/// The solo mock's words that carry a figure or a name (web/src/lib/room/mock-words.ts, words.ts,
/// call.ts and setup/setup.ts), ported and held to shared/fixtures/parity/mock.json; the plain words
/// are the generated `Words.Mock`, `Words.MockSetup` and `Words.MockClocks`.
public enum MockWords {
    /// mock-words.ts pickHead: "Pick 5.08".
    public static func pickHead(_ pick: Int, teams: Int) -> String {
        "Pick \(DraftFormat.pickLabel(pick, teams: teams))"
    }

    /// mock-words.ts autopickWords: "Pick for me to round 8".
    public static func autopick(_ round: Int) -> String {
        "Pick for me to round \(round)"
    }

    /// mock-words.ts draftNamed: "Draft Williams".
    public static func draftNamed(_ name: String) -> String {
        "\(Words.Mock.draft) \(DraftFormat.lastName(name))"
    }

    /// mock-words.ts readingWords: "Reading the room for 2.12".
    public static func reading(_ pick: Int, teams: Int) -> String {
        "Reading the room for \(DraftFormat.pickLabel(pick, teams: teams))"
    }

    /// mock-words.ts chanceLabel: "still there at 6.05", or "your last pick".
    public static func chanceLabel(_ next: Int?, teams: Int) -> String {
        next.map { "still there at \(DraftFormat.pickLabel($0, teams: teams))" } ?? Words.Mock.lastPick
    }

    /// mock-words.ts undoneWords: the pick the undo went back to, who is back in the pool, and that the
    /// room branched.
    public static func undone(_ pick: Int, teams: Int, name: String?) -> String {
        let back = name.map { " \($0) is in the pool again." } ?? ""
        return "Back to \(DraftFormat.pickLabel(pick, teams: teams)).\(back) Same bots, same seed, so the room "
            + "drafts the same until your pick goes another way."
    }

    /// mock-words.ts runAgainWords: "Run it again from slot 5".
    public static func runAgain(_ slot: Int) -> String {
        "Run it again from slot \(slot)"
    }

    /// mock-words.ts runSharedWords: "Run this draft from slot 5".
    public static func runShared(_ slot: Int) -> String {
        "Run this draft from slot \(slot)"
    }

    /// mock-words.ts sharedTitle: "jh's mock from slot 5", "A shared mock from slot 5".
    public static func sharedTitle(by: String?, slot: Int) -> String {
        "\(by.map { "\($0)'s mock" } ?? "A shared mock") from slot \(slot)"
    }

    /// mock-words.ts sharedAt: "finished", "at pick 5.08".
    public static func sharedAt(complete: Bool, pick: Int, teams: Int) -> String {
        complete ? "finished" : "at pick \(DraftFormat.pickLabel(pick, teams: teams))"
    }

    /// call.ts draftWords: "Draft him", or "Draft them" for a defense.
    public static func draftWords(_ position: String) -> String {
        "\(Words.Mock.draft) \(position == "DST" ? "them" : "him")"
    }

    /// words.ts formatLine: "12 teams · PPR · superflex".
    public static func formatLine(_ settings: RoomSettings) -> String {
        (["\(settings.teams) teams", RoomWords.scoring(settings)] + (RoomWords.lineup(settings).map { [$0] } ?? []))
            .joined(separator: " · ")
    }

    /// words.ts pickBarCells: the round, the league, your slot, and while you have one, your next pick
    /// and how many picks away it is.
    public static func barCells(_ settings: RoomSettings, slot: Int, now: Int, round: Int, next: Int?) -> [MockCell] {
        var cells = [
            MockCell(label: "Round", value: String(round), word: false),
            MockCell(label: "Teams", value: String(settings.teams), word: false),
            MockCell(label: "Scoring", value: RoomWords.scoring(settings), word: true),
        ]
        if let lineup = RoomWords.lineup(settings) {
            cells.append(MockCell(label: "Lineup", value: lineup, word: true))
        }
        cells.append(MockCell(label: "Slot", value: String(slot), word: false))
        if let next {
            cells.append(MockCell(
                label: "Your next", value: DraftFormat.pickLabel(next, teams: settings.teams), word: false
            ))
            cells.append(MockCell(label: "Picks away", value: String(max(0, next - now - 1)), word: false))
        }
        return cells
    }

    /// setup.ts LOBBY_FILL_SECONDS and setupCells without a lobby read: the clock against bots and when
    /// a lobby starts (the solo setup reads no lobby).
    static let lobbyFillSeconds = 90

    public static func setupCells() -> [MockCell] {
        [
            MockCell(label: Words.MockClocks.botClock, value: Words.MockClocks.none, word: true),
            MockCell(
                label: Words.MockClocks.lobbyStarts,
                value: "Full, or \(lobbyFillSeconds) s after the first join", word: true
            ),
        ]
    }

    /// words.ts botNames: a solo room's seats, you and the bots by seat; a shared draft's drafter by
    /// handle in his seat.
    public static func seatNames(teams: Int, slot: Int, sharedBy: String?? = nil) -> [String] {
        (1 ... max(teams, 1)).map { seat in
            guard seat == slot else {
                return "Bot \(seat)"
            }
            if let sharedBy {
                return sharedBy ?? Words.Mock.drafter
            }
            return "You"
        }
    }

    /// call.ts poolBasis: the board's basis, then where the chances come from, or that no call is coming.
    public static func poolBasis(_ board: RoomBoardView, card: RoomCard?, teams: Int, callMissing: Bool) -> String {
        guard card != nil || !callMissing else {
            return "\(board.basis) No call for this pick."
        }
        return RoomWords.poolBasis(board, card: card, teams: teams)
    }

    /// words.ts sinceLead: "went since your pick at 2.08", "went before their first pick".
    public static func sinceLead(_ since: Int?, teams: Int, whose: Whose) -> String {
        guard let since else {
            return "went before \(whose.rawValue) first pick"
        }
        return "went since \(whose.rawValue) pick at \(DraftFormat.pickLabel(since, teams: teams))"
    }

    /// words.ts sinceQueued: "none from your queue", "2 from your queue".
    public static func sinceQueued(_ fromQueue: Int, whose: Whose) -> String {
        "\(fromQueue == 0 ? "none" : String(fromQueue)) from \(whose.rawValue) queue"
    }

    /// words.ts straightBack: no pick landed between two turns.
    public static func straightBack(_ whose: Whose) -> String {
        "\(whose == .your ? "Your" : "Their") turn came straight back"
    }

    /// words.ts poolEmpty with no search: the pool's line when the chip leaves nobody.
    public static func poolEmpty(filter: String) -> String {
        if filter == Words.Mock.queue {
            return "Nobody in your queue. Mark a player and press Q to add him."
        }
        return RoomWords.poolEmpty(filter: filter)
    }
}
