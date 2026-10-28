import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import MockRoom
import RunFixtures
import SwiftUI
import Testing

/// The mock room's mock, through the view models over the recorded draft (shared/fixtures/mock-room),
/// both themes, iPhone 17 Pro and iPhone SE, at 1x: the setup; the first turn with our call and the
/// bar; round 5 with the strip since your pick and the pool; the wall and your team at round 5; the
/// queue under its chip; after an undo; the saved room shown stale with no connection; the report at
/// 1st and well down the table; and a shared mock. With SNAPSHOT_SHOTS set each is also written at its
/// phone's own scale for the persona panel.
@MainActor
struct MockRoomSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!
    /// The draft was recorded on Sunday 2026-10-25 at 16:00 Central.
    static let readAt = APIDecoding.parseDate("2026-10-25T21:00:00Z")!

    enum Scene: String, CaseIterable, Sendable {
        case setup
        case firstTurn = "first-turn"
        case round5
        case round5Wall = "round5-wall"
        case queue
        case undo
        case offline
        case reportFirst = "report-first"
        case reportDown = "report-down"
        case shared

        var parts: Set<MockRoomPart> {
            switch self {
            case .round5, .queue: [.pool]
            case .round5Wall: [.wall, .team]
            default: [.call, .pool]
            }
        }
    }

    struct Case: Sendable {
        let scene: Scene
        let scheme: Scheme
        let device: SnapshotDevice
    }

    nonisolated static let cases: [Case] = Scene.allCases.flatMap { scene in
        [Scheme.light, .dark].flatMap { scheme in
            SnapshotDevice.screens.map { Case(scene: scene, scheme: scheme, device: $0) }
        }
    }

    static func cache() -> FileCache {
        FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("mock-shots-\(UUID().uuidString)"))
    }

    static func room(_ scene: Scene) async -> MockRoomViewModel {
        let api = StubMock(opened: scene == .firstTurn ? .create : .round5)
        let cache = cache()
        let viewModel = MockRoomViewModel(
            id: MockFixture.id, api: api, cache: cache, clock: FixedClock(readAt), zone: zone
        )
        await viewModel.load()
        switch scene {
        case .queue:
            await viewModel.toggleQueue((try? MockFixture.room(.queue).queue.first) ?? "")
            viewModel.choose(filter: Words.Mock.queue)
        case .undo:
            await viewModel.undo()
        case .offline:
            await api.setOffline(true)
            let saved = MockRoomViewModel(
                id: MockFixture.id, api: api, cache: cache, clock: FixedClock(readAt), zone: zone
            )
            await saved.load()
            return saved
        default:
            break
        }
        return viewModel
    }

    static func view(_ item: Case) async throws -> AnyView {
        let scene = item.scene
        switch scene {
        case .setup:
            let setup = MockSetupViewModel(api: StubMock())
            setup.choose(slot: 5)
            return framed(MockSetupScreen(viewModel: setup, started: { _ in }, live: false), item)
        case .reportFirst, .reportDown:
            let report = try MockFixture.report(scene == .reportFirst ? "report" : "report-down")
            let model = DraftReportModel(
                report, names: MockWords.seatNames(teams: report.teams, slot: report.slot),
                seats: Words.Mock.botsByAdp, reshuffled: Words.Mock.reshuffled
            )
            return framed(
                MockReportScreen(report: model, verbs: .none(MockWords.runAgain(report.slot)), parts: [.head]),
                item
            )
        case .shared:
            let viewModel = SharedMockViewModel(code: "code", api: StubMock(opened: .sharedRound5))
            await viewModel.load()
            guard case let .room(model) = viewModel.state else {
                throw SceneError.notLoaded(scene.rawValue)
            }
            return framed(
                MockRoomScreen(
                    model: model,
                    stale: nil,
                    refusal: nil,
                    enabled: false,
                    actions: .none,
                    parts: [.pool],
                    live: false
                ),
                item
            )
        default:
            let viewModel = await room(scene)
            guard case let .room(model, stale) = viewModel.state else {
                throw SceneError.notLoaded(scene.rawValue)
            }
            let screen = MockRoomScreen(
                model: model, stale: stale ? viewModel.staleWords : nil, refusal: nil, enabled: viewModel.canWrite,
                actions: .none, parts: scene.parts, live: false
            )
            return framed(screen, item, bar: model.bar.map {
                AnyView(MockBarView(bar: $0, enabled: viewModel.canWrite, copied: false, actions: .none, live: false))
            })
        }
    }

    /// The room on its phone under the top bar, the room's bar at the foot where it has one.
    static func framed(_ view: some View, _ item: Case, bar: AnyView? = nil) -> AnyView {
        AnyView(
            ZStack(alignment: .bottom) {
                view.fixedSize(horizontal: false, vertical: true)
                    .frame(height: room(item.device), alignment: .top)
                    .clipped()
                if let bar {
                    bar.fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(height: room(item.device))
        )
    }

    /// The room between the status bar and the home indicator, under the room's own top bar, by phone.
    static func room(_ device: SnapshotDevice) -> Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 45
    }

    @Test(arguments: 0 ..< cases.count)
    func mock(index: Int) async throws {
        let item = Self.cases[index]
        let name = "mock-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theOfflineRoomSaysWhenItWasRead() async {
        let viewModel = await Self.room(.offline)
        #expect(viewModel.staleWords == "\(Words.Mock.unreachablePhone) Last read Sun 4:00 pm")
        #expect(!viewModel.canWrite)
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}
