import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Matchup
import SwiftUI
import Testing

/// The Matchup's mock: the fixture league's week at its Sunday clocks and after it, both themes,
/// iPhone 17 Pro and iPhone SE, at 1x. Before the first kickoff (Saturday noon: each side's Proj, the
/// first kickoff), during the games with mixed states (Sunday 18:56Z: kicked off, still to come and
/// final rows, the live score with its read), after Sunday (Monday morning: the member's Sunday
/// starters final, Monday night still to come) and final (Tuesday noon: every game final); and a poll
/// that failed on Sunday, the week kept with its stamp. Each as the phone's first screen, then the
/// member's box and the opponent's with the basis in full. Each state is the view model's, read from
/// the shared fixtures through a stub of the API. With SNAPSHOT_SHOTS set each is also written at its
/// phone's own scale for the persona panel.
@MainActor
struct MatchupSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let inseason = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason").standardized
    static let league = "6f1d1c52-2626-4a26-9a26-000000000026"
    static let zone = TimeZone(identifier: "America/Chicago")!

    enum Scene: String, CaseIterable, Sendable {
        case before
        case sunday
        case monday
        case final
        case stale

        var clock: String {
            switch self {
            case .before: "2026-10-17T17-00-00Z"
            case .sunday, .stale: "2026-10-18T18-56-00Z"
            case .monday: "2026-10-19T16-00-00Z"
            case .final: "2026-10-20T17-00-00Z"
            }
        }

        var parts: [Part] {
            self == .stale ? [.phone] : [.phone, .mine, .theirs]
        }
    }

    enum Part: String, Sendable {
        /// The phone's first screen: the title, the bug and the top of the member's box.
        case phone
        case mine
        case theirs
    }

    struct Case: Sendable {
        let scene: Scene
        let part: Part
        let scheme: Scheme
        let device: SnapshotDevice
    }

    nonisolated static let cases: [Case] = Scene.allCases.flatMap { scene in
        scene.parts.flatMap { part in
            [Scheme.light, .dark].flatMap { scheme in
                SnapshotDevice.screens.map { Case(scene: scene, part: part, scheme: scheme, device: $0) }
            }
        }
    }

    static func instant(_ clock: String) -> Date {
        APIDecoding.parseDate(clock.replacingOccurrences(
            of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
        ))!
    }

    static func answer<T: Decodable>(_: T.Type, _ route: String, _ clock: String) throws -> T {
        let data = try Data(contentsOf: inseason.appendingPathComponent("\(route)-\(league)-\(clock).json"))
        return try APIDecoding.envelopeData(T.self, from: data)
    }

    /// The view model at the scene's state, through the stub: loaded, or loaded and then a poll that
    /// found no signal.
    static func viewModel(_ scene: Scene) async throws -> MatchupViewModel {
        let stub = try StubMatchup(
            sync: answer(LeagueSync.self, "sync", scene.clock), box: answer(MatchupBox.self, "matchup", scene.clock)
        )
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("matchup-snapshots-\(UUID().uuidString)"))
        let viewModel = MatchupViewModel(
            api: stub, cache: cache, clock: FixedClock(instant(scene.clock)), zone: zone
        )
        await viewModel.load(leagueID: league)
        if scene == .stale {
            await stub.dropSignal()
            await viewModel.load(leagueID: league)
        }
        return viewModel
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = try await viewModel(item.scene)
        guard case let .loaded(.week(week), _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        return MatchupMock(week: week, stamp: viewModel.stampWords, part: item.part, device: item.device)
    }

    @Test(arguments: 0 ..< cases.count)
    func matchup(index: Int) async throws {
        let item = Self.cases[index]
        let name = "matchup-\(item.scene.rawValue)-\(item.part.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// A part of the screen as the mock draws it. The phone's first screen is the room between the top
/// bar and the tab bar (the app draws both natively).
struct MatchupMock: View {
    let week: MatchupWeek
    let stamp: String?
    let part: MatchupSnapshotTests.Part
    let device: SnapshotDevice

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        switch part {
        case .phone:
            MatchupPartView(part: .mine, week: week, stamp: stamp, actions: .init(open: { _ in }))
                .padding(.top, Tokens.Space.s4)
                .frame(height: room, alignment: .top)
                .clipped()
        case .mine:
            MatchupPartView(part: .mine, week: week, stamp: stamp, actions: .init(open: { _ in }))
                .padding(.vertical, Tokens.Space.s4)
        case .theirs:
            MatchupPartView(part: .theirs, week: week, stamp: stamp, actions: .init(open: { _ in }))
                .padding(.vertical, Tokens.Space.s4)
        }
    }
}

/// The Matchup's two reads as the fixture answers them at a clock, or no signal.
actor StubMatchup: MatchupAPI {
    let sync: LeagueSync
    let box: MatchupBox
    private var offline = false

    init(sync: LeagueSync, box: MatchupBox) {
        self.sync = sync
        self.box = box
    }

    func dropSignal() {
        offline = true
    }

    func leagueSync(id _: String) async throws -> LeagueSync {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return sync
    }

    func matchup(id _: String) async throws -> MatchupBox? {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return box
    }
}
