import CommishAPI
import Foundation

/// The live-draft companion's recorded replay (shared/fixtures/companion, web/scripts/record-companion.ts):
/// the recorded Sleeper draft followed from slot 5, read at five moments as the web's page reads it
/// (the first with the board, each later one since the pick count before), the report on the finished
/// draft and the account's followed drafts, each the API's envelope as it answered.
public enum CompanionFixture {
    /// The moments, in the order they were read.
    public enum Moment: String, CaseIterable, Sendable {
        /// Picks 1 and 2 made, before the drafter's first turn at 1.05.
        case waiting
        /// 11 picks made, between turns, the call waiting on the board for 2.08.
        case between
        /// 19 picks made, the drafter on the clock at 2.08 with our call.
        case turn
        /// 22 picks made, the drafter's 2.08 on the strip, waiting on 3.05.
        case taken
        /// All 240 picks made.
        case complete
    }

    /// The followed draft's id in every answer.
    public static let id = "31d7ec59-4176-4180-b32d-e7689de4ac90"

    static let folder = RunFixture.fixtures.appendingPathComponent("companion")

    public static func data(_ file: String) throws -> Data {
        try Data(contentsOf: folder.appendingPathComponent(file))
    }

    public static func answer(_ moment: Moment) throws -> Companion {
        try APIDecoding.envelopeData(Companion.self, from: data("companion-\(moment.rawValue).json"))
    }

    public static func report() throws -> MockReport {
        try APIDecoding.envelopeData(MockReport.self, from: data("report.json"))
    }

    public static func recent() throws -> [CompanionSummary] {
        try APIDecoding.envelopeData([CompanionSummary].self, from: data("companions.json"))
    }
}

/// The companion's API over the recorded replay: each read answers the next moment (or the one asked
/// for), the report and the followed drafts as recorded; with `offline` every read fails with no
/// connection; a refusal throws the API's sentence. Counts the reads and their `since`.
public actor StubCompanion: CompanionAPI {
    public private(set) var reads: [Int] = []
    public private(set) var followed: [CompanionCreate] = []
    private var moments: [CompanionFixture.Moment]
    private var offline: Bool
    private let refusal: String?
    private let signedOut: Bool

    public init(
        moments: [CompanionFixture.Moment] = CompanionFixture.Moment.allCases, offline: Bool = false,
        refusal: String? = nil, signedOut: Bool = false
    ) {
        self.moments = moments
        self.offline = offline
        self.refusal = refusal
        self.signedOut = signedOut
    }

    /// From now on every read fails with no connection, or answers again.
    public func setOffline(_ offline: Bool) {
        self.offline = offline
    }

    public func recentCompanions() async throws -> [CompanionSummary] {
        try fail()
        return try CompanionFixture.recent()
    }

    public func followDraft(_ body: CompanionCreate) async throws -> Companion {
        try fail()
        followed.append(body)
        if let refusal {
            throw CompanionRefused(sentence: refusal)
        }
        return try CompanionFixture.answer(.waiting)
    }

    public func companion(id _: String, since: Int) async throws -> Companion {
        reads.append(since)
        try fail()
        let moment = moments.count > 1 ? moments.removeFirst() : moments[0]
        return try CompanionFixture.answer(moment)
    }

    public func companionReport(id _: String) async throws -> MockReport {
        try fail()
        return try CompanionFixture.report()
    }

    private func fail() throws {
        if signedOut {
            throw APIError.status(401)
        }
        if offline {
            throw URLError(.notConnectedToInternet)
        }
    }
}
