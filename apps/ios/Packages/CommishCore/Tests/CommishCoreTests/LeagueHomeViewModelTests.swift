import CommishAPI
@testable import CommishCore
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The League home's view model: the cache first, then the API; an app opened with no network shows
/// the last League home with its stamp, never a blank screen (plan Review Focus 2). The failing reads
/// go through the real APIClient over a transport that fails, so the generated client's error and its
/// unwrapping are what is under test (review M4).
@MainActor
struct LeagueHomeViewModelTests {
    private let clock = FixedClock(Fixtures.instant(Fixtures.sunday))
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-core-tests-\(UUID().uuidString)")
    private static let base = URL(string: "http://localhost:8080")!

    /// The generated client over a transport that throws, as URLSession does with no signal.
    private static func offline() -> APIClient {
        APIClient(client: Client(serverURL: base, transport: FailingTransport(URLError(.notConnectedToInternet))))
    }

    /// The generated client over a transport that answers every request with the status.
    private static func answering(_ status: HTTPResponse.Status) -> APIClient {
        APIClient(client: Client(serverURL: base, transport: StatusTransport(status: status)))
    }

    private func warmCache(at stamp: Date) async throws -> FileCache {
        let cache = FileCache(folder: folder)
        let answer = try LeagueHomeAnswer(sync: Fixtures.sync(), scoreboard: Fixtures.scoreboard(Fixtures.week))
        await cache.write(answer, route: LeagueHomeViewModel.route(Fixtures.league), stamp: stamp)
        return cache
    }

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

    @Test func noSignalWithASavedHomeShowsItStale() async throws {
        let earlier = Fixtures.instant(Fixtures.week)
        let model = try await LeagueHomeViewModel(
            api: Self.offline(), cache: warmCache(at: earlier), clock: clock, zone: Fixtures.zone
        )
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

    @Test func noSignalAndNothingSavedSaysNoConnectionInWords() async {
        let model = LeagueHomeViewModel(
            api: Self.offline(), cache: FileCache(folder: folder), clock: clock, zone: Fixtures.zone
        )
        await model.load(leagueID: Fixtures.league)
        #expect(model.state == .failed(AppWords.Failure.offline))
    }

    @Test func aRefreshThatFailsKeepsTheHomeShownAndDatesIt() async throws {
        let cache = try await warmCache(at: Fixtures.instant(Fixtures.week))
        let model = try LeagueHomeViewModel(api: OnceAPI(), cache: cache, clock: clock, zone: Fixtures.zone)
        await model.load(leagueID: Fixtures.league)
        // The pull to refresh: the shown home stays, dated by its own read, never the older saved one
        // put back first (review L1).
        await model.load(leagueID: Fixtures.league)
        guard case let .loaded(_, stamp, stale) = model.state else {
            Issue.record("Expected loaded, got \(model.state)")
            return
        }
        #expect(stale == true)
        #expect(stamp == clock.now)
    }

    @Test func aRefusedTokenSignsOutEvenOverASavedHome() async throws {
        var signedOut = 0
        let model = try await LeagueHomeViewModel(
            api: Self.answering(.unauthorized), cache: warmCache(at: Fixtures.instant(Fixtures.week)),
            clock: clock, zone: Fixtures.zone, onSignedOut: { signedOut += 1 }
        )
        await model.load(leagueID: Fixtures.league)
        #expect(model.state == .failed(AppWords.Failure.signedOut))
        #expect(signedOut == 1)
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

/// Answers the first read, then fails as with no signal.
actor OnceAPI: LeagueAPI {
    private let fixture: FixtureAPI
    private var served = false

    init() throws {
        fixture = try FixtureAPI()
    }

    func leagueSync(id: String) async throws -> LeagueSync {
        if served {
            throw URLError(.notConnectedToInternet)
        }
        served = true
        return try await fixture.leagueSync(id: id)
    }

    func scoreboard(id: String) async throws -> Scoreboard {
        try await fixture.scoreboard(id: id)
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

/// A transport that fails every request as URLSession does with no signal.
struct FailingTransport: ClientTransport {
    let error: URLError

    init(_ error: URLError) {
        self.error = error
    }

    func send(
        _: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        throw error
    }
}

/// A transport that answers every request with one status and the API's error envelope.
struct StatusTransport: ClientTransport {
    let status: HTTPResponse.Status

    func send(
        _: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let body = #"{"ok":false,"data":null,"error":{"code":"unauthorized","message":"Sign in."},"request_id":"r"}"#
        return (HTTPResponse(status: status, headerFields: [.contentType: "application/json"]), HTTPBody(body))
    }
}
