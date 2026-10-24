import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The app's session: signed out with no token, the first followed league once signed in, and a
/// sign-out that revokes this phone and forgets its token and its saved answers.
@MainActor
struct AppSessionTests {
    nonisolated static func followed(_ id: String) -> FollowedLeague {
        FollowedLeague(id: id, phase: .inSeason, waiversOpen: true)
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
}

actor StubAccount: AccountAPI {
    private let leagues: [String]
    private let error: (any Error)?
    private(set) var revoked: [String] = []

    init(leagues: [String] = [], error: (any Error)? = nil) {
        self.leagues = leagues
        self.error = error
    }

    func followedLeagues() async throws -> [FollowedLeague] {
        if let error {
            throw error
        }
        return leagues.map(AppSessionTests.followed)
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
