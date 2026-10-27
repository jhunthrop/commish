import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The live check for one clock (Lane 224), run by hand against a dev API serving the published run
/// (LIVE_API_URL, as http://localhost:18224): the Board in season, a club, the clubs index and Compare
/// over the run's two first pages, each through the app's client with the order's reader. Where the API
/// answers the order, each screen draws its figures and the order's lead; where it cannot (a lane
/// database holds no board, /order answers 500), each keeps the run's rows with the run's stamp.
/// Skipped without the URL.
@MainActor
struct LiveOneValueTests {
    nonisolated static let api = ProcessInfo.processInfo.environment["LIVE_API_URL"].flatMap(URL.init(string:))

    @Test(.enabled(if: api != nil))
    func theLiveRunsScreensSayWhichClockTheyAreOn() async throws {
        let client = try APIClient(baseURL: #require(Self.api), tokens: LiveRunTests.NoToken())
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("live-one-value-\(UUID().uuidString)"))
        let clock = SystemClock()
        let orders = OrderReader(api: client, clock: clock, memo: OrderMemo())
        let order = await (try? orders.read()).map { "answered, \($0.answer.rows.count) rows" } ?? "unread"
        print("order: \(order)")
        let board = BoardViewModel(
            api: client, cache: cache, clock: clock, inSeason: true, following: false, orders: orders
        )
        await board.load()
        guard case let .loaded(model, _, _) = board.state else {
            throw LiveReferenceTests.LiveError.notLoaded("\(board.state)")
        }
        print("board: \(model.rows.count) rows, at the order's clock \(model.atClock)")
        print("  " + model.basis.joined(separator: " | "))
        let club = try await LiveReferenceTests.loaded(.club(
            "det", run: client, pages: client, cache: cache, clock: clock, orders: orders
        ))
        print("DET: \(club.0.rows.count) rows, at the order's clock \(club.0.atClock)")
        print("  " + club.0.basis.joined(separator: " | "))
        let clubs = try await LiveReferenceTests.loaded(.clubs(
            run: client, pages: client, cache: cache, clock: clock, orders: orders
        ))
        print("clubs: at the order's clock \(clubs.0.atClock); " + clubs.0.basis.joined(separator: " | "))
        let index = try await client.index(tag: nil)
        guard case let .fresh(entries, _) = index else {
            throw LiveReferenceTests.LiveError.noIndex
        }
        let compare = try await LiveReferenceTests.loaded(.compare(
            slugs: entries.prefix(2).map(\.slug), run: client, pages: client, cache: cache, clock: clock,
            orders: orders
        ))
        if case let .table(table) = compare.0.outcome {
            print("compare: at the order's clock \(compare.0.atClock). \(table.evidence)")
            print("  " + table.basis.joined(separator: " | "))
        }
        #expect(model.atClock == (order != "unread"))
        #expect(!model.rows.isEmpty)
    }
}
