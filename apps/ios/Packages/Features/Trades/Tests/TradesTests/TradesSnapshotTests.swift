import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
import SwiftUI
import Testing
@testable import Trades

/// The Trades' mock, builder-first (Lane 289 after the web's Lanes 260, 268 and 277): the fixture
/// league's trades, both themes, iPhone 17 Pro and iPhone SE, at 1x. The screen as it opens on Saturday
/// noon (the phone's first screen between the top bar and the tab bar with the pin over it, and the
/// verdict before a tick); the Best idea loaded (the first screen with its ticks, the verdict and the
/// pin, their roster from the switch); every idea shown; an idea they would not take (the refusal in the
/// answer line and the pin); a saved read whose check found no signal (the stamp, the web's line); and
/// Sunday afternoon, the trade's players in play (no week, "--" in the Proj cells, the member's roster
/// with its drop). Each state is the view model's, read from the shared fixtures through a stub of the
/// API. Long team names on both sides (review M2) draw whole: the member's head, the Best card's "With"
/// line, the team choice and the verdict's rows. The needs scene (Lane 290) reads the answer with the
/// finder's newer fields: the host's offers heading the row, each idea's fills line and each empty team's
/// reason, every place shown and the first screen; the long scene reads it too, so a long-named team's
/// offer card heads its row. With SNAPSHOT_SHOTS set each is also written at its phone's own scale
/// for the persona panel.
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
    /// The long scene's names, each past what one line of its place holds on a phone.
    static let longMe = TradeMe(name: "McConkey Kong Country Club and Grill", aside: "1-4, 11th of 12")
    static let longTeam = "Max_Jensen10 and the Sunday Afternoon Regulars"
    /// The long scene's offering team (Muttdogs, roster 10), renamed long.
    static let longOffer = "Muttdogs of the Thursday Night Waiver Wire Club"

    /// The fixture's trades, with the best idea's team and the offering team renamed long in the long
    /// scene.
    static func advice(_ scene: Scene) throws -> TradeAdvice {
        var advice = try answer(TradeAdvice.self, "trades-\(league)-\(scene.file).json")
        if scene == .long {
            let names = [8: longTeam, 10: longOffer]
            advice.teams = advice.teams.map { team in
                var team = team
                team.name = names[team.rosterId] ?? team.name
                return team
            }
        }
        return advice
    }

    enum Scene: String, CaseIterable, Sendable {
        case open
        case idea
        case ideas
        case refused
        case stale
        case sunday
        /// Long team names on both sides (review M2) and on an offer card: every name drawn whole.
        case long
        /// The finder's newer fields (Lane 290): offers, fills lines, the empty teams' reasons.
        case needs

        var clock: String {
            self == .sunday ? "2026-10-18T18-56-00Z" : "2026-10-17T17-00-00Z"
        }

        /// The answer's file: the needs answer for the scenes that draw its fields.
        var file: String {
            self == .needs || self == .long ? "needs-\(clock)" : clock
        }

        var parts: [Part] {
            switch self {
            case .open: [.screen, .verdict]
            case .idea: [.screen, .verdict, .theirs]
            case .ideas: [.ideas]
            case .refused, .stale: [.verdict]
            case .sunday: [.verdict, .yours]
            case .long: [.screen, .verdict, .theirs]
            case .needs: [.screen, .ideas]
            }
        }
    }

    enum Part: String, Sendable {
        /// The phone's first screen: the ideas, the switch and the roster shown, the pin over its foot.
        case screen
        /// Every idea in place.
        case ideas
        /// The verdict and its lines, the pin under them.
        case verdict
        /// Each roster whole, with its ticks.
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

    /// The fixture's check, or one they would not take on their rest of season (Lane 277).
    static func check(_ scene: Scene) throws -> TradeCheck {
        var check = try answer(TradeCheck.self, "trade-check-\(league)-\(scene.clock)-1.json")
        if scene == .refused {
            check.acceptable = .init(value1: .init(yours: true, theirs: false))
            var trade = check.trade.value1
            trade.myRestOfSeason = 21.6
            trade.theirRestOfSeason = -21.6
            check.trade = .init(value1: trade)
        }
        return check
    }

    /// The view model at the scene's state, through the stub.
    static func viewModel(_ scene: Scene) async throws -> TradesViewModel {
        let stub = try StubTrades(advice: advice(scene), check: check(scene))
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("trades-snapshots-\(UUID().uuidString)"))
        let viewModel = TradesViewModel(
            api: stub, cache: cache, clock: FixedClock(instant(scene.clock)), host: host,
            me: scene == .long ? longMe : me, zone: zone,
            copy: { _ in true }
        )
        await viewModel.load(leagueID: league)
        if scene == .stale {
            await stub.dropSignal()
            await viewModel.load(leagueID: league)
        }
        if ![.open, .ideas, .needs].contains(scene) {
            await viewModel.load(idea: best, leagueID: league)
        }
        if scene == .ideas || scene == .needs {
            viewModel.showAllIdeas()
        }
        return viewModel
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = try await viewModel(item.scene)
        guard case let .loaded(model, _, _) = viewModel.state, let builder = viewModel.builder else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        let drawn: TradePicks.Side = item.part == .theirs ? .get : .give
        let shown = TradesShown(builder: builder, drawn: drawn, checking: viewModel.checking)
        return TradesMock(model: model, stamp: viewModel.stampWords, shown: shown, part: item.part, device: item.device)
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

    @Test func theRefusedSceneSaysWhyInThePin() async throws {
        let viewModel = try await Self.viewModel(.refused)
        #expect(viewModel.builder?.pin == .words(Words.Trades.theyGiveUp))
        #expect(viewModel.builder?.bug.theirs.rest.refuses == true)
    }

    /// The needs scene draws the three offers first (newest, then Best, then the rest) and every empty
    /// team's line by its reason; the long scene's row is headed by the long-named team's offer.
    @Test func theNeedsSceneDrawsTheOffersAndTheReasons() async throws {
        let builder = try #require(try await Self.viewModel(.needs).builder)
        let ids = builder.ideas.map(\.id)
        #expect(ids.prefix(2) == ["offer:fixture-offer-1", Self.best])
        let notes = builder.ideas.compactMap { place -> String? in
            if case let .none(line) = place {
                return line.note
            }
            return nil
        }
        #expect(Set(notes) == [
            Words.Trades.noIdea, Words.Trades.sameNeed, Words.Trades.noNeed, Words.Trades.nothingFound,
        ])
        let long = try #require(try await Self.viewModel(.long).builder)
        guard case let .offer(offer) = long.ideas.first else {
            throw SceneError.notLoaded("long offer")
        }
        #expect(offer.team == Self.longOffer)
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
        case .screen:
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                TradesTop(stamp: stamp, shown: shown, actions: TradeActions(), still: true)
                BuilderBoxView(shown: shown, actions: TradeActions())
            }
            .padding(Tokens.Space.s3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: room, maxHeight: room, alignment: .top)
            .overlay(alignment: .bottom) { pin }
            .clipped()
        case .ideas:
            TradesTop(stamp: stamp, shown: shown, actions: TradeActions(), still: true)
                .padding(Tokens.Space.s3)
        case .verdict:
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                if let stamp {
                    StampText(stamp)
                }
                VerdictView(builder: shown.builder, checking: shown.checking)
                pin.clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            }
            .padding(Tokens.Space.s3)
        case .yours, .theirs:
            BuilderBoxView(shown: shown, actions: TradeActions())
                .padding(Tokens.Space.s3)
        }
    }

    private var pin: some View {
        BuilderPin(
            builder: shown.builder, verb: model.verb, page: model.page, checking: shown.checking, copied: nil,
            shared: nil, actions: TradeActions()
        )
    }
}

/// The trades and the check as the fixture answers them at a clock, or no signal.
actor StubTrades: TradesAPI {
    let advice: TradeAdvice
    let check: TradeCheck
    private var offline = false

    init(advice: TradeAdvice, check: TradeCheck) {
        self.advice = advice
        self.check = check
    }

    func dropSignal() {
        offline = true
    }

    func trades(id _: String, player _: String?) async throws -> TradeAdvice {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return advice
    }

    func checkTrade(id _: String, trade _: TradeCheckInput) async throws -> TradeCheck? {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return check
    }
}
