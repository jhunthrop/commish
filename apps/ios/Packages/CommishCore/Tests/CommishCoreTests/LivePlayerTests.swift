import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The live check for the player sheet and page, run by hand against a dev API serving the published
/// run (LIVE_API_URL, as http://localhost:18192): a player's sheet and page read once through the app's
/// client with no league (his public week), then read again from the same cache, every run file a 304
/// to its kept ETag. LIVE_PLAYER_SLUG names him (jahmyr-gibbs by default). Skipped without the URL.
@MainActor
struct LivePlayerTests {
    nonisolated static let api = ProcessInfo.processInfo.environment["LIVE_API_URL"].flatMap(URL.init(string:))
    static let slug = ProcessInfo.processInfo.environment["LIVE_PLAYER_SLUG"] ?? "jahmyr-gibbs"

    @Test(.enabled(if: api != nil))
    func theLiveRunsPageAndWeekDrawTheSheetAndThePageThenAnswer304s() async throws {
        let client = try APIClient(baseURL: #require(Self.api), tokens: LiveRunTests.NoToken())
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("live-player-\(UUID().uuidString)"))
        let player = SheetPlayer(id: Self.slug, slug: Self.slug, name: Self.slug, position: nil, rank: nil, club: nil)
        let sheet = PlayerSheetViewModel(
            player: player, run: client, pages: client, weeks: client, cache: cache, clock: SystemClock(), league: nil
        )
        await sheet.load()
        // His week reads the API's own store: a lane database holds no board or games, so a dev API on
        // one answers no week and the sheet says so; against a store with them the card draws.
        if case let .loaded(card, _) = sheet.state {
            print("sheet: \(card.head.label) \(card.head.opponent) \(card.game)")
            print("  tiles: " + card.tiles.map { "\($0.label) \($0.value)" }.joined(separator: " | "))
            print("  read: \(String(describing: card.read))")
        } else {
            print("sheet: \(sheet.state)")
        }
        let page = PlayerPageViewModel(
            slug: Self.slug, run: client, pages: client, weeks: client, cache: cache, clock: SystemClock(), league: nil
        )
        await page.load()
        guard case let .loaded(model, _) = page.state else {
            Issue.record("the page: \(page.state)")
            return
        }
        print("page: \(model.hero.name), \(model.hero.club), \(model.hero.pill), \(model.stamp)")
        print("  \(model.figure) \(model.unit): \(model.caption)")
        print("  \(model.drafters.label) \(model.drafters.figure): \(model.drafters.words)")
        print("  \(model.overReplacement.figure): \(model.overReplacement.words)")
        print("  read: \(String(describing: model.read))")
        let counted = CountedPages(client)
        let again = PlayerPageViewModel(
            slug: Self.slug, run: client, pages: counted, weeks: client, cache: cache, clock: SystemClock(), league: nil
        )
        await again.load()
        #expect(await counted.fresh == 0, "every page file a 304 to its kept ETag")
        await print("again: \(counted.unchanged) unchanged")
    }
}

/// The page routes, counting the reads that came back unchanged and those read afresh.
actor CountedPages: RunPagesAPI {
    let pages: any RunPagesAPI
    private(set) var unchanged = 0
    private(set) var fresh = 0

    init(_ pages: any RunPagesAPI) {
        self.pages = pages
    }

    func index(tag: String?) async throws -> RunRead<[RunIndexEntry]> {
        try await count(pages.index(tag: tag))
    }

    func page(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        try await count(pages.page(id: id, tag: tag))
    }

    func held(tag: String?) async throws -> RunRead<[RunHeldPage]?> {
        try await count(pages.held(tag: tag))
    }

    func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        try await count(pages.heldCopy(id: id, tag: tag))
    }

    func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        try await count(pages.schedule(tag: tag))
    }

    private func count<Value>(_ read: RunRead<Value>) -> RunRead<Value> {
        if case .unchanged = read {
            unchanged += 1
        } else {
            fresh += 1
        }
        return read
    }
}
