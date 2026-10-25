import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Reference
import RunFixtures
import SwiftUI
import Testing

/// The reference screens' mock: each through its view model over a fixture run at the run's clock, both
/// themes, iPhone 17 Pro and iPhone SE, at 1x. Before the draft, the stand-in (shared/fixtures/standin-run):
/// ADP's top with the Gap, Compare with two players and its call, the clubs index, a club's page (CIN)
/// and the first rows of the strength of schedule. In season, the contract run (shared/fixtures/run): ADP
/// with the run's three format chips and no Gap, Compare with one side a slug the run does not name, the
/// schedule's rest of season grid with its played weeks set back, and ADP saved and read with no signal,
/// stale with its reason. A face draws its initials (a snapshot loads no image). With SNAPSHOT_SHOTS set
/// each is also written at its phone's own scale for the persona panel.
@MainActor
struct ReferenceSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!
    nonisolated static let preDraft = APIDecoding.parseDate("2026-09-01T17:00:00Z")!
    nonisolated static let inSeason = APIDecoding.parseDate("2026-10-22T17:00:00Z")!

    enum Scene: String, CaseIterable, Sendable {
        case adpTop = "adp-top"
        case adpInSeason = "adp-inseason"
        case compareTwo = "compare-two"
        case compareAbsent = "compare-absent"
        case clubs
        case club
        case schedule
        case stale

        var inSeason: Bool {
            [.adpInSeason, .compareAbsent, .schedule, .stale].contains(self)
        }

        var fixture: RunFixture {
            inSeason ? .contract : .standIn
        }

        var now: Date {
            inSeason ? ReferenceSnapshotTests.inSeason : ReferenceSnapshotTests.preDraft
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
            .appendingPathComponent("reference-snapshots-\(UUID().uuidString)"))
    }

    /// A view model's screen once read.
    static func loaded<Model>(_ viewModel: RunScreenViewModel<Model>) async throws -> Model {
        await viewModel.load()
        guard case let .loaded(model, _) = viewModel.state else {
            throw SceneError.notLoaded("\(viewModel.state)")
        }
        return model
    }

    static func adp(_ scene: Scene) async throws -> (AdpModel, String?) {
        let cache = cache()
        if scene == .stale {
            _ = try await loaded(RunScreenViewModel.adp(
                format: nil, run: StubRun(scene.fixture), pages: StubPages(scene.fixture), cache: cache,
                clock: FixedClock(scene.now), zone: zone
            ))
        }
        let offline = scene == .stale
        let viewModel = RunScreenViewModel.adp(
            format: nil, run: StubRun(scene.fixture, offline: offline),
            pages: StubPages(scene.fixture, offline: offline), cache: cache,
            clock: FixedClock(scene.now.addingTimeInterval(offline ? 1800 : 0)), zone: zone
        )
        return try await (loaded(viewModel), viewModel.stampWords)
    }

    static func compare(_ scene: Scene) async throws -> CompareModel {
        let slugs: (String?, String?) = scene == .compareTwo ? ("ja-marr-chase", "rome-odunze") : (
            "jahmyr-gibbs",
            "nobody"
        )
        return try await loaded(RunScreenViewModel.compare(
            slugs: [slugs.0, slugs.1], run: StubRun(scene.fixture), pages: StubPages(scene.fixture),
            cache: cache(), clock: FixedClock(scene.now), zone: zone
        ))
    }

    @ViewBuilder
    static func screen(_ scene: Scene) async throws -> some View {
        let run = StubRun(scene.fixture)
        let pages = StubPages(scene.fixture)
        let clock = FixedClock(scene.now)
        switch scene {
        case .adpTop, .adpInSeason, .stale:
            let (model, stamp) = try await adp(scene)
            AdpScreen(
                model: model, stamp: stamp, actions: .none, format: { _ in }, rows: Array(model.rows.prefix(12)),
                live: false
            )
        case .compareTwo, .compareAbsent:
            try await CompareScreen(model: compare(scene), stamp: nil, actions: .none, live: false)
        case .clubs:
            let model = try await loaded(RunScreenViewModel.clubs(
                run: run, pages: pages, cache: cache(), clock: clock, zone: zone
            ))
            ClubsScreen(model: model, stamp: nil, actions: .none, clubs: Array(model.clubs.prefix(4)))
        case .club:
            let model = try await loaded(RunScreenViewModel.club(
                "cin", run: run, pages: pages, cache: cache(), clock: clock, zone: zone
            ))
            ClubScreen(model: model, stamp: nil, actions: .none)
        case .schedule:
            let model = try await loaded(RunScreenViewModel.schedule(
                run: run, pages: pages, cache: cache(), clock: clock, zone: zone
            ))
            ScheduleScreen(
                model: model,
                stamp: nil,
                actions: .none,
                rows: Array(model.grid.rows.prefix(10)),
                live: false
            )
        }
    }

    @Test(arguments: 0 ..< cases.count)
    func reference(index: Int) async throws {
        let item = Self.cases[index]
        let name = "reference-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.screen(item.scene)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theTopOfAdpCarriesAGapRow() async throws {
        let (model, _) = try await Self.adp(.adpTop)
        #expect(model.gap)
        #expect(model.rows.prefix(12).contains { $0.row.gapTone != nil })
    }

    @Test func theStaleSceneSaysWhyItsScreenShows() async throws {
        let (_, stamp) = try await Self.adp(.stale)
        #expect(stamp == "You're offline, so this is the last board this device saved, updated Oct 21.")
    }

    @Test func theAbsentSceneSaysTheWebsWordsOverItsSearch() async throws {
        let model = try await Self.compare(.compareAbsent)
        #expect(model.slots == [model.slots[0], .missing])
        #expect(model.slots[0].picked)
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}
