import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Start
import SwiftUI
import Testing

/// The Start screen's mock: the fixture league's lineup at its clocks, both themes, iPhone 17 Pro and
/// iPhone SE, at 1x. Before kickoff with the swaps offered (Saturday), during the games with kicked-off
/// lines and their changes held (Sunday 18:56Z), held once every starter has kicked off (Monday night,
/// Locked), and a saved read with no signal (the verb disabled with its stamp), each as the phone's
/// first screen with the verb pinned, then its lineup and its bench in full; and the move's
/// confirmation and its outcomes on ESPN, the pin alone. Each state is the view model's, read from the
/// shared fixtures through a stub of the API. With SNAPSHOT_SHOTS set each is also written at its
/// phone's own scale for the persona panel.
@MainActor
struct StartSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let inseason = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason").standardized
    static let league = "6f1d1c52-2626-4a26-9a26-000000000026"
    static let zone = TimeZone(identifier: "America/Chicago")!

    enum Scene: String, CaseIterable, Sendable {
        case before
        case sunday
        case held
        case stale
        case moveConfirm = "move-confirm"
        case moveDone = "move-done"
        case moveRefused = "move-refused"
        case movePending = "move-pending"

        var clock: String {
            switch self {
            case .sunday: "2026-10-18T18-56-00Z"
            case .held: "2026-10-20T00-40-00Z"
            default: "2026-10-17T17-00-00Z"
            }
        }

        /// The parts a scene is drawn in: a move's states as the pin alone.
        var parts: [Part] {
            switch self {
            case .before, .sunday: [.phone, .lineup, .bench]
            case .held: [.phone, .lineup]
            case .stale: [.phone]
            case .moveConfirm, .moveDone, .moveRefused, .movePending: [.pin]
            }
        }

        /// ESPN takes the lineup from here; the fixture's FFPC league does not, so its verb copies.
        var writes: Bool {
            switch self {
            case .before, .sunday, .held: false
            default: true
            }
        }

        var outcome: HostMoveResult.OutcomePayload.Value1Payload? {
            switch self {
            case .moveDone: .done
            case .moveRefused: .refused
            case .movePending: .pending
            default: nil
            }
        }
    }

    enum Part: String, Sendable {
        /// The phone's first screen: the top of the lineup with the verb pinned above the bar.
        case phone
        case lineup
        case bench
        case pin
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

    static func lineup(_ scene: Scene) throws -> LineupAdvice {
        let data = try Data(contentsOf: inseason.appendingPathComponent("lineup-\(league)-\(scene.clock).json"))
        var advice = try APIDecoding.envelopeData(LineupAdvice.self, from: data)
        if scene.writes {
            advice.moves = .init(
                takesWrites: true, writesOn: true, reason: nil, lineup: .init(value1: .available), note: nil
            )
        }
        return advice
    }

    /// The view model at the scene's state, through the stub: loaded, saved with no signal, or the move
    /// pressed, planned and made.
    static func viewModel(_ scene: Scene) async throws -> StartViewModel {
        let advice = try lineup(scene)
        let now = instant(scene.clock)
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("start-snapshots-\(UUID().uuidString)"))
        if scene == .stale {
            await cache.write(advice, route: StartViewModel.route(league), stamp: now)
        }
        let viewModel = StartViewModel(
            api: StubLineup(advice: scene == .stale ? nil : advice, outcome: scene.outcome ?? .done),
            cache: cache, clock: FixedClock(now.addingTimeInterval(scene == .stale ? 1800 : 0)),
            host: .init(value1: scene.writes ? .espn : .ffpc), zone: zone, copy: { _ in true }
        )
        await viewModel.load(leagueID: league)
        if scene.rawValue.hasPrefix("move") {
            await viewModel.press(leagueID: league)
        }
        if scene.outcome != nil {
            await viewModel.confirm(leagueID: league)
        }
        return viewModel
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = try await viewModel(item.scene)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        return StartMock(
            model: model, stamp: viewModel.stampWords, pin: viewModel.pin, part: item.part, device: item.device
        )
    }

    @Test(arguments: 0 ..< cases.count)
    func start(index: Int) async throws {
        let item = Self.cases[index]
        let name = "start-\(item.scene.rawValue)-\(item.part.rawValue)-\(item.device.name)-\(item.scheme)"
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
/// bar and the tab bar (the app draws both natively), the lineup's top with the pin over its foot.
struct StartMock: View {
    let model: StartModel
    let stamp: String?
    let pin: StartPin
    let part: StartSnapshotTests.Part
    let device: SnapshotDevice

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        switch part {
        case .phone:
            VStack(spacing: 0) {
                StartPartView(part: .lineup, model: model, stamp: stamp, actions: actions)
                    .padding(.top, Tokens.Space.s4)
                    .frame(height: room - pinHeight, alignment: .top)
                    .clipped()
                PinView(pin: pin, actions: PinActions(press: {}, confirm: {}, close: {}))
            }
            .frame(height: room, alignment: .top)
        case .lineup:
            StartPartView(part: .lineup, model: model, stamp: stamp, actions: actions)
                .padding(.vertical, Tokens.Space.s4)
        case .bench:
            StartPartView(part: .bench, model: model, stamp: stamp, actions: actions)
                .padding(.vertical, Tokens.Space.s4)
        case .pin:
            PinView(pin: pin, actions: PinActions(press: {}, confirm: {}, close: {}))
        }
    }

    /// The pin's room: the verb and two lines under it.
    private var pinHeight: Double {
        pin.isEmpty ? 0 : 112
    }

    private var actions: RowActions {
        RowActions(open: { _ in }, toggleWhy: { _ in }, opened: [])
    }
}

/// The lineup route as the fixture answers it: the advice (or no signal), the plan ready with its
/// token, the make answering the outcome given.
struct StubLineup: LineupAPI {
    let advice: LineupAdvice?
    let outcome: HostMoveResult.OutcomePayload.Value1Payload

    func lineup(id _: String) async throws -> LineupAdvice {
        guard let advice else {
            throw URLError(.notConnectedToInternet)
        }
        return advice
    }

    func planMove(id _: String, move _: HostMoveInput) async throws -> HostMovePlan {
        HostMovePlan(
            status: .init(value1: .ready),
            sentence: "Start Patrick Mahomes over Aaron Rodgers at QB, Travis Etienne over Ja'Marr Chase in the "
                + "flex, and Houston Texans over Minnesota Vikings at DEF, on ESPN now.",
            confirm: "tok-1", expiresAt: nil, hostUrl: "https://fantasy.espn.com/football/team", bid: nil
        )
    }

    func makeMove(id _: String, move _: HostMoveInput, confirm _: String) async throws -> HostMoveResult {
        let sentence = switch outcome {
        case .refused: "ESPN did not take the move, and nothing changed."
        case .pending: "We sent it, and ESPN has not shown it yet. Check your lineup on ESPN."
        default: "Your lineup is set on ESPN."
        }
        return HostMoveResult(
            outcome: .init(value1: outcome), sentence: sentence,
            hostWords: outcome == .refused ? "Lineup transaction could not be completed, Patrick Mahomes is locked"
                : nil,
            hostUrl: "https://fantasy.espn.com/football/team", moveId: nil, processesAt: nil
        )
    }
}
