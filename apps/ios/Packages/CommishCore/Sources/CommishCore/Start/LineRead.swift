import CommishAPI
import CommishDesign
import Foundation

/// A player's game this week as his line's `game_state` says it (Lane 176), read and never computed:
/// the field's state, a `not_started` read whose kickoff has passed at the screen's clock read as
/// kicked off (the one lag rule every client shares, kickoff.ts lineState with the field, so a saved
/// answer still turns at kickoff), a bye or no game as none.
///
/// A line without the field, or with a state this build does not know, is `unread`: it says the
/// field's word where it has one, and it never offers a move (the screen cannot vouch that its game
/// is still to come). The API serves the field on every in-season line, so a fixture line without it
/// is a fault the parity test names.
public enum GameRead: Equatable, Sendable {
    case upcoming
    case kickedOff
    case final
    /// A bye, or no game held for him this week (a free agent, a club with none).
    case noGame
    /// No field, or a state this build does not know: its word, when it sent one.
    case unread(String?)

    /// Past its kickoff, or not known to be still to come: no platform takes a move on him, and no
    /// screen offers one (kickoff.ts pastKickoff; an unread game is held).
    public var locked: Bool {
        switch self {
        case .kickedOff, .final, .unread: true
        case .upcoming, .noGame: false
        }
    }

    /// Still to be played at the screen's clock (kickoff.ts toPlay).
    public var toPlay: Bool {
        self == .upcoming
    }

    /// The state's name as the web's lineState returns it, nil with no game or none read.
    public var stateName: String? {
        switch self {
        case .upcoming: "upcoming"
        case .kickedOff: "kicked_off"
        case .final: "final"
        case .noGame, .unread: nil
        }
    }
}

enum LineRead {
    typealias Cell = Components.Schemas.GameStateCell

    /// The line's game at `now`, by its field.
    static func game(_ line: PlayerLine, now: Date) -> GameRead {
        guard let cell = line.gameState?.value1 else {
            return .unread(nil)
        }
        switch cell.state.value1 {
        case .final: return .final
        case .kickedOff: return .kickedOff
        case .notStarted:
            // A saved read turns at kickoff: the field's not_started is read by the clock.
            guard let kickoff = line.facts.kickoff, kickoff <= now else {
                return .upcoming
            }
            return .kickedOff
        case .bye, .noGame: return .noGame
        case nil: return .unread(cell.word.isEmpty ? nil : cell.word)
        }
    }

    /// kickoff.ts stateWord: the field's word where the field holds the state shown, the web's own
    /// word otherwise (a saved read the clock has moved past).
    static func word(_ line: PlayerLine, read: GameRead, own: String) -> String {
        let cell = line.gameState?.value1.state.value1
        switch (read, cell) {
        case (.final, .final?), (.kickedOff, .kickedOff?): return line.gameState?.value1.word ?? own
        default: return own
        }
    }

    /// Kicked off or final by its field (kickoff.ts pastKickoff over a line whose game is read).
    static func started(_ line: PlayerLine, now: Date) -> Bool {
        let read = game(line, now: now)
        return read == .kickedOff || read == .final
    }

    /// Any line's game past its kickoff (basis.ts anyKicked).
    static func anyKicked(_ lines: [PlayerLine], now: Date) -> Bool {
        lines.contains { started($0, now: now) }
    }

    /// kickoff.ts linesRead's state over a set of lines: final once every one with a game is, playing
    /// once any has kicked off, else upcoming.
    static func setState(_ lines: [PlayerLine], now: Date) -> GameRead {
        let held: [GameRead] = [.upcoming, .kickedOff, .final]
        let reads: [GameRead] = lines.filter { $0.facts.kickoff != nil }
            .map { game($0, now: now) }
            .filter { held.contains($0) }
        if !reads.isEmpty, reads.allSatisfy({ $0 == GameRead.final }) {
            return .final
        }
        return reads.contains { $0 != GameRead.upcoming } ? .kickedOff : .upcoming
    }
}
