import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Account screen's view model: the account, the leagues followed and the paired devices read
/// once (saved for no signal), this phone marked, unpair taking a device off the list (and a 401 after
/// it signing out), detach and restore round-tripping with the web's undo, the push switches written to the
/// account behind the phone's permission, and sign out revoking this phone and returning to sign-in.
@MainActor
struct AccountViewModelTests {
    nonisolated static let phone = "6f1d1c52-2626-4a26-9a26-0000000000d1"
    static let extensionID = "6f1d1c52-2626-4a26-9a26-0000000000d2"
    static let now = Fixtures.instant(Fixtures.week)

    final class Calls {
        var signedOut = 0
        var signOuts = 0
        var leaguesChanged = 0
        var deleted = 0
    }

    static func viewModel(
        _ stub: StubAccountScreen, cache: any AnswerCache = NullCache(), push: any PushControl = StaticPush(),
        device: String? = phone, calls: Calls = Calls(), clock: any Clock = FixedClock(now),
        wait: @escaping @Sendable (Double) async -> Void = { _ in }
    ) -> AccountViewModel {
        AccountViewModel(
            api: stub, cache: cache, clock: clock, zone: Fixtures.zone, push: push,
            deviceID: { device },
            signOut: { calls.signOuts += 1 },
            onSignedOut: { calls.signedOut += 1 },
            deleted: { calls.deleted += 1 },
            leaguesChanged: { calls.leaguesChanged += 1 },
            wait: wait
        )
    }

