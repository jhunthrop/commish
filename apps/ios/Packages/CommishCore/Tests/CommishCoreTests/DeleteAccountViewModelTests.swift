import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Account's delete sheet: the verb held until the typed email is the account's (the web's rule,
/// held to shared/fixtures/parity/account-delete.json), the line naming who is signed in, a 204 that
/// forgets the phone as a sign-out does (the token, the saved answers, a new shell generation, nothing
/// revoked) and lands signed out saying the account is deleted, and the refusals in the API's words.
@MainActor
struct DeleteAccountViewModelTests {
    struct Parity: Decodable {
        struct Case: Decodable {
            let typed: String
            let confirmed: Bool
        }

        let email: String
        let signedIn: String
        let confirm: [Case]
    }

    static func parity() throws -> Parity {
        try JSONDecoder().decode(Parity.self, from: Fixtures.data("fixtures/parity/account-delete.json"))
    }

    final class Calls {
        var deleted = 0
        var signedOut = 0
    }

    static func sheet(_ stub: StubAccountScreen, calls: Calls = Calls()) async throws -> DeleteAccountViewModel {
        let viewModel = AccountViewModel(
            api: stub, cache: NullCache(), clock: FixedClock(AccountViewModelTests.now), zone: Fixtures.zone,
            push: StaticPush(), deviceID: { AccountViewModelTests.phone }, signOut: {},
            onSignedOut: { calls.signedOut += 1 }, deleted: { calls.deleted += 1 }
        )
        await viewModel.load()
        return try #require(viewModel.deletion())
    }

    @Test func theSheetWaitsForAnAccountToBeRead() throws {
        let viewModel = try AccountViewModel(
            api: StubAccountScreen.fixture(), cache: NullCache(), clock: FixedClock(AccountViewModelTests.now),
            zone: Fixtures.zone, push: StaticPush(), deviceID: { nil }, signOut: {}, onSignedOut: {},
            deleted: {}
        )
        #expect(viewModel.deletion() == nil)
    }

    @Test func theVerbWaitsForTheAccountsEmailAsTheWebsRuleSays() async throws {
        let parity = try Self.parity()
        let sheet = try await Self.sheet(StubAccountScreen.fixture())
        #expect(sheet.email == parity.email)
        #expect(sheet.signedIn == parity.signedIn)
        #expect(sheet.canDelete == false)
        for item in parity.confirm {
            sheet.typed = item.typed
            #expect(sheet.canDelete == item.confirmed, "\(item.typed)")
            #expect(DeleteAccountViewModel.confirmed(item.typed, email: parity.email) == item.confirmed)
        }
    }

    @Test func aDeleteBeforeTheEmailMatchesSendsNothing() async throws {
        let stub = try StubAccountScreen.fixture()
        let calls = Calls()
        let sheet = try await Self.sheet(stub, calls: calls)
        sheet.typed = "fixture@example.co"
        await sheet.delete()
        #expect(await stub.deletions.isEmpty)
        #expect(calls.deleted == 0)
    }

    @Test func a204HandsThePhoneToTheSession() async throws {
        let stub = try StubAccountScreen.fixture()
        let calls = Calls()
        let sheet = try await Self.sheet(stub, calls: calls)
        sheet.typed = " FIXTURE@example.com "
        await sheet.delete()
        #expect(await stub.deletions == [" FIXTURE@example.com "])
        #expect(calls.deleted == 1)
        #expect(sheet.problem == nil)
        #expect(sheet.busy == false)
    }

    @Test func a204ForgetsThePhoneAndEveryScreenAndSaysTheAccountIsDeleted() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("delete-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let cache = FileCache(folder: folder)
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: AccountViewModelTests.phone)
        let account = StubAccount(leagues: [Fixtures.league])
        let session = AppSession(account: account, store: store, cache: cache, defaults: AppSessionTests.defaults())
        await session.restore()
        let before = session.generation
        #expect(session.isSignedIn)
        #expect(session.notice == nil)
        let viewModel = try AccountViewModel(
            api: StubAccountScreen.fixture(), cache: cache, clock: FixedClock(AccountViewModelTests.now),
            zone: Fixtures.zone, push: StaticPush(), deviceID: { await store.deviceID() },
            signOut: { await session.signOut() }, onSignedOut: { Task { await session.expire() } },
            deleted: { await session.deleted() }
        )
        await viewModel.load()
        #expect(await cache.read(AccountScreenAnswer.self, route: AccountViewModel.route) != nil)
        let sheet = try #require(viewModel.deletion())
        sheet.typed = "fixture@example.com"
        await sheet.delete()
        #expect(session.state == .signedOut)
        #expect(session.generation == before + 1)
        #expect(session.notice == Words.DeleteAccount.doneTitle)
        #expect(session.tabs == PhoneRail.withoutLeague)
        #expect(await store.token() == nil)
        #expect(await cache.read(AccountScreenAnswer.self, route: AccountViewModel.route) == nil)
        // The API deleted every device: nothing is revoked.
        #expect(await account.revoked.isEmpty)
        // The next sign-in says nothing of it.
        await store.save(token: "t2", deviceID: "d2")
        await session.restore()
        #expect(session.notice == nil)
    }

    /// How many times the league switch heard of a change.
    final class Heard {
        var leaguesChanged = 0
    }

    /// A phone signed in on a disk cache, its Account read, and one league detached a moment ago, its undo
    /// window still open (the wait sleeps an hour, as long as the window can last in a test).
    struct DetachedPhone {
        let viewModel: AccountViewModel
        let session: AppSession
        let cache: FileCache
        let heard: Heard
    }

    func detachedOnDisk(_ folder: URL) async throws -> DetachedPhone {
        let cache = FileCache(folder: folder)
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: AccountViewModelTests.phone)
        let session = AppSession(
            account: StubAccount(leagues: [Fixtures.league]), store: store, cache: cache,
            defaults: AppSessionTests.defaults()
        )
        await session.restore()
        let heard = Heard()
        let viewModel = try AccountViewModel(
            api: StubAccountScreen.fixture(), cache: cache, clock: FixedClock(AccountViewModelTests.now),
            zone: Fixtures.zone, push: StaticPush(), deviceID: { await store.deviceID() },
            signOut: { await session.signOut() }, onSignedOut: { Task { await session.expire() } },
            deleted: { await session.deleted() }, leaguesChanged: { heard.leaguesChanged += 1 },
            wait: { _ in try? await Task.sleep(for: .seconds(3600)) }
        )
        await viewModel.load()
        await viewModel.detach(Fixtures.league)
        #expect(try AccountViewModelTests.loaded(viewModel).leagues?.contains { $0.detached } == true)
        return DetachedPhone(viewModel: viewModel, session: session, cache: cache, heard: heard)
    }

    /// Lets the unstructured writes a leave could start run, so a test sees any of them.
    func settle() async {
        for _ in 0 ..< 20 {
            await Task.yield()
        }
    }

    @Test func aDetachInItsUndoWindowWritesNothingBackAfterTheDelete() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("delete-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let phone = try await detachedOnDisk(folder)
        let (viewModel, session, cache, heard) = (phone.viewModel, phone.session, phone.cache, phone.heard)
        let sheet = try #require(viewModel.deletion())
        sheet.typed = "fixture@example.com"
        await sheet.delete()
        #expect(session.state == .signedOut)
        // The shell is rebuilt for no account: the Account leaves, as its view disappears.
        viewModel.leave()
        await settle()
        #expect(await cache.read(AccountScreenAnswer.self, route: AccountViewModel.route) == nil)
        #expect(viewModel.undoWindow == nil)
        #expect(heard.leaguesChanged == 0)
    }

    @Test func aDetachInItsUndoWindowWritesNothingBackAfterSignOut() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("signout-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let phone = try await detachedOnDisk(folder)
        let (viewModel, session, cache, heard) = (phone.viewModel, phone.session, phone.cache, phone.heard)
        await viewModel.signOut()
        #expect(session.state == .signedOut)
        viewModel.leave()
        await settle()
        #expect(await cache.read(AccountScreenAnswer.self, route: AccountViewModel.route) == nil)
        #expect(heard.leaguesChanged == 0)
    }

    @Test func theVerbIsHeldWhileTheDeleteRunsAndASecondTapSendsNothing() async throws {
        let stub = try StubAccountScreen.fixture()
        let gate = Gate()
        await stub.holdDeletes(on: gate)
        let calls = Calls()
        let sheet = try await Self.sheet(stub, calls: calls)
        sheet.typed = "fixture@example.com"
        let first = Task { await sheet.delete() }
        while await stub.deletions.isEmpty {
            await Task.yield()
        }
        #expect(sheet.busy)
        #expect(sheet.canDelete == false)
        await sheet.delete()
        #expect(await stub.deletions.count == 1)
        await gate.open()
        await first.value
        #expect(await stub.deletions.count == 1)
        #expect(sheet.busy == false)
        #expect(calls.deleted == 1)
    }

    @Test func aWrongEmailSaysTheAPIsSentenceForIt() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.refuseDelete(with: APIError.envelope(code: "invalid", message: "Type the email you sign in with"))
        let calls = Calls()
        let sheet = try await Self.sheet(stub, calls: calls)
        sheet.typed = "fixture@example.com"
        await sheet.delete()
        #expect(sheet.problem == "Type the email you sign in with")
        #expect(calls.deleted == 0)
        #expect(sheet.canDelete)
    }

    @Test func aRenewingMembershipSaysTheAPIsSentenceAndKeepsTheAccount() async throws {
        let stub = try StubAccountScreen.fixture()
        let sentence = "Cancel your membership first, so your card is not charged again"
        await stub.refuseDelete(with: APIError.envelope(code: "conflict", message: sentence))
        let calls = Calls()
        let sheet = try await Self.sheet(stub, calls: calls)
        sheet.typed = "fixture@example.com"
        await sheet.delete()
        #expect(sheet.problem == sentence)
        #expect(calls.deleted == 0)
        #expect(calls.signedOut == 0)
    }

    @Test func aRefusedTokenSignsOutAsToday() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.refuseDelete(with: APIError.status(401))
        let calls = Calls()
        let sheet = try await Self.sheet(stub, calls: calls)
        sheet.typed = "fixture@example.com"
        await sheet.delete()
        #expect(calls.signedOut == 1)
        #expect(calls.deleted == 0)
        #expect(sheet.problem == AppWords.Failure.signedOut)
    }

    @Test func noSignalSaysTheWebsSentenceAndNothingWasDeleted() async throws {
        let stub = try StubAccountScreen.fixture()
        await stub.refuseDelete(with: URLError(.notConnectedToInternet))
        let calls = Calls()
        let sheet = try await Self.sheet(stub, calls: calls)
        sheet.typed = "fixture@example.com"
        await sheet.delete()
        #expect(sheet.problem == Words.DeleteAccount.failed)
        #expect(calls.deleted == 0)
    }
}
