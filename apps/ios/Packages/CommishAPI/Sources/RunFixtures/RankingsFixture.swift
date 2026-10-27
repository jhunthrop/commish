import CommishAPI
import Foundation

/// The order's answers the fixture API gave with no league (shared/fixtures/inseason/order-*.json,
/// Lane 194), and the run's record and schedule as GET /run/record and /run/schedule answer them: the
/// contract run's own record (before Lane 114) and the record's fixtures with the weekly and draft
/// records (shared/fixtures/record), each with its ETag.
public enum RankingsFixture {
    /// The fixture clocks the order was read at, as the files name them.
    public static let week = "2026-10-17T17-00-00Z"
    public static let sunday = "2026-10-18T18-56-00Z"

    /// The order's answer for a read at a clock: `part` as the file names it ("", "-QB", "-q-wa").
    public static func order(_ part: String, at clock: String = week) throws -> OrderAdvice {
        try APIDecoding.envelopeData(OrderAdvice.self, from: data("inseason/order\(part)-\(clock).json"))
    }

    /// The kickers' or defenses' week at a clock.
    public static func weekOrder(_ position: String, at clock: String = week) throws -> WeekOrderAdvice {
        try APIDecoding.envelopeData(
            WeekOrderAdvice.self, from: data("inseason/order-week-\(position)-\(clock).json")
        )
    }

    /// The file part of a read: its position and its search, as export-fixtures.ts names it.
    public static func part(_ query: OrderQuery) -> String {
        let position = query.position.map { "-\($0.rawValue)" } ?? ""
        let search = query.search.map { "-q-\($0)" } ?? ""
        return position + search
    }

    static func data(_ path: String) throws -> Data {
        try Data(contentsOf: RunFixture.fixtures.appendingPathComponent(path))
    }
}

/// The run's record as GET /run/record answers it: the contract run's own, or a record fixture.
public enum RecordFixture: Sendable, Equatable {
    /// The contract run's record, before the weekly and draft records.
    case own
    /// shared/fixtures/record/<mode>.json: `waiting`, `upcoming`, `set`, `graded` or `published`.
    case twoRecords(String)

    var path: String {
        switch self {
        case .own: "run/runs/2026-10-21T12-ros/record.json"
        case let .twoRecords(mode): "record/\(mode).json"
        }
    }

    /// The ETag the API would give the file: its run and its name.
    public var tag: String {
        #"W/"2026-10-21T12-ros/\#(path)""#
    }

    public func answer() throws -> Data {
        let record = try JSONSerialization.jsonObject(with: RankingsFixture.data(path))
        return try JSONSerialization.data(withJSONObject: [
            "ok": true, "data": ["run_id": "2026-10-21T12-ros", "record": record], "error": NSNull(),
            "request_id": "fixture",
        ])
    }

    public func record() throws -> RunRecord {
        try APIDecoding.envelopeData(Components.Schemas.RunRecordAnswer.self, from: answer()).record
    }

    /// The contract run's schedule, which every fixture record's weeks are read by.
    public static let scheduleTag = #"W/"2026-10-21T12-ros/schedule.json""#

    public static func scheduleAnswer() throws -> Data {
        let schedule = try JSONSerialization.jsonObject(
            with: RankingsFixture.data("run/runs/2026-10-21T12-ros/schedule.json")
        )
        return try JSONSerialization.data(withJSONObject: [
            "ok": true, "data": ["run_id": "2026-10-21T12-ros", "schedule": schedule], "error": NSNull(),
            "request_id": "fixture",
        ])
    }

    public static func schedule() throws -> RunSchedule {
        try APIDecoding.envelopeData(Components.Schemas.RunScheduleAnswer.self, from: scheduleAnswer()).schedule
    }
}

/// The record's routes over a record fixture, as the API answers them: each file with its ETag,
/// unchanged (304) when the read names it, every read failing with no signal while `offline`.
public struct StubRecord: RecordAPI {
    public let fixture: RecordFixture
    public let offline: Bool

    public init(_ fixture: RecordFixture, offline: Bool = false) {
        self.fixture = fixture
        self.offline = offline
    }

    public func record(tag: String?) async throws -> RunRead<RunRecord> {
        try read(tag: tag, current: fixture.tag) { try fixture.record() }
    }

    public func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        try read(tag: tag, current: RecordFixture.scheduleTag) { try RecordFixture.schedule() }
    }

    private func read<Value: Sendable>(
        tag: String?, current: String, _ value: () throws -> Value
    ) throws -> RunRead<Value> {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        return tag == current ? .unchanged(tag: current) : try .fresh(value(), tag: current)
    }
}

/// The order's routes over the fixture's answers at a clock: each read answered by the file its query
/// names, every read failing with no signal while `offline`.
public struct StubRankings: RankingsAPI {
    public let clock: String
    public let offline: Bool

    public init(clock: String = RankingsFixture.week, offline: Bool = false) {
        self.clock = clock
        self.offline = offline
    }

    public func order(_ query: OrderQuery) async throws -> OrderAdvice {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        return try RankingsFixture.order(RankingsFixture.part(query), at: clock)
    }

    public func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        return try RankingsFixture.weekOrder(position.rawValue, at: clock)
    }
}
