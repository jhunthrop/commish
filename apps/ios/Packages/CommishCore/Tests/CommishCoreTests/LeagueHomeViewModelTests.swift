import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The League home's view model: the cache first, then the API; an app opened with no network shows
/// the last League home with its stamp, never a blank screen (plan Review Focus 2).
@MainActor
struct LeagueHomeViewModelTests {
    private let clock = FixedClock(Fixtures.instant(Fixtures.sunday))
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-core-tests-\(UUID().uuidString)")

    @Test func aFreshReadLoadsAndIsCachedWithItsStamp() async throws {
        let cache = FileCache(folder: folder)
        let model = try LeagueHomeViewModel(api: FixtureAPI(), cache: cache, clock: clock, zone: Fixtures.zone)
        await model.load(leagueID: Fixtures.league)
        guard case let .loaded(home, stamp, stale) = model.state else {
            Issue.record("Expected loaded, got \(model.state)")
            return
        }
        #expect(stale == false)
        #expect(stamp == clock.now)
        #expect(home.leagueName == "S.U.C.K. - Severely Underrated Carolina Keepers")
        let cached = await cache.read(LeagueHomeAnswer.self, route: LeagueHomeViewModel.route(Fixtures.league))
        #expect(cached?.stamp == clock.now)
    }

    @Test func aFailingTransportWithAWarmCacheShowsTheLastHomeStale() async throws {
        let cache = FileCache(folder: folder)
        let earlier = Fixtures.instant(Fixtures.week)
        let answer = try LeagueHomeAnswer(sync: Fixtures.sync(), scoreboard: Fixtures.scoreboard(Fixtures.week))
        await cache.write(answer, route: LeagueHomeViewModel.route(Fixtures.league), stamp: earlier)
        let model = LeagueHomeViewModel(api: FailingAPI(), cache: cache, clock: clock, zone: Fixtures.zone)
        await model.load(leagueID: Fixtures.league)
        guard case let .loaded(home, stamp, stale) = model.state else {
            Issue.record("Expected loaded, got \(model.state)")
            return
        }
        #expect(stale == true)
        #expect(stamp == earlier)
        #expect(home.standings.rows.count == 12)
        #expect(model.stampWords == "Last read Sat 12:00 pm")
    }

    @Test func aFailingTransportWithAColdCacheSaysWhyInWords() async {
        let model = LeagueHomeViewModel(
            api: FailingAPI(), cache: FileCache(folder: folder), clock: clock, zone: Fixtures.zone
        )
        await model.load(leagueID: Fixtures.league)
        guard case let .failed(sentence) = model.state else {
            Issue.record("Expected failed, got \(model.state)")
            return
        }
        #expect(sentence == AppWords.Failure.offline)
        #expect(sentence.contains("URLError") == false)
    }

    @Test func theAPIsOwnSentenceIsShownWhenItRefuses() async {
        let refused = APIError.envelope(code: "not_found", message: "We do not follow that league.")
        let model = LeagueHomeViewModel(
            api: FailingAPI(error: refused), cache: FileCache(folder: folder), clock: clock, zone: Fixtures.zone
        )
        await model.load(leagueID: Fixtures.league)
        #expect(model.state == .failed("We do not follow that league."))
    }

    @Test func aScoreboardThatFailsStillShowsTheLeague() async throws {
        let model = try LeagueHomeViewModel(
            api: FixtureAPI(scoreboardFails: true), cache: FileCache(folder: folder), clock: clock,
            zone: Fixtures.zone
        )
        await model.load(leagueID: Fixtures.league)
        guard case let .loaded(home, _, stale) = model.state else {
            Issue.record("Expected loaded, got \(model.state)")
            return
        }
        #expect(stale == false)
        #expect(home.bugs.isEmpty)
        #expect(home.standings.rows.count == 12)
    }

    @Test func aSignedOutAnswerSaysSignIn() async {
        let model = LeagueHomeViewModel(
            api: FailingAPI(error: APIError.status(401)), cache: FileCache(folder: folder), clock: clock,
            zone: Fixtures.zone
        )
        await model.load(leagueID: Fixtures.league)
        #expect(model.state == .failed(AppWords.Failure.signedOut))
    }
}

struct FixtureAPI: LeagueAPI {
    let sync: LeagueSync
    let board: Scoreboard
    var scoreboardFails = false

    init(scoreboardFails: Bool = false) throws {
        sync = try Fixtures.sync()
        board = try Fixtures.scoreboard(Fixtures.sunday)
        self.scoreboardFails = scoreboardFails
    }

    func leagueSync(id _: String) async throws -> LeagueSync {
        sync
    }

    func scoreboard(id _: String) async throws -> Scoreboard {
        if scoreboardFails {
            throw APIError.status(502)
        }
        return board
    }
}

struct FailingAPI: LeagueAPI {
    var error: any Error = URLError(.notConnectedToInternet)

    func leagueSync(id _: String) async throws -> LeagueSync {
        throw error
    }

    func scoreboard(id _: String) async throws -> Scoreboard {
        throw error
    }
}
