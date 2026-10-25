import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Record
import RunFixtures
import SwiftUI
import Testing

/// Our record's mock, through the view model over the record's fixtures and the contract run's schedule,
/// both themes, iPhone 17 Pro and iPhone SE, at 1x: the head with the summary once the STAND-IN week 7 is
/// graded against ESPN and the week's published projection, the weeks with that graded week, the
/// summary before week 7 is set (the week and when it grades), the draft record, and the run's own
/// record saved and read again with no signal, stale with its stamp. With SNAPSHOT_SHOTS set each is also
/// written at its phone's own scale for the persona panel.
@MainActor
struct RecordSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!

    enum Scene: String, CaseIterable, Sendable {
        case head
        case week
        case pending
        case draft
        case stale

        var fixture: RecordFixture {
            switch self {
            case .head, .week, .draft: .twoRecords("published")
            case .pending: .twoRecords("upcoming")
            case .stale: .own
            }
        }

        var now: Date {
            APIDecoding.parseDate(self == .pending || self == .stale ? "2026-10-22T17:00:00Z" : "2026-10-29T17:00:00Z")!
        }

        var parts: [RecordPart] {
            switch self {
            case .week: [.weeks]
            case .draft: [.draft]
            default: [.head]
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

    static func viewModel(_ scene: Scene) async -> RecordViewModel {
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("record-snapshots-\(UUID().uuidString)"))
        if scene == .stale {
            await RecordViewModel(
                api: StubRecord(scene.fixture),
                cache: cache,
                clock: FixedClock(scene.now),
                zone: zone
            )
            .load()
        }
        let viewModel = RecordViewModel(
            api: StubRecord(scene.fixture, offline: scene == .stale), cache: cache,
            clock: FixedClock(scene.now.addingTimeInterval(scene == .stale ? 1800 : 0)), zone: zone
        )
        await viewModel.load()
        return viewModel
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = await viewModel(item.scene)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        return RecordScreen(
            model: model, stamp: viewModel.stampWords,
            choice: RecordChoice(figure: .agreement, position: "All", draftFigure: .agreement),
            actions: .none, parts: item.scene.parts, still: true
        )
        .fixedSize(horizontal: false, vertical: true)
        .frame(height: room(item.device), alignment: .top)
        .clipped()
    }

    /// The room between the top bar and the tab bar, by phone.
    static func room(_ device: SnapshotDevice) -> Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    @Test(arguments: 0 ..< cases.count)
    func record(index: Int) async throws {
        let item = Self.cases[index]
        let name = "record-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theStaleSceneSaysWhenItsRecordWasRead() async {
        let viewModel = await Self.viewModel(.stale)
        #expect(viewModel.stampWords == "Last read Thu 12:00 pm")
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}
