import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The app's session: signed out with no token, the first followed league once signed in, and a
/// sign-out that revokes this phone and forgets its token and its saved answers.
@MainActor
struct AppSessionTests {
    nonisolated static func followed(
        _ id: String, phase: Components.Schemas.LeaguePhaseKnown = .inSeason
    ) -> FollowedLeague {
        FollowedLeague(
            id: id, name: "League \(id)", host: .init(value1: .sleeper), phase: phase, draftAt: nil, waiversOpen: true
        )
    }

    /// A defaults suite of the test's own, so no test reads another's last league.
    static func defaults() -> UserDefaults {
        UserDefaults(suiteName: "commish-tests-\(UUID().uuidString)")!
    }

    @Test func noTokenIsSignedOut() async {
        let session = AppSession(
            account: StubAccount(),
            store: MemorySessionStore(),
            cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedOut)
    }

    @Test func aTokenOpensTheFirstFollowedLeague() async {
        let store = MemorySessionStore()
        try await store.save(token: "t", deviceID: "d")
        let session = AppSession(
            account: StubAccount(leagues: [Fixtures.league, "other"]),
            store: store,
            cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedIn(league: Self.followed(Fixtures.league)))
    }

    @Test func noFollowedLeagueSaysWhereToFollowOne() async {
        let store = MemorySessionStore()
        try await store.save(token: "t", deviceID: "d")
        let session = AppSession(
            account: StubAccount(leagues: []),
            store: store,
            cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedIn(league: nil))
        #expect(session.tabs == PhoneRail.withoutLeague)
    }

    /// With no league followed the bar is the site's season's (GET /season), not the season's always.
    @Test func noFollowedLeagueTakesTheSitesSeason() async {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: "d")
        let session = AppSession(
            account: StubAccount(leagues: [], season: .preseason), store: store, cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.tabs == PhoneRail.tabs(phase: .preDraft, waiversOpen: false))
    }

    /// An API from before GET /season, or one that fails it: the season's bar.
    @Test func aSeasonThatCannotBeReadIsInSeason() async {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: "d")
        let session = AppSession(
            account: StubAccount(leagues: [], seasonError: APIError.status(500)), store: store, cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.tabs == PhoneRail.withoutLeague(season: .inSeason))
    }

    @Test func choosingALeagueSelectsItAndTheBarFollowsItsPhase() async {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: "d")
        let defaults = Self.defaults()
        let account = StubAccount(followed: [Self.followed("a"), Self.followed("b", phase: .preDraft)])
        let session = AppSession(account: account, store: store, cache: NullCache(), defaults: defaults)
        await session.restore()
        #expect(session.leagues.map(\.id) == ["a", "b"])
        session.choose("b")
        #expect(session.state == .signedIn(league: Self.followed("b", phase: .preDraft)))
        #expect(session.tabs == PhoneRail.tabs(phase: .preDraft, waiversOpen: true))
        #expect(session.leagueSwitch.rows.first?.id == "b")
        session.choose("not-followed")
        #expect(session.state == .signedIn(league: Self.followed("b", phase: .preDraft)))
        // The next open keeps the member's choice.
        let again = AppSession(account: account, store: store, cache: NullCache(), defaults: defaults)
        await again.restore()
        #expect(again.state == .signedIn(league: Self.followed("b", phase: .preDraft)))
    }

    @Test func noSignalListsTheLeaguesLastRead() async {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("commish-session-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let cache = FileCache(folder: folder)
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: "d")
        let defaults = Self.defaults()
        let online = AppSession(
            account: StubAccount(leagues: ["a", "b"]), store: store, cache: cache, defaults: defaults
        )
        await online.restore()
        online.choose("b")
        let offline = AppSession(
            account: StubAccount(error: URLError(.notConnectedToInternet)), store: store, cache: cache,
            defaults: defaults
        )
        await offline.restore()
        #expect(offline.leagues.map(\.id) == ["a", "b"])
        guard case let .signedIn(league) = offline.state else {
            Issue.record("Expected signed in, got \(offline.state)")
            return
        }
        #expect(league?.id == "b")
        #expect(league?.name == "League b")
    }

    @Test func aRevokedTokenSignsOut() async {
        let store = MemorySessionStore()
        try await store.save(token: "t", deviceID: "d")
        let session = AppSession(
            account: StubAccount(error: APIError.status(401)),
            store: store,
            cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedOut)
        #expect(await store.token() == nil)
    }

    @Test func signingOutRevokesThisPhoneAndForgetsIt() async {
        let store = MemorySessionStore()
        try await store.save(token: "t", deviceID: "d-9")
        let account = StubAccount(leagues: [Fixtures.league])
        let session = AppSession(account: account, store: store, cache: NullCache(), defaults: Self.defaults())
        await session.restore()
        await session.signOut()
        #expect(session.state == .signedOut)
        #expect(await store.token() == nil)
        #expect(await account.revoked == ["d-9"])
    }

    @Test func anExpiredSignInForgetsTheSavedHome() async throws {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("commish-session-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let cache = FileCache(folder: folder)
        let route = "/leagues/attached/\(Fixtures.league)/home"
        await cache.write("saved home", route: route, stamp: Date(timeIntervalSince1970: 1_760_000_000))
        let store = MemorySessionStore()
        try await store.save(token: "t", deviceID: "d")
        let session = AppSession(account: StubAccount(), store: store, cache: cache, defaults: Self.defaults())
        #expect(await cache.read(String.self, route: route) != nil)
        await session.expire()
        #expect(await cache.read(String.self, route: route) == nil)
        #expect(await store.token() == nil)
        #expect(session.state == .signedOut)
    }
}

actor StubAccount: AccountAPI {
    private let leagues: [FollowedLeague]
    private let error: (any Error)?
    private let season: SitePhase?
    private let seasonError: (any Error)?
    private(set) var revoked: [String] = []

    init(
        leagues: [String] = [], error: (any Error)? = nil, season: SitePhase? = .inSeason,
        seasonError: (any Error)? = nil
    ) {
        self.init(
            followed: leagues.map { AppSessionTests.followed($0) }, error: error, season: season,
            seasonError: seasonError
        )
    }

    init(
        followed: [FollowedLeague], error: (any Error)? = nil, season: SitePhase? = .inSeason,
        seasonError: (any Error)? = nil
    ) {
        leagues = followed
        self.error = error
        self.season = season
        self.seasonError = seasonError
    }

    func followedLeagues() async throws -> [FollowedLeague] {
        if let error {
            throw error
        }
        return leagues
    }

    func siteSeason() async throws -> SitePhase? {
        if let seasonError {
            throw seasonError
        }
        return season
    }

    func revokeDevice(id: String) async throws {
        revoked.append(id)
    }
}

struct NullCache: AnswerCache {
    func read<Value: Codable & Sendable>(_: Value.Type, route _: String) async -> Cached<Value>? {
        nil
    }

    func write(_: some Codable & Sendable, route _: String, stamp _: Date) async {}

    func clear() async {}
}
