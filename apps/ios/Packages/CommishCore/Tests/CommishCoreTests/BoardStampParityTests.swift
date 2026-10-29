import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The Board's status stamp and its count of the run's players at the order's clock held to the web's
/// (Lane 280, B257, shared/fixtures/parity/board-run.json's liveStamps and fromRun): the newer of the
/// run's capture and the live order's names the status column, and the players an uncut order omits are
/// counted once, none on a cut answer.
struct BoardStampParityTests {
    struct Stamp: Decodable {
        let readAt: String
        let checkedAt: String?
    }

    struct StampCase: Decodable {
        let name: String
        let now: String
        let run: Stamp
        let live: Stamp?
        let chosen: String
        let text: String
    }

    struct FromRunCase: Decodable {
        let name: String
        let runIds: [String]
        let answerIds: [String]
        let total: Int
        let omitted: [String]
        let line: String?
    }

    struct Parity: Decodable {
        let zone: String
        let liveStamps: [StampCase]
        let fromRun: [FromRunCase]
    }

    static let parity: Parity = BoardParityTests.decoded("fixtures/parity/board-run.json")

    static func stamp(_ stamp: Stamp) throws -> CaptureStamp {
        try CaptureStamp(
            asOf: #require(APIDecoding.parseDate(stamp.readAt)),
            checkedAt: stamp.checkedAt.flatMap(APIDecoding.parseDate)
        )
    }

    @Test func theStatusColumnsStampIsTheNewerCaptureAsTheWebsIs() throws {
        let zone = try #require(TimeZone(identifier: Self.parity.zone))
        #expect(Self.parity.liveStamps.map(\.name) == [
            "run-only",
            "live-newer",
            "live-newer-unchecked",
            "live-newer-earlier-day",
            "live-older",
        ])
        for item in Self.parity.liveStamps {
            let run = try Self.stamp(item.run)
            let live = try item.live.map(Self.stamp)
            let chosen = try #require(CaptureStamp.newer(run: run, live: live))
            #expect((live != nil && chosen == live && chosen != run ? "live" : "run") == item.chosen, "\(item.name)")
            let now = try #require(APIDecoding.parseDate(item.now))
            #expect(BoardWords.capture(chosen, now: now, zone: zone) == item.text, "\(item.name)")
        }
    }

    @Test func theRunsPlayersAnUncutOrderOmitsAreCountedAsTheWebCountsThem() {
        for item in Self.parity.fromRun {
            let omitted = LiveOrder.omittedFromRun(
                item.runIds, returned: Set(item.answerIds), cut: item.total > item.answerIds.count
            )
            #expect(omitted == item.omitted, "\(item.name)")
            #expect(LiveOrderWords.fromRun(omitted.count) == item.line, "\(item.name)")
        }
    }
}
