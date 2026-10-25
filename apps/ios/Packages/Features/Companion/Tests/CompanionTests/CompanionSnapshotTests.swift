import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
@testable import Companion
import Foundation
import RunFixtures
import SwiftUI
import Testing

/// The companion's mock, through the view models over the recorded replay (shared/fixtures/companion),
/// both themes, iPhone 17 Pro and iPhone SE, at 1x, each framed to the room between the top bar and the
/// tab bar: the start page with a link pasted and slot 5 chosen; waiting for others before the first
/// turn (the bar, the picks as they land, the call that waits on the board); the member's turn with
/// the odds (the picks since, our call, who we would take next) and the pool under it; the pick
/// marked on the strip once it lands, with the team; the wall through round 2 with the pick on the
/// clock; the report's head, its pick by pick and its runs;
/// and the stale state, the last picks kept with the reconnecting line and their stamp. With
/// SNAPSHOT_SHOTS set each is also written at its phone's own scale for the persona panel.
@MainActor
struct CompanionSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!
    /// The replay was recorded on Sunday 2026-10-25 at 14:30 Central.
    static let readAt = APIDecoding.parseDate("2026-10-25T19:31:00Z")!

    enum Scene: String, CaseIterable, Sendable {
        case new
        case waiting
        case turn
        case turnPool = "turn-pool"
        case marked
        case wall
        case reportHead = "report-head"
        case reportPicks = "report-picks"
        case reportRuns = "report-runs"
        case stale

        /// The moments read to reach the scene.
        var moments: [CompanionFixture.Moment] {
            switch self {
            case .new, .waiting: [.waiting]
            case .turn, .turnPool: [.waiting, .between, .turn]
            case .marked, .wall: [.waiting, .between, .turn, .taken]
            case .reportHead, .reportPicks, .reportRuns: CompanionFixture.Moment.allCases
            case .stale: [.waiting, .between]
            }
        }

        var parts: Set<CompanionPart> {
            switch self {
            case .turnPool: [.pool]
            case .marked: [.strips, .call, .team]
            case .wall: [.wall]
            case .turn: [.strips, .call]
            default: Set(CompanionPart.allCases)
            }
        }

        var reportParts: Set<ReportPart> {
            switch self {
            case .reportPicks: [.picks]
            case .reportRuns: [.runs]
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

    static func viewModel(_ scene: Scene) async -> CompanionViewModel {
        let api = StubCompanion(moments: scene.moments)
        let viewModel = CompanionViewModel(
            id: CompanionFixture.id, api: api, cache: FileCache(
                folder: FileManager.default.temporaryDirectory
                    .appendingPathComponent("companion-shots-\(UUID().uuidString)")
            ),
            clock: FixedClock(readAt), zone: zone
        )
        for _ in scene.moments {
            await viewModel.load()
        }
        if scene == .stale {
            await api.setOffline(true)
            await viewModel.load()
        }
        return viewModel
    }

    static func view(_ item: Case) async throws -> AnyView {
        let scene = item.scene
        if scene == .new {
            let viewModel = NewCompanionViewModel(api: StubCompanion())
            await viewModel.load()
            viewModel.link = "sleeper.com/draft/nfl/1382163311050645504"
            viewModel.slot = 5
            return framed(NewCompanionScreen(viewModel: viewModel, follow: {}, openDraft: { _ in }, live: false), item)
        }
        let viewModel = await viewModel(scene)
        switch viewModel.state {
        case let .room(model, _):
            return framed(
                CompanionScreen(
                    model: model, stale: viewModel.stampWords, actions: .none, live: false, parts: scene.parts
                ),
                item
            )
        case let .report(report, _):
            return framed(DraftReportScreen(report: report, actions: .none, parts: scene.reportParts), item)
        case .loading, .failed:
            throw SceneError.notLoaded(scene.rawValue)
        }
    }

    static func framed(_ view: some View, _ item: Case) -> AnyView {
        AnyView(
            view.fixedSize(horizontal: false, vertical: true)
                .frame(height: room(item.device), alignment: .top)
                .clipped()
        )
    }

    /// The phones' chrome over and under the room: the status bar and home indicator of a phone with
    /// a notch, the SE's status bar, the navigation bar, the tab bar.
    enum Chrome {
        static let tallPhone: Double = 700
        static let statusBar: Double = 54
        static let homeIndicator: Double = 34
        static let shortStatusBar: Double = 20
        static let navigationBar: Double = 56
        static let tabBar: Double = 50
    }

    /// The room between the top bar and the tab bar, by phone.
    static func room(_ device: SnapshotDevice) -> Double {
        let top = device.height > Chrome.tallPhone ? Chrome.statusBar + Chrome.homeIndicator : Chrome.shortStatusBar
        return device.height - top - Chrome.navigationBar - Chrome.tabBar
    }

    @Test(arguments: 0 ..< cases.count)
    func companion(index: Int) async throws {
        let item = Self.cases[index]
        let name = "companion-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theStaleSceneSaysWhenItsPicksWereRead() async {
        let viewModel = await Self.viewModel(.stale)
        #expect(viewModel.stampWords == "Last read Sun 2:31 pm")
    }

    @Test func theMarkedSceneShowsTheDraftersPickOnTheStrip() async throws {
        let viewModel = await Self.viewModel(.marked)
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("no room")
            return
        }
        let mine = try #require(model.strip?.picks.first { $0.strong })
        #expect(mine.lines == ["2.08", Words.Companion.you])
        #expect(model.team.slots.contains { $0.pick == "2.08" })
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}
