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
        let counted = Counted(client)
        for pass in 1 ... 2 {
            let adp = try await Self.loaded(.adp(format: nil, run: counted, pages: client, cache: cache, clock: clock))
            print(
                "pass \(pass) ADP \(adp.0.format): \(adp.0.rows.count) rows, first \(adp.0.rows.first?.row.name ?? "-")"
            )
            print("  " + adp.0.basis.joined(separator: " | "))
            let compare = try await Self.loaded(.compare(
                slugs: slugs, run: counted, pages: client, cache: cache, clock: clock
            ))
            if case let .table(table) = compare.0.outcome {
                print("  compare: \(table.call). \(table.evidence)")
                print("  " + table.basis.joined(separator: " | "))
            }
            let clubs = try await Self.loaded(.clubs(run: counted, pages: client, cache: cache, clock: clock))
            print("  clubs: \(clubs.0.clubs.count); \(clubs.0.lead)")
            let club = try await Self.loaded(.club("det", run: counted, pages: client, cache: cache, clock: clock))
            print("  DET: \(club.0.rows.count) rows; \(club.0.scheduleCaption); \(club.0.hero?.caption ?? "-")")
            let schedule = try await Self.loaded(.schedule(run: counted, pages: client, cache: cache, clock: clock))
            print("  schedule: \(schedule.0.grid.rows.count) clubs; \(schedule.0.grid.lead)")
            await print("  run files unchanged (304) so far: \(counted.unchanged)")
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
