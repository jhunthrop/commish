import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The app's session: signed out with no token, the site's selected league (else the newest) once
/// signed in, a choice written to the site that never takes itself back, and a sign-out that revokes
/// this phone and forgets its token and its saved answers.
@MainActor
struct AppSessionTests {
    nonisolated static func followed(
        _ id: String, phase: Components.Schemas.LeaguePhaseKnown = .inSeason
    ) -> FollowedLeague {
        FollowedLeague(
            id: id, name: "League \(id)", host: .init(value1: .sleeper), scoring: .ppr, format: .ppr, phase: phase,
            draftAt: nil, waiversOpen: true
        )
    }

    /// A defaults suite of the test's own, so no test reads another's last league.
    static func defaults() -> UserDefaults {
        UserDefaults(suiteName: "commish-tests-\(UUID().uuidString)")!
    }

    static func signedIn() async -> MemorySessionStore {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: "d")
        return store
    }

    @Test func noTokenIsSignedOut() async {
        let session = AppSession(
            account: StubAccount(), store: MemorySessionStore(), cache: NullCache(), defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedOut)
    }

    /// Signed out, the bar keeps the web's public five with the League tab first, the sign-in (B155).
    @Test func signedOutKeepsThePublicFive() async {
        let session = AppSession(
            account: StubAccount(), store: MemorySessionStore(), cache: NullCache(), defaults: Self.defaults()
        )
        #expect(session.tabs.isEmpty)
        await session.restore()
        #expect(session.tabs == PhoneRail.withoutLeague)
        #expect(session.tabs.first?.key == PhoneRail.leagueKey)
    }

    /// A league whose phase this build does not know shows the site's season's bar, as Android (B154).
    @Test(arguments: SitePhase.allCases)
    func aLeaguePhaseThisBuildDoesNotKnowTakesTheSitesSeason(season: SitePhase) async {
        let unknown = FollowedLeague(
            id: "u", name: "League u", host: .init(value1: .sleeper), scoring: .ppr, format: .ppr, phase: nil,
            draftAt: nil, waiversOpen: true
        )
        let session = await AppSession(
            account: StubAccount(followed: [unknown], season: season), store: Self.signedIn(), cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.tabs == PhoneRail.withoutLeague(season: season))
    }

    /// The choice's PUT is held: a later GET /me naming the site's old selection never takes it back,
    /// and once the site has taken it, the site's later selection leads again (B156).
    @Test func aPendingChoiceHoldsAgainstALaterRead() async {
        let account = PendingAccount(leagues: ["a", "b"], selected: "a")
        let session = await AppSession(
            account: account, store: Self.signedIn(), cache: NullCache(), defaults: Self.defaults()
        )
        await session.restore()
        session.choose("b")
        await session.restore()
        #expect(session.state == .signedIn(league: Self.followed("b")))
        await account.put.open()
        await session.selectionWrite?.value
        await session.restore()
        #expect(session.state == .signedIn(league: Self.followed("b")))
        await account.select("a")
        await session.restore()
        #expect(session.state == .signedIn(league: Self.followed("a")))
    }

    /// A PUT the site did not take holds the choice until a read agrees; after that the site leads.
    @Test func aChoiceTheSiteDidNotTakeHoldsUntilAReadAgrees() async {
        let account = PendingAccount(leagues: ["a", "b"], selected: "a", takes: false)
        await account.put.open()
        let session = await AppSession(
            account: account, store: Self.signedIn(), cache: NullCache(), defaults: Self.defaults()
        )
        await session.restore()
        session.choose("b")
        await session.selectionWrite?.value
        await session.restore()
        #expect(session.state == .signedIn(league: Self.followed("b")))
        await account.select("b")
        await session.restore()
        await account.select("a")
        await session.restore()
        #expect(session.state == .signedIn(league: Self.followed("a")))
    }

    /// A read already in flight when the choice is made answers from before it: it keeps the choice
    /// shown, even once the PUT has landed.
    @Test func aReadInFlightWhenTheChoiceIsMadeKeepsIt() async {
        let account = PendingAccount(leagues: ["a", "b"], selected: "a")
        await account.put.open()
        let session = await AppSession(
            account: account, store: Self.signedIn(), cache: NullCache(), defaults: Self.defaults()
        )
        await session.restore()
        let read = Gate()
        await account.hold(read)
        let inFlight = Task { await session.restore() }
        await account.reading.wait()
        session.choose("b")
        await session.selectionWrite?.value
        await read.open()
        await inFlight.value
        #expect(session.state == .signedIn(league: Self.followed("b")))
    }

    @Test func aTokenOpensTheNewestFollowedLeagueWithNoSelection() async {
        let session = await AppSession(
            account: StubAccount(leagues: [Fixtures.league, "other"]), store: Self.signedIn(), cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedIn(league: Self.followed(Fixtures.league)))
    }

    @Test func noFollowedLeagueSaysWhereToFollowOne() async {
        let session = await AppSession(
            account: StubAccount(leagues: []), store: Self.signedIn(), cache: NullCache(), defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedIn(league: nil))
        #expect(session.tabs == PhoneRail.withoutLeague)
    }

    /// With no league followed the bar is the site's season's (GET /me's), not the season's always.
    @Test func noFollowedLeagueTakesTheSitesSeason() async {
        let session = await AppSession(
            account: StubAccount(leagues: [], season: .preseason), store: Self.signedIn(), cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.tabs == PhoneRail.tabs(phase: .preDraft, waiversOpen: false))
    }

    /// A season this build does not know (read as nil): the season's bar.
    @Test func aSeasonThisBuildDoesNotKnowIsInSeason() async {
        let session = await AppSession(
            account: StubAccount(leagues: [], season: nil), store: Self.signedIn(), cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.tabs == PhoneRail.withoutLeague(season: .inSeason))
    }

    /// A choice made on the web (GET /me's league) shows in the app on the next load, over the one this
    /// phone made before.
    @Test func theSitesSelectionLeads() async {
        let store = await Self.signedIn()
        let defaults = Self.defaults()
        let phone = AppSession(
            account: StubAccount(leagues: ["a", "b", "c"]), store: store, cache: NullCache(), defaults: defaults
        )
        await phone.restore()
        phone.choose("c")
        await phone.selectionWrite?.value
        let web = AppSession(
            account: StubAccount(leagues: ["a", "b", "c"], selected: "b"), store: store, cache: NullCache(),
            defaults: defaults
        )
        await web.restore()
        #expect(web.state == .signedIn(league: Self.followed("b")))
    }

    @Test func choosingALeagueSelectsItOnTheSiteAndTheBarFollowsItsPhase() async {
        let account = StubAccount(followed: [Self.followed("a"), Self.followed("b", phase: .preDraft)])
        let session = await AppSession(
            account: account, store: Self.signedIn(), cache: NullCache(), defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.leagues.map(\.id) == ["a", "b"])
        session.choose("b")
        #expect(session.state == .signedIn(league: Self.followed("b", phase: .preDraft)))
        #expect(session.tabs == PhoneRail.tabs(phase: .preDraft, waiversOpen: true))
        // The switch keeps GET /me's order, the choice marked in place.
        #expect(session.leagueSwitch.rows.map(\.id) == ["a", "b"])
        #expect(session.leagueSwitch.rows.map(\.selected) == [false, true])
        await session.selectionWrite?.value
        #expect(await account.selections == ["b"])
        session.choose("not-followed")
        #expect(session.state == .signedIn(league: Self.followed("b", phase: .preDraft)))
        #expect(await account.selections == ["b"])
    }

    /// The site cannot take the choice (a league it no longer lists, an older API, no signal): the phone
    /// keeps it, and opens on it next time.
    @Test func aWriteTheSiteRefusesKeepsTheChoice() async {
        let store = await Self.signedIn()
        let defaults = Self.defaults()
        let account = StubAccount(leagues: ["a", "b"], selectError: URLError(.notConnectedToInternet))
        let session = AppSession(account: account, store: store, cache: NullCache(), defaults: defaults)
        await session.restore()
        session.choose("b")
        await session.selectionWrite?.value
        #expect(session.state == .signedIn(league: Self.followed("b")))
        let again = AppSession(account: account, store: store, cache: NullCache(), defaults: defaults)
        await again.restore()
        #expect(again.state == .signedIn(league: Self.followed("b")))
    }

    @Test func aWriteWithARefusedTokenSignsOut() async {
        let store = await Self.signedIn()
        let account = StubAccount(leagues: ["a", "b"], selectError: APIError.status(401))
        let session = AppSession(account: account, store: store, cache: NullCache(), defaults: Self.defaults())
        await session.restore()
        session.choose("b")
        await session.selectionWrite?.value
        #expect(session.state == .signedOut)
        #expect(await store.token() == nil)
    }

    /// No signal: the account last read, its season too, the phone's own last choice leading the saved
    /// selection.
    @Test func noSignalListsTheLeaguesLastRead() async {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("commish-session-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let cache = FileCache(folder: folder)
        let store = await Self.signedIn()
        let defaults = Self.defaults()
        let online = AppSession(
            account: StubAccount(leagues: ["a", "b"], season: .preseason), store: store, cache: cache,
            defaults: defaults
        )
        await online.restore()
        online.choose("b")
        await online.selectionWrite?.value
        let offline = AppSession(
            account: StubAccount(error: URLError(.notConnectedToInternet)), store: store, cache: cache,
            defaults: defaults
        )
        await offline.restore()
        #expect(offline.leagues.map(\.id) == ["a", "b"])
        #expect(offline.sitePhase == .preseason)
        guard case let .signedIn(league) = offline.state else {
            Issue.record("Expected signed in, got \(offline.state)")
            return
        }
        #expect(league?.id == "b")
        #expect(league?.name == "League b")
    }

    @Test func aRevokedTokenSignsOut() async {
        let store = await Self.signedIn()
        let session = AppSession(
            account: StubAccount(error: APIError.status(401)), store: store, cache: NullCache(),
            defaults: Self.defaults()
        )
        await session.restore()
        #expect(session.state == .signedOut)
        #expect(await store.token() == nil)
    }

    @Test func signingOutRevokesThisPhoneAndForgetsIt() async {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: "d-9")
        let account = StubAccount(
            followed: [Self.followed(Fixtures.league)], season: .preseason, format: .ppr, features: ["custom_scoring"]
        )
        let session = AppSession(account: account, store: store, cache: NullCache(), defaults: Self.defaults())
        await session.restore()
        #expect(session.format == .ppr)
        #expect(session.features == ["custom_scoring"])
        await session.signOut()
        #expect(session.state == .signedOut)
        #expect(await store.token() == nil)
        #expect(await account.revoked == ["d-9"])
        // The member's season, board and features go with them (L1).
        #expect(session.sitePhase == nil)
        #expect(session.format == nil)
        #expect(session.features.isEmpty)
    }

    /// The shell is built anew per account (H1): the generation moves as the phone signs in and as it
    /// signs out, never on a read of the same account, nor on a sign-out while already signed out.
    @Test func theGenerationMovesAtSignInAndSignOutOnly() async {
        let store = MemorySessionStore()
        let session = AppSession(
            account: StubAccount(leagues: ["a"]), store: store, cache: NullCache(), defaults: Self.defaults()
        )
        await session.restore()
        let signedOut = session.generation
        await store.save(token: "t", deviceID: "d")
        await session.restore()
        let signedIn = session.generation
        #expect(signedIn != signedOut)
        await session.restore()
        #expect(session.generation == signedIn)
        await session.signOut()
        let next = session.generation
        #expect(next != signedIn)
        await session.expire()
        #expect(session.generation == next)
        await store.save(token: "t2", deviceID: "d2")
        await session.restore()
        #expect(session.generation != next)
    }

    @Test func anExpiredSignInForgetsTheSavedHome() async {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("commish-session-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let cache = FileCache(folder: folder)
        let route = "/leagues/attached/\(Fixtures.league)/home"
        await cache.write("saved home", route: route, stamp: Date(timeIntervalSince1970: 1_760_000_000))
        let store = await Self.signedIn()
        let session = AppSession(account: StubAccount(), store: store, cache: cache, defaults: Self.defaults())
        #expect(await cache.read(String.self, route: route) != nil)
        await session.expire()
        #expect(await cache.read(String.self, route: route) == nil)
        #expect(await store.token() == nil)
        #expect(session.state == .signedOut)
    }
}

