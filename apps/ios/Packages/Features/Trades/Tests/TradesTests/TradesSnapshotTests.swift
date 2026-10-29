import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
import SwiftUI
import Testing
@testable import Trades

/// The Trades' mock: the fixture league's trades, both themes, iPhone 17 Pro and iPhone SE, at 1x. The
/// finder on Saturday noon (the phone's first screen, the strip, the picker with the chips and the
/// finder, the basis); the best trade opened into its players with Build from this; the same trade's
/// verb pressed (the offer copied, the line under it); the trades holding Aaron Rodgers; the builder
/// opened from the best trade with its check (the scoreboard, the answer line, the pin, then each
/// roster with its ticks); the builder opened new (the prompt, the board at "--"); a saved finder whose
/// read and check found no signal (the stamp, the web's line in the builder); and Sunday afternoon,
/// the trade's players in play (no week, "--" on the board). Each state is the view model's, read from
/// the shared fixtures through a stub of the API. With SNAPSHOT_SHOTS set each is also written at its
/// phone's own scale for the persona panel.
@MainActor
struct TradesSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let inseason = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason").standardized
    static let league = "6f1d1c52-2626-4a26-9a26-000000000026"
    static let zone = TimeZone(identifier: "America/Chicago")!
    static let host = Components.Schemas.LeagueHost(value1: .ffpc)
    static let me = TradeMe(name: "McConkey Kong Country", aside: "1-4, 11th of 12")
    static let best = "8:96>7526+8116"
    static let rodgers = "8439"

    enum Scene: String, CaseIterable, Sendable {
        case finder
        case opened
        case copied
        case holding
        case builder
        case new
        case stale
        case sunday

        var clock: String {
            self == .sunday ? "2026-10-18T18-56-00Z" : "2026-10-17T17-00-00Z"
        }

        var parts: [Part] {
            switch self {
            case .finder: [.phone, .strip, .finder, .basis]
            case .opened, .copied: [.opened]
            case .holding: [.finder]
            case .builder: [.board, .yours, .theirs]
            case .new: [.board]
            case .stale: [.phone, .board]
            case .sunday: [.opened, .board]
            }
        }
    }

    enum Part: String, Sendable {
        /// The phone's first screen: the strip and what fits under it.
        case phone
        case strip
        case finder
        case basis
        /// The best trade's row opened: its players, Build from this, its verb.
        case opened
        /// The builder's head, its scoreboard and answer line, and the pin above the bar.
        case board
        /// The builder's rosters, each with its ticks.
        case yours
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

    static func answer<T: Decodable>(_: T.Type, _ file: String) throws -> T {
        try APIDecoding.envelopeData(T.self, from: Data(contentsOf: inseason.appendingPathComponent(file)))
    }

    /// The view model at the scene's state, through the stub.
    static func viewModel(_ scene: Scene) async throws -> TradesViewModel {
        let stub = try StubTrades(
            advice: answer(TradeAdvice.self, "trades-\(league)-\(scene.clock).json"),
            holding: answer(TradeAdvice.self, "trades-\(league)-player-\(rodgers)-2026-10-17T17-00-00Z.json"),
            check: answer(TradeCheck.self, "trade-check-\(league)-\(scene.clock)-1.json")
        )
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("trades-snapshots-\(UUID().uuidString)"))
        let viewModel = TradesViewModel(
            api: stub, cache: cache, clock: FixedClock(instant(scene.clock)), host: host, me: me, zone: zone,
            copy: { _ in true }
        )
        await viewModel.load(leagueID: league)
        if scene == .stale {
            await stub.dropSignal()
            await viewModel.load(leagueID: league)
        }
        try await act(scene, on: viewModel)
        return viewModel
    }

    /// What the member did in the scene.
    static func act(_ scene: Scene, on viewModel: TradesViewModel) async throws {
        switch scene {
        case .opened, .copied:
            viewModel.toggle(best)
            if scene == .copied {
                viewModel.press(best)
            }
        case .sunday:
            viewModel.toggle(best)
            await viewModel.build(from: best, leagueID: league)
        case .holding:
            await viewModel.pick(rodgers, leagueID: league)
        case .builder, .stale:
            await viewModel.build(from: best, leagueID: league)
        case .new:
            viewModel.buildNew()
        case .finder:
            break
        }
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = try await viewModel(item.scene)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        let shown = TradesShown(
            every: viewModel.every, sort: viewModel.sort, opened: viewModel.opened, copied: viewModel.copied,
            narrowing: viewModel.narrowing, problem: viewModel.problem, builder: viewModel.builder,
            checking: viewModel.checking, builderCopied: viewModel.builderCopied
        )
        return TradesMock(
            model: model, stamp: viewModel.stampWords, shown: shown, part: item.part, device: item.device
        )
    }

    @Test(arguments: 0 ..< cases.count)
    func trades(index: Int) async throws {
        let item = Self.cases[index]
        let name = "trades-\(item.scene.rawValue)-\(item.part.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theStaleSceneSaysItsStampAndTheBuilderTheWebsLine() async throws {
        let viewModel = try await Self.viewModel(.stale)
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
        #expect(viewModel.builder?.sentence == Words.InSeason.narrowingUnread)
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// A part of the screen as the mock draws it. The phone's first screen is the room between the top bar
/// and the tab bar (the app draws both natively).
struct TradesMock: View {
    let model: TradesModel
    let stamp: String?
    let shown: TradesShown
    let part: TradesSnapshotTests.Part
    let device: SnapshotDevice

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        switch part {
        case .phone:
            VStack(alignment: .leading, spacing: Tokens.Space.s4) {
                TradesPartView(part: .strip, model: model, stamp: stamp, shown: shown, actions: TradeActions())
                TradesPartView(part: .finder, model: model, stamp: stamp, shown: shown, actions: TradeActions())
            }
            .padding(.top, Tokens.Space.s4)
            .frame(height: room, alignment: .top)
            .clipped()
        case .strip:
            draw(.strip)
        case .finder:
            draw(.finder)
        case .basis:
            draw(.basis)
        case .opened:
            opened
        case .board, .yours, .theirs:
            builder
        }
    }

    private func draw(_ part: TradesPart) -> some View {
        TradesPartView(part: part, model: model, stamp: stamp, shown: shown, actions: TradeActions())
            .padding(.vertical, Tokens.Space.s4)
    }

    /// The opened trade alone under its row, in the finder's frame.
    @ViewBuilder
    private var opened: some View {
        if let line = model.rows.first(where: { shown.opened.contains($0.id) }) {
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                if let stamp {
                    StampText(stamp)
                }
                TableFrame {
                    FinderRowView(line: line, open: true, sort: shown.sort) {}
                    OpenedTradeView(line: line, model: model, copied: shown.copied[line.id], actions: TradeActions())
                }
            }
            .padding(Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2)
        }
    }

    /// The builder's head and board with its pin under them, or one of its rosters.
    @ViewBuilder
    private var builder: some View {
        if let builder = shown.builder {
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                switch part {
                case .yours:
                    BuilderBoxView(box: builder.yours, side: .give, actions: TradeActions())
                case .theirs:
                    if let theirs = builder.theirs {
                        BuilderBoxView(box: theirs, side: .get, actions: TradeActions())
                    }
                default:
                    if let stamp {
                        StampText(stamp)
                    }
                    BuilderBoardView(builder: builder, checking: shown.checking, actions: TradeActions())
                    BuilderPin(builder: builder, verb: model.verb, page: model.page, copied: shown.builderCopied) {}
                        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                }
            }
            .padding(Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2)
        }
    }
}

/// The finder, the trades holding a player and the check as the fixture answers them at a clock, or no
/// signal.
actor StubTrades: TradesAPI {
    let advice: TradeAdvice
    let holding: TradeAdvice
    let check: TradeCheck
    private var offline = false

    init(advice: TradeAdvice, holding: TradeAdvice, check: TradeCheck) {
        self.advice = advice
        self.holding = holding
        self.check = check
    }

    func dropSignal() {
        offline = true
    }

    func trades(id _: String, player: String?) async throws -> TradeAdvice {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return player == nil ? advice : holding
    }

    func checkTrade(id _: String, trade _: TradeCheckInput) async throws -> TradeCheck? {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return check
    }
}