    static func loaded(_ viewModel: AccountViewModel) throws -> AccountModel {
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw LoadError.notLoaded("\(viewModel.state)")
        }
        return model
    }

    enum LoadError: Error {
        case notLoaded(String)
    }

    @Test func theAccountReadsWithThisPhoneMarkedAndTheFreeSeasonsPlan() async throws {
        let viewModel = try Self.viewModel(StubAccountScreen.fixture())
        await viewModel.load()
        let model = try Self.loaded(viewModel)
        #expect(model.name == "fixture")
        #expect(model.line == "fixture@example.com, with us since Sep 1")
        #expect(model.leagues?.count == 12)
        #expect(model.leaguesAside == "12, newest first")
        #expect(model.devices.map(\.id) == [Self.phone, Self.extensionID])
        #expect(model.devices.map(\.thisPhone) == [true, false])
        #expect(model.devicesAside == "2 devices")
        #expect(model.plan?.title == Words.FreePlan.title)
        #expect(model.followMore == false)
        #expect(viewModel.stampWords == nil)
        #expect(AccountWords.pushFoot(.allowed) == "Kept with your account, for every phone you sign in on.")
        #expect(AccountWords.pushFoot(.notAsked) == "\(Words.Push.kept) \(Words.Push.ask)")
        #expect(AccountWords.pushFoot(.refused) == "\(Words.Push.kept) \(Words.Push.blocked)")
    }

    @Test func unpairTakesTheDeviceOffTheListAndA401AfterItSignsOut() async throws {
        let stub = try StubAccountScreen.fixture()
        let calls = Calls()
        let viewModel = Self.viewModel(stub, calls: calls)
        await viewModel.load()
        await viewModel.unpair(Self.extensionID)
        #expect(await stub.revoked == [Self.extensionID])
        #expect(try Self.loaded(viewModel).devices.map(\.id) == [Self.phone])
        #expect(calls.signedOut == 0)
        await stub.refuseEveryRead()
        await viewModel.load()
        #expect(calls.signedOut == 1)
    }

    /// This phone's row says Sign out and signs out through the session, which revokes it (review L1).
    @Test func unpairingThisPhoneSignsItOutThroughTheSession() async throws {
        let stub = try StubAccountScreen.fixture()
        let calls = Calls()
        let viewModel = Self.viewModel(stub, calls: calls)
        await viewModel.load()
        await viewModel.unpair(Self.phone)
        #expect(calls.signOuts == 1)
        #expect(await stub.revoked.isEmpty)
    }

    @Test func anUnpairTheAPIRefusesSaysItsSentenceAndKeepsTheDevice() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.failWrites(with: APIError.envelope(code: "not_found", message: "No such device."))
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        await viewModel.unpair(Self.extensionID)
        #expect(viewModel.problem == AccountProblem(section: .devices, text: "No such device."))
        #expect(try Self.loaded(viewModel).devices.count == 2)
    }

    /// An undo window that outlasts the test: the row stays detached until it is restored.
    static let longWait: @Sendable (Double) async -> Void = { _ in try? await Task.sleep(for: .seconds(3600)) }

    @Test func detachAndRestoreRoundTripWithTheWebsUndo() async throws {
        let stub = try StubAccountScreen.fixture()
        let calls = Calls()
        let viewModel = Self.viewModel(stub, calls: calls, wait: Self.longWait)
        await viewModel.load()
        await viewModel.detach(Fixtures.league)
        #expect(await stub.detached == [Fixtures.league])
        let marked = try #require(Self.loaded(viewModel).leagues?.first)
        #expect(marked.detached)
        // The switch is not told within the undo window (review M2).
        #expect(calls.leaguesChanged == 0)
        await viewModel.restore(Fixtures.league)
        #expect(await stub.restored == [Fixtures.league])
        #expect(try Self.loaded(viewModel).leagues?.first?.detached == false)
        #expect(calls.leaguesChanged == 0)
        // The restore ends the undo's window: the league stays on the list.
        await viewModel.undoWindow?.value
        #expect(try Self.loaded(viewModel).leagues?.count == 12)
    }

    @Test func aDetachedLeagueLeavesTheListOnceItsUndoHasPassed() async throws {
        let calls = Calls()
        let viewModel = try Self.viewModel(StubAccountScreen.fixture(), calls: calls)
        await viewModel.load()
        await viewModel.detach(Fixtures.league)
        await viewModel.undoWindow?.value
        let model = try Self.loaded(viewModel)
        #expect(model.leagues?.contains { $0.id == Fixtures.league } == false)
        #expect(model.leaguesAside == "11, newest first")
        #expect(calls.leaguesChanged == 1)
    }

    @Test func leavingTheAccountMakesAPendingDetachFinal() async throws {
        let calls = Calls()
        let viewModel = try Self.viewModel(StubAccountScreen.fixture(), calls: calls, wait: Self.longWait)
        await viewModel.load()
        await viewModel.detach(Fixtures.league)
        #expect(calls.leaguesChanged == 0)
        viewModel.leave()
        #expect(calls.leaguesChanged == 1)
        #expect(try Self.loaded(viewModel).leagues?.contains { $0.id == Fixtures.league } == false)
        viewModel.leave()
        #expect(calls.leaguesChanged == 1)
    }

    /// Review M2: the member opened the Account from the Matchup tab and detached the only league. The
    /// bar keeps Matchup (so the Account pushed on it stays) and the row keeps its Undo until the window
    /// closes; then the session reads the account again and the bar becomes the no-league bar.
    @Test func detachingTheOnlyLeagueKeepsTheAccountAndItsUndoUntilTheWindowCloses() async throws {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: Self.phone)
        let account = MutableAccount(leagues: [AppSessionTests.followed(Fixtures.league)])
        let session = AppSession(
            account: account, store: store, cache: NullCache(), defaults: AppSessionTests.defaults()
        )
        await session.restore()
        #expect(session.tabs.contains { $0.key == PhoneRail.matchupKey })
        let gate = Gate()
        let viewModel = try AccountViewModel(
            api: StubAccountScreen.fixture(), cache: NullCache(), clock: FixedClock(Self.now), zone: Fixtures.zone,
            push: StaticPush(), deviceID: { Self.phone }, signOut: {}, onSignedOut: {}, deleted: {},
            leaguesChanged: { Task { await session.restore() } }, wait: { _ in await gate.wait() }
        )
        await viewModel.load()
        await viewModel.detach(Fixtures.league)
        await account.set(leagues: [])
        await Task.yield()
        #expect(session.tabs.contains { $0.key == PhoneRail.matchupKey })
        #expect(try Self.loaded(viewModel).leagues?.first?.detached == true)
        await gate.open()
        await viewModel.undoWindow?.value
        // The session's read runs in its own task: wait for the bar to follow.
        for _ in 0 ..< 100 where session.tabs.contains(where: { $0.key == PhoneRail.matchupKey }) {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(session.tabs == PhoneRail.withoutLeague(season: .inSeason))
    }

    @Test func theAPIsFreeSeasonFlagDecidesBeforeTheDate() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.answerFreeSeason(false)
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        #expect(Self.now < PlanCard.freeSeasonEnds)
        #expect(try Self.loaded(viewModel).plan == nil)
        await stub.answerFreeSeason(true)
        await viewModel.load()
        #expect(try Self.loaded(viewModel).plan?.title == Words.FreePlan.title)
    }

    @Test func aRestoreTheAPIRefusesKeepsTheLeagueDetachedWithItsSentence() async throws {
        let stub = try StubAccountScreen.fixture()
        let viewModel = Self.viewModel(stub, wait: Self.longWait)
        await viewModel.load()
        await viewModel.detach(Fixtures.league)
        await stub.failWrites(with: APIError.envelope(code: "feature_required", message: "One league at a time."))
        await viewModel.restore(Fixtures.league)
        #expect(viewModel.problem == AccountProblem(section: .leagues, text: "One league at a time."))
        #expect(try Self.loaded(viewModel).leagues?.first?.detached == true)
    }

    @Test func aWriteWithNoSignalSaysTheWebsSentence() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.failWrites(with: URLError(.notConnectedToInternet))
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        await viewModel.detach(Fixtures.league)
        #expect(viewModel.problem == AccountProblem(section: .leagues, text: Words.Account.failed))
        #expect(try Self.loaded(viewModel).leagues?.first?.detached == false)
    }

    @Test func signOutRevokesThisPhoneAndReturnsToSignIn() async throws {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: Self.phone)
        let account = StubAccount(leagues: [Fixtures.league])
        let session = AppSession(
            account: account, store: store, cache: NullCache(), defaults: AppSessionTests.defaults()
        )
        await session.restore()
        let viewModel = try AccountViewModel(
            api: StubAccountScreen.fixture(), cache: NullCache(), clock: FixedClock(Self.now), zone: Fixtures.zone,
            push: StaticPush(), deviceID: { await store.deviceID() },
            signOut: { await session.signOut() }, onSignedOut: { Task { await session.expire() } },
            deleted: { await session.deleted() }
        )
        await viewModel.load()
        await viewModel.signOut()
        #expect(await account.revoked == [Self.phone])
        #expect(session.state == .signedOut)
        #expect(await store.token() == nil)
    }

    @Test func noSignalShowsTheSavedAccountDated() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("account-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let cache = FileCache(folder: folder)
        let first = try Self.viewModel(StubAccountScreen.fixture(), cache: cache)
        await first.load()
        let offline = try StubAccountScreen.fixture()
        await offline.failEveryRead(with: URLError(.notConnectedToInternet))
        let later = Self.viewModel(offline, cache: cache, clock: FixedClock(Self.now.addingTimeInterval(1800)))
        await later.load()
        #expect(try Self.loaded(later).devices.count == 2)
        #expect(later.stampWords == "Last read Sat 12:00 pm")
    }

    @Test func noSignalAndNothingSavedSaysSo() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.failEveryRead(with: URLError(.notConnectedToInternet))
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func leaguesThatCannotBeReadSayTheWebsSentenceAndTheRestStands() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.failLeagues()
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        let model = try Self.loaded(viewModel)
        #expect(model.leagues == nil)
        #expect(model.devices.count == 2)
    }

    @Test func aBoughtPlanOrTheSeasonsEndDrawsNoPlanCard() throws {
        let me = try AccountParityTests.answers().me
        #expect(PlanCard.of(me, now: Self.now, flag: nil) != nil)
        #expect(try PlanCard.of(me, now: #require(APIDecoding.parseDate("2027-03-01T00:00:00Z")), flag: nil) == nil)
    }
}
