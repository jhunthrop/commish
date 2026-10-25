import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Rankings
import RunFixtures
import SwiftUI
import Testing

/// The Rankings' mock: the fixture's order with no league through the view model at the week's clock
/// (Saturday noon Central), both themes, iPhone 17 Pro and iPhone SE, at 1x: the top in season (every
/// position), a position's view (WR), the kickers' week (K), a search ("wa", the matches at their places
/// in the order), and the order saved and read again with no signal, stale with its stamp. A face draws
/// its initials here (a snapshot loads no image). With SNAPSHOT_SHOTS set each is also written at its
/// phone's own scale for the persona panel.
@MainActor
struct RankingsSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!
    static let week = APIDecoding.parseDate("2026-10-17T17:00:00Z")!

    enum Scene: String, CaseIterable, Sendable {
        case top
        case position
        case kicker
        case search
        case stale

        var chip: RankingsChip? {
            switch self {
            case .position: .receiver
            case .kicker: .kicker
            default: nil
            }
        }

        var query: String {
            self == .search ? "wa" : ""
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

    /// The view model at the scene's state: read fresh, or saved and then read with no signal.
    static func viewModel(_ scene: Scene) async -> RankingsViewModel {
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("rankings-snapshots-\(UUID().uuidString)"))
        if scene == .stale {
            await RankingsViewModel(
                api: StubRankings(), cache: cache, clock: FixedClock(week), inSeason: true, zone: zone
            ).load()
        }
        let viewModel = RankingsViewModel(
            api: StubRankings(offline: scene == .stale), cache: cache,
            clock: FixedClock(week.addingTimeInterval(scene == .stale ? 1800 : 0)), inSeason: true,
            query: scene.query, zone: zone
        )
        await viewModel.load()
        await viewModel.choose(chip: scene.chip)
        return viewModel
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = await viewModel(item.scene)
        guard case let .loaded(content, _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        return RankingsMock(viewModel: viewModel, content: content, device: item.device)
    }

    @Test(arguments: 0 ..< cases.count)
    func rankings(index: Int) async throws {
        let item = Self.cases[index]
        let name = "rankings-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theStaleSceneSaysWhenItsOrderWasRead() async {
        let viewModel = await Self.viewModel(.stale)
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// The first screen as the phone draws it: the room between the top bar and the tab bar (the app draws
/// both natively), the screen's top in it.
struct RankingsMock: View {
    let viewModel: RankingsViewModel
    let content: RankingsContent
    let device: SnapshotDevice

    /// Rows enough to fill the first screen of the tallest phone.
    static let firstRows = 8

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        RankingsScreen(
            name: viewModel.name, lead: viewModel.lead, stamp: viewModel.stampWords, chip: viewModel.chip,
            query: viewModel.query, content: content, more: viewModel.more, actions: .none, still: true,
            rows: Self.firstRows
        )
        .fixedSize(horizontal: false, vertical: true)
        .frame(height: room, alignment: .top)
        .clipped()
    }
}
