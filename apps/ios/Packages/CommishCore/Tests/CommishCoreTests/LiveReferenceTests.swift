import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The live check for the reference screens, run by hand against a dev API serving the published run
/// (LIVE_API_URL, as http://localhost:18199): ADP, Compare with the run's two first players, the clubs,
/// a club and the schedule built through the app's client, then each read again from the same cache,
/// every file a 304. Skipped without the URL.
@MainActor
struct LiveReferenceTests {
    nonisolated static let api = ProcessInfo.processInfo.environment["LIVE_API_URL"].flatMap(URL.init(string:))

    @Test(.enabled(if: api != nil))
    func theLiveRunDrawsEveryReferenceScreenAndAnswers304s() async throws {
        let client = try APIClient(baseURL: #require(Self.api), tokens: LiveRunTests.NoToken())
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("live-reference-\(UUID().uuidString)"))
        let clock = SystemClock()
        let index = try await client.index(tag: nil)
        guard case let .fresh(entries, _) = index else {
            throw LiveError.noIndex
        }
        let slugs = entries.prefix(2).map(\.slug)
        let counted = Tally(client)
        var (firstAsked, firstUnchanged) = (0, 0)
        for pass in 1 ... 2 {
            let adp = try await Self.loaded(.adp(format: nil, run: counted, pages: counted, cache: cache, clock: clock))
            print(
                "pass \(pass) ADP \(adp.0.format): \(adp.0.rows.count) rows, first \(adp.0.rows.first?.row.name ?? "-")"
            )
            print("  " + adp.0.basis.joined(separator: " | "))
            let compare = try await Self.loaded(.compare(
                slugs: slugs, run: counted, pages: counted, cache: cache, clock: clock
            ))
            if case let .table(table) = compare.0.outcome {
                print("  compare: \(table.call). \(table.evidence)")
                print("  " + table.basis.joined(separator: " | "))
            }
            let clubs = try await Self.loaded(.clubs(run: counted, pages: counted, cache: cache, clock: clock))
            print("  clubs: \(clubs.0.clubs.count); \(clubs.0.lead)")
            let club = try await Self.loaded(.club("det", run: counted, pages: counted, cache: cache, clock: clock))
            print("  DET: \(club.0.rows.count) rows; \(club.0.scheduleCaption); \(club.0.hero?.caption ?? "-")")
            let schedule = try await Self.loaded(.schedule(run: counted, pages: counted, cache: cache, clock: clock))
            print("  schedule: \(schedule.0.grid.rows.count) clubs; \(schedule.0.grid.lead)")
            let (asked, unchanged) = await (counted.asked, counted.unchanged)
            print("  run files read \(asked), unchanged (304) \(unchanged)")
            if pass == 2 {
                // Every run file the second pass read named its kept ETag and came back unchanged.
                #expect(asked - firstAsked == unchanged - firstUnchanged)
                #expect(asked > firstAsked)
            }
            (firstAsked, firstUnchanged) = (asked, unchanged)
            #expect(!adp.0.rows.isEmpty)
            #expect(clubs.0.clubs.count == 32)
            #expect(schedule.0.grid.rows.count == 32)
            #expect([adp.1, compare.1, clubs.1, club.1, schedule.1].allSatisfy { $0.saved == nil })
        }
    }

    static func loaded<Model>(_ viewModel: RunScreenViewModel<Model>) async throws -> (Model, Freshness) {
        await viewModel.load()
        guard case let .loaded(model, freshness) = viewModel.state else {
            throw LiveError.notLoaded("\(viewModel.state)")
        }
        return (model, freshness)
    }

    enum LiveError: Error {
        case noIndex
        case notLoaded(String)
    }
}

/// The client's run and page routes, counting the reads asked and those that came back unchanged.
actor Tally: RunAPI, RunPagesAPI {
    let client: APIClient
    private(set) var asked = 0
    private(set) var unchanged = 0

    init(_ client: APIClient) {
        self.client = client
    }

    private func count<Value>(_ read: RunRead<Value>) -> RunRead<Value> {
        asked += 1
        if case .unchanged = read {
            unchanged += 1
        }
        return read
    }

    func manifest(tag: String?) async throws -> RunRead<RunManifest> {
        try await count(client.manifest(tag: tag))
    }

    func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer> {
        try await count(client.board(format: format, tag: tag))
    }

    func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]> {
        try await count(client.adpSources(tag: tag))
    }

    func designations(tag: String?) async throws -> RunRead<RunDesignations?> {
        try await count(client.designations(tag: tag))
    }

    func clubs(tag: String?) async throws -> RunRead<[RunClub]> {
        try await count(client.clubs(tag: tag))
    }

    func index(tag: String?) async throws -> RunRead<[RunIndexEntry]> {
        try await count(client.index(tag: tag))
    }

    func page(id: String, tag: String?) async throws -> RunRead<RunPlayerAnswer> {
        try await count(client.page(id: id, tag: tag))
    }

    func held(tag: String?) async throws -> RunRead<[RunHeldPage]?> {
        try await count(client.held(tag: tag))
    }

    func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        try await count(client.heldCopy(id: id, tag: tag))
    }

    func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        try await count(client.schedule(tag: tag))
    }
}
