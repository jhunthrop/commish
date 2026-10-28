import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The Board at the order's clock says what its status column is as of and never drops a run player
/// silently (Lane 280, B257): the newer of the run's capture and the order's names the statuses, an
/// answer without the field parses and keeps the run's; a player an uncut order omits is drawn from the
/// run after the order's rows and counted once, and a cut answer keeps its reach line alone.
@MainActor
struct OneValueFromRunTests {
    typealias Reads = OneValueReads

    /// The run's capture at the Sunday clock: listed Oct 13, never checked.
    static let runCapture = "Status as of Oct 13, over 36 hours ago."

    func board(_ answer: OrderAdvice) throws -> BoardModel {
        try Reads.board(order: OrderAtClock(answer: answer, landed: Reads.now))
    }

    static func read(asOf: String, checkedAt: String) throws -> Components.Schemas.OrderAdvice.StatusReadPayload {
        try .init(value1: .init(
            asOf: #require(APIDecoding.parseDate(asOf)),
            checkedAt: APIDecoding.parseDate(checkedAt),
            source: "feed"
        ))
    }

    @Test func theStatusColumnIsDatedByTheNewerOfTheRunsCaptureAndTheOrders() throws {
        let whole = try Reads.order()
        #expect(whole.capture == nil, "an answer without status_read parses and names no capture")
        #expect(try board(whole.answer).basis.contains(Self.runCapture), "the run's alone")
        var newer = whole.answer
        newer.statusRead = try Self.read(asOf: "2026-10-18T15:00:00Z", checkedAt: "2026-10-18T18:00:00Z")
        let live = try board(newer)
        #expect(live.basis.contains("Status read Oct 18."), "\(live.basis)")
        #expect(!live.basis.contains(Self.runCapture))
        var older = whole.answer
        older.statusRead = try Self.read(asOf: "2026-10-12T15:00:00Z", checkedAt: "2026-10-13T15:00:00Z")
        #expect(try board(older).basis.contains(Self.runCapture))
        #expect(try Reads.board(order: nil).basis.contains(Self.runCapture), "unread, the run's stands")
    }

    @Test func aPlayerAnUncutOrderOmitsIsDrawnFromTheRunAndCountedOnce() throws {
        let swift = try #require(Reads.parity.players.first)
        var answer = try Reads.order().answer
        answer.rows = answer.rows.filter { $0.line.player.boardId != swift.id }
        answer.total = answer.rows.count
        #expect(!LiveOrder.cut(answer))
        let model = try board(answer)
        #expect(model.atClock)
        #expect(model.rows.map(\.id) == Reads.parity.board.ids.filter { $0 != swift.id } + [swift.id])
        #expect(model.rows.last?.projected == Words.Box.none, "no figure of either clock")
        #expect(model.basis.last == LiveOrderWords.fromRun(1))
        #expect(try !board(Reads.order().answer).basis.contains { $0.contains(Words.LiveOrder.fromRun) })
    }

    @Test func aCutAnswerKeepsItsReachAndCountsNoneFromTheRun() throws {
        var answer = try Reads.order().answer
        answer.rows = Array(answer.rows.prefix(40))
        #expect(LiveOrder.cut(answer))
        let model = try board(answer)
        #expect(model.basis.last?.hasPrefix("The first") == true)
        #expect(!model.basis.contains { $0.contains(Words.LiveOrder.fromRun) })
    }
}
