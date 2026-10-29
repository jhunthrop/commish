@testable import Account
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
import SwiftUI
import Testing

/// The Account screen's mock: both themes, iPhone 17 Pro and iPhone SE, at 1x, the view model's
/// states over the shared fixtures (GET /me, three of the fixture's leagues, GET /devices) through a
/// stub, at the fixture week's clock. The account: who with sign out, three leagues and the free
/// season's plan; the switches with a starter's status turned off; the two devices with this phone
/// marked, and the foot. A league detached, its undo in place. (The signed-out return, the League
/// tab's sign-in, is the shell's snapshot.) With SNAPSHOT_SHOTS set each is also written at its phone's
/// own scale for the persona panel.
@MainActor
struct AccountSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let inseason = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason").standardized
    static let zone = TimeZone(identifier: "America/Chicago")!
    static let now = APIDecoding.parseDate("2026-10-17T17:00:00Z")!
    nonisolated static let phone = "6f1d1c52-2626-4a26-9a26-0000000000d1"
    /// The FFPC league, the ESPN stand-in and a league before its draft: three platforms, two phases.
    nonisolated static let shown = [
        "6f1d1c52-2626-4a26-9a26-000000000026", "6f1d1c52-2626-4a26-9a26-000000000035",
        "6f1d1c52-2626-4a26-9a26-000000000040",
    ]

    enum Scene: String, CaseIterable, Sendable {
        case read
        case detached

        var parts: [AccountPart] {
            switch self {
            case .read: AccountPart.allCases
            case .detached: [.top]
            }
        }
    }

    struct Case: Sendable {
        let scene: Scene
        let part: AccountPart
        let scheme: Scheme
        let device: SnapshotDevice

        var name: String {
            ["account", scene.rawValue, part.rawValue, device.name, "\(scheme)"].joined(separator: "-")
        }
    }

    nonisolated static let cases: [Case] = Scene.allCases.flatMap { scene in
        scene.parts.flatMap { part in
            [Scheme.light, .dark].flatMap { scheme in
                SnapshotDevice.screens.map { Case(scene: scene, part: part, scheme: scheme, device: $0) }
            }
        }
    }

    static func answer<T: Decodable>(_ type: T.Type, _ file: String) throws -> T {
        try APIDecoding.envelopeData(type, from: Data(contentsOf: inseason.appendingPathComponent(file)))
    }

    /// The view model at the scene's state: read, the account holding a starter's status switched off and
    /// the phone allowing push; or with the ESPN stand-in detached a moment ago.
    static func viewModel(_ scene: Scene) async throws -> AccountViewModel {
        let leagues = try answer([AttachedLeague].self, "leagues-attached.json").filter { shown.contains($0.id) }
        var account = try answer(AccountAnswer.self, "me.json")
        account.notifications = .init(value1: .init(
            timeZone: zone.identifier, quietStart: "23:00", quietEnd: "08:00",
            kinds: .init(starterStatus: false, weekReads: true, waiverClaims: true)
        ))
        let stub = try StubAccountScreen(
            account: account, leagues: leagues, paired: answer([PairedDeviceRow].self, "devices.json")
        )
        let viewModel = AccountViewModel(
            api: stub, cache: NullCache(), clock: FixedClock(now), zone: zone, push: StaticPush(.allowed),
            deviceID: { phone }, signOut: {}, onSignedOut: {}, deleted: {},
            wait: { _ in try? await Task.sleep(for: .seconds(3600)) }
        )
        await viewModel.load()
        if scene == .detached {
            await viewModel.detach(shown[1])
        }
        return viewModel
    }

    static func view(_ item: Case) async throws -> AnyView {
        let viewModel = try await viewModel(item.scene)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        let state = AccountScreenState(
            stamp: viewModel.stampWords, push: viewModel.shownPush, permission: viewModel.permission,
            busy: viewModel.busy, problem: viewModel.problem
        )
        return AnyView(AccountScreen(model: model, state: state, actions: .none, parts: [item.part]))
    }

    @Test(arguments: 0 ..< cases.count)
    func account(index: Int) async throws {
        let item = Self.cases[index]
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: item.name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: item.name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    /// The delete sheet's states: as it opens (nothing typed, the verb held), the email typed and the verb
    /// ready, and a renewing membership's refusal in the API's sentence.
    enum DeleteScene: String, CaseIterable, Sendable {
        case empty
        case matched
        case refused
    }

    struct DeleteCase: Sendable {
        let scene: DeleteScene
        let scheme: Scheme
        let device: SnapshotDevice

        var name: String {
            ["account", "delete", scene.rawValue, device.name, "\(scheme)"].joined(separator: "-")
        }
    }

    nonisolated static let deleteCases: [DeleteCase] = DeleteScene.allCases.flatMap { scene in
        [Scheme.light, .dark].flatMap { scheme in
            SnapshotDevice.screens.map { DeleteCase(scene: scene, scheme: scheme, device: $0) }
        }
    }

    nonisolated static let renewing = "Cancel your membership first, so your card is not charged again"

    static func deletion(_ scene: DeleteScene) async throws -> DeleteAccountViewModel {
        let stub = try StubAccountScreen(
            account: answer(AccountAnswer.self, "me.json"), leagues: [],
            paired: answer([PairedDeviceRow].self, "devices.json"),
            refusal: scene == .refused ? APIError.envelope(code: "conflict", message: renewing) : nil
        )
        let account = AccountViewModel(
            api: stub, cache: NullCache(), clock: FixedClock(now), zone: zone, push: StaticPush(),
            deviceID: { phone }, signOut: {}, onSignedOut: {}, deleted: {}
        )
        await account.load()
        guard let sheet = account.deletion() else {
            throw SceneError.notLoaded("delete")
        }
        if scene != .empty {
            sheet.typed = sheet.email
        }
        if scene == .refused {
            await sheet.delete()
        }
        return sheet
    }

    @Test(arguments: 0 ..< deleteCases.count)
    func deleteSheet(index: Int) async throws {
        let item = Self.deleteCases[index]
        let view = try await AnyView(DeleteAccountSheet(viewModel: Self.deletion(item.scene), live: false))
        Snapshot.shoot(view, named: item.name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: item.name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func theDeleteSheetShowsTheStatesItNames() async throws {
        let empty = try await Self.deletion(.empty)
        #expect(empty.canDelete == false)
        let matched = try await Self.deletion(.matched)
        #expect(matched.canDelete)
        #expect(matched.problem == nil)
        let refused = try await Self.deletion(.refused)
        #expect(refused.problem == Self.renewing)
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theMockShowsTheStatesItNames() async throws {
        let account = try await Self.viewModel(.read)
        guard case let .loaded(model, _, _) = account.state else {
            throw SceneError.notLoaded("read")
        }
        #expect(model.leagues?.count == 3)
        #expect(model.devices.map(\.thisPhone) == [true, false])
        #expect(account.push.on(.status) == false)
        let detached = try await Self.viewModel(.detached)
        guard case let .loaded(after, _, _) = detached.state else {
            throw SceneError.notLoaded("detached")
        }
        #expect(after.leagues?.map(\.detached) == [false, true, false])
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// The Account routes as the fixture answers them.
struct StubAccountScreen: AccountScreenAPI {
    let account: AccountAnswer
    let leagues: [AttachedLeague]
    let paired: [PairedDeviceRow]
    /// What a delete answers: nothing (a 204), or the API's refusal.
    var refusal: APIError?

    func deleteAccount(email _: String) async throws {
        if let refusal {
            throw refusal
        }
    }

    func me() async throws -> AccountAnswer {
        account
    }

    func attached() async throws -> [AttachedLeague] {
        leagues
    }

    func devices() async throws -> [PairedDeviceRow] {
        paired
    }

    func detach(id _: String) async throws {}

    func restore(id _: String) async throws {}

    func revokeDevice(id _: String) async throws {}

    func freeSeasonFlag() async throws -> Bool? {
        nil
    }

    func updateNotifications(_: NotificationSettingsChange) async throws -> AccountAnswer {
        account
    }
}

/// No saved answers.
struct NullCache: AnswerCache {
    func read<Value: Codable & Sendable>(_: Value.Type, route _: String) async -> Cached<Value>? {
        nil
    }

    func write(_: some Codable & Sendable, route _: String, stamp _: Date) async {}

    func clear() async {}
}
