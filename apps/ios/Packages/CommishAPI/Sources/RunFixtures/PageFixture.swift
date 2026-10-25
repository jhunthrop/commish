import CommishAPI
import Foundation

/// The fixture runs' player pages and schedule as the API's page routes answer them (Lane 188's
/// /run/players/{id}, /run/held, /run/held/{id}, /run/index and /run/schedule), and the fixture
/// league's player weeks (shared/fixtures/inseason), for the player sheet's and page's tests.
public extension RunFixture {
    func pageAnswer(id: String) throws -> Data {
        try Self.envelope(["run_id": runID, "player": file("players/\(id).json")])
    }

    func page(id: String) throws -> RunPlayer {
        try APIDecoding.envelopeData(Components.Schemas.RunPlayerAnswer.self, from: pageAnswer(id: id)).player
    }

    func scheduleAnswer() throws -> Data {
        try Self.envelope(["run_id": runID, "schedule": file("schedule.json")])
    }

    func schedule() throws -> RunSchedule {
        try APIDecoding.envelopeData(Components.Schemas.RunScheduleAnswer.self, from: scheduleAnswer()).schedule
    }

    /// The pages the folder holds, each as the run's index names him (the index's own fields).
    func indexEntries() throws -> [RunIndexEntry] {
        let folder = try Self.fixtures.appendingPathComponent(folder).appendingPathComponent("runs/\(runID)/players")
        let files = try FileManager.default.contentsOfDirectory(atPath: folder.path).filter { $0.hasSuffix(".json") }
        return try files.sorted().map { name in
            let page = try self.page(id: String(name.dropLast(".json".count)))
            return RunIndexEntry(
                id: page.id, slug: page.slug, name: page.name, team: page.team, position: page.position,
                headshot: page.headshot,
                season: .init(games: page.season.games, pointsPerGame: page.season.pointsPerGame)
            )
        }
    }

    private func file(_ path: String) throws -> Any {
        let url = try Self.fixtures.appendingPathComponent(folder).appendingPathComponent("runs/\(runID)/\(path)")
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url))
    }

    static func envelope(_ data: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "ok": true, "data": data, "error": NSNull(), "request_id": "fixture",
        ])
    }
}

/// The fixture league's player weeks (export-fixtures.ts): his week in the league, the verb with it,
/// at the sheet's clocks, and with no league at the week's.
public enum WeekFixture {
    /// The fixture league (web/scripts/inseason-fixture/ids.ts).
    public static let league = "6f1d1c52-2626-4a26-9a26-000000000026"

    static let inseason = RunFixture.fixtures.appendingPathComponent("inseason")

    /// His week in the league at a clock, as its file names it (`2026-10-18T18-56-00Z`).
    public static func league(_ player: String, at clock: String) throws -> PlayerWeek {
        try read("player-\(league)-\(player)-\(clock).json")
    }

    /// His week with no league at a clock.
    public static func publicWeek(_ player: String, at clock: String) throws -> PlayerWeek {
        try read("player-\(player)-\(clock).json")
    }

    private static func read(_ name: String) throws -> PlayerWeek {
        try APIDecoding.envelopeData(PlayerWeek.self, from: Data(contentsOf: inseason.appendingPathComponent(name)))
    }
}

/// The page routes over a fixture run, as the API answers them: each file with its ETag, unchanged
/// (304) when the read names that ETag; a page the run lacks, or one it holds, refused as the API
/// refuses it; and every read failing with no signal while `offline`.
public struct StubPages: RunPagesAPI {
    public let fixture: RunFixture
    /// The pages the run holds, with an earlier run's copy where one stands in (`copy`: the run whose
    /// page it is, nil for none).
    public let heldPages: [String: RunFixture?]
    public let offline: Bool

    public init(_ fixture: RunFixture, held: [String: RunFixture?] = [:], offline: Bool = false) {
        self.fixture = fixture
        heldPages = held
        self.offline = offline
    }

    public func index(tag: String?) async throws -> RunRead<[RunIndexEntry]> {
        try read("index.json", tag: tag) { try fixture.indexEntries() }
    }

    public func page(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        guard heldPages[id] == nil else {
            throw APIError.envelope(code: "not_found", message: "The run held this page: read /run/held.")
        }
        return try read("players/\(id).json", tag: tag) { try fixture.page(id: id) }
    }

    public func held(tag: String?) async throws -> RunRead<[RunHeldPage]?> {
        try read("held.json", tag: tag) {
            heldPages.isEmpty ? nil : try heldPages.keys.sorted().map { id in
                let copy = try heldPages[id]?.map { run in
                    try RunHeldCopy(runId: run.runID, runAt: run.manifest().runAt)
                }
                return RunHeldPage(id: id, copy: copy.map { .init(value1: $0) })
            }
        }
    }

    public func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        guard let held = heldPages[id], let copy = held else {
            throw APIError.envelope(code: "not_found", message: "No copy stands in for this page.")
        }
        return try read("held/\(id).json", tag: tag) { try copy.page(id: id) }
    }

    public func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        try read("schedule.json", tag: tag) { try fixture.schedule() }
    }

    private func read<Value: Sendable>(
        _ file: String, tag: String?, _ value: () throws -> Value
    ) throws -> RunRead<Value> {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        let current = try fixture.tag(file)
        return tag == current ? .unchanged(tag: current) : try .fresh(value(), tag: current)
    }
}
