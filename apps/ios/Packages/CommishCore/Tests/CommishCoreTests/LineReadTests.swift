import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// A line's game read from the API's field, never computed (spec §5.1): the field's state, a saved
/// not_started turning at kickoff, a bye as no game, and a line without the field or with a state this
/// build does not know held, so it never offers a move.
struct LineReadTests {
    static func line(_ state: String?, word: String = "", kickoff: String = "2026-10-18T17:00:00Z") throws
        -> PlayerLine {
        var line = try Fixtures.lineup(Fixtures.week).slots[0].ours
        line.facts.kickoff = APIDecoding.parseDate(kickoff)
        line.gameState = state.map {
            .init(value1: .init(state: .init(value1: .init(rawValue: $0), value2: $0), word: word))
        }
        return line
    }

    static let before = APIDecoding.parseDate("2026-10-18T16:59:00Z")!
    static let after = APIDecoding.parseDate("2026-10-18T17:00:00Z")!

    @Test func theFieldsStateIsRead() throws {
        #expect(try LineRead.game(Self.line("kicked_off", word: "Kicked off"), now: Self.before) == .kickedOff)
        #expect(try LineRead.game(Self.line("final", word: "Final"), now: Self.before) == .final)
        #expect(try LineRead.game(Self.line("bye", word: "Bye"), now: Self.before) == .noGame)
        #expect(try LineRead.game(Self.line("no_game"), now: Self.before) == .noGame)
    }

    @Test func aSavedNotStartedTurnsAtItsKickoff() throws {
        let line = try Self.line("not_started", word: "Next kickoff")
        #expect(LineRead.game(line, now: Self.before) == .upcoming)
        #expect(LineRead.game(line, now: Self.after) == .kickedOff)
        #expect(LineRead.word(line, read: .kickedOff, own: "Kicked off") == "Kicked off")
    }

    @Test func aLineWithoutTheFieldIsHeldAndNeverOffersAMove() throws {
        let read = try LineRead.game(Self.line(nil), now: Self.before)
        #expect(read == .unread(nil))
        #expect(read.locked)
        #expect(read.toPlay == false)
    }

    @Test func aStateThisBuildDoesNotKnowSaysItsWordAndIsHeld() throws {
        let line = try Self.line("suspended_for_weather", word: "Delayed")
        let read = LineRead.game(line, now: Self.before)
        #expect(read == .unread("Delayed"))
        #expect(read.locked)
        let row = StartRows.row(line, slot: "QB", zone: Fixtures.zone, now: Self.before)
        #expect(row.game == .game(where: "vs LAC", when: "Delayed"))
    }
}