/// GET /me and PUT /me/league as a stub: the account's leagues, selection and season, each selection
/// recorded, and the failures a test asks for.
actor StubAccount: AccountAPI {
    private let leagues: [FollowedLeague]
    private let selected: String?
    private let error: (any Error)?
    private let season: SitePhase?
    private let selectError: (any Error)?
    private(set) var revoked: [String] = []
    private(set) var selections: [String] = []

    init(
        leagues: [String] = [], selected: String? = nil, error: (any Error)? = nil, season: SitePhase? = .inSeason,
        selectError: (any Error)? = nil
    ) {
        self.init(
            followed: leagues.map { AppSessionTests.followed($0) }, selected: selected, error: error, season: season,
            selectError: selectError
        )
    }

    init(
        followed: [FollowedLeague], selected: String? = nil, error: (any Error)? = nil,
        season: SitePhase? = .inSeason, selectError: (any Error)? = nil,
        format: Components.Schemas.BoardFormatKnown? = nil, features: [String]? = nil
    ) {
        leagues = followed
        self.selected = selected
        self.error = error
        self.season = season
        self.selectError = selectError
        self.format = format
        self.features = features
    }

    private let format: Components.Schemas.BoardFormatKnown?
    private let features: [String]?

    func account() async throws -> AccountContext {
        if let error {
            throw error
        }
        return AccountContext(leagues: leagues, selected: selected, season: season, format: format, features: features)
    }

    func selectLeague(id: String) async throws -> Bool {
        selections.append(id)
        if let selectError {
            throw selectError
        }
        return true
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
