import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// A token that lapsed with its session (a signed-in read answers 401) signs the phone out and shows
/// sign-in: the League home's 401 reaches the session, which forgets the token.
@MainActor
struct ExpiryTests {
    @Test func aLeagueReadAnswering401SignsThePhoneOut() async throws {
        let store = MemorySessionStore()
        try await store.save(token: "lapsed", deviceID: "d")
        let session = AppSession(
            account: StubAccount(leagues: [Fixtures.league]), store: store, cache: NullCache(),
            defaults: AppSessionTests.defaults()
        )
        await session.restore()
        #expect(session.state == .signedIn(league: AppSessionTests.followed(Fixtures.league)))
        var refused = false
        let home = LeagueHomeViewModel(
            api: FailingAPI(error: APIError.status(401)), cache: NullCache(),
            clock: FixedClock(Fixtures.instant(Fixtures.sunday)), zone: Fixtures.zone,
            onSignedOut: { refused = true }
        )
        await home.load(leagueID: Fixtures.league)
        #expect(refused)
        // What the app's League tab does with it (RootTabs.swift).
        await session.expire()
        #expect(session.state == .signedOut)
        #expect(await store.token() == nil)
    }
}
