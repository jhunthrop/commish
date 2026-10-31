import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
import SwiftUI
import Testing
@testable import Waivers

/// The Waivers screen's mock: both themes, iPhone 17 Pro and iPhone SE, at 1x, each state the view
/// model's over the shared fixtures through a stub of the API. The table before the wire clears (the
/// FFPC stand-in at Saturday noon, its verb the platform's page): the phone's first screen with the
/// verb pinned, then the strip with the rows that gain, then the rest with the basis. An add's drop
/// panel open on ESPN with the pair pinned. The claim on the ESPN stand-ins: confirmed with its bid in
/// waiver dollars (FAAB), pending with the time ESPN runs it, refused in ESPN's own words, done. And a
/// saved read with no signal, the verb disabled with its stamp. The position cards as the navigation
/// (Lane 308, the web's Lane 305): the landing on the weakest Need (TE) with the member's tight ends over
/// the free ones, the D/ST card on Rest of season (this week's Proj), This week, and All. With
/// SNAPSHOT_SHOTS set each is also written at its phone's own scale for the persona panel.
@MainActor
struct WaiverSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let inseason = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason").standardized
    nonisolated static let ffpc = "6f1d1c52-2626-4a26-9a26-000000000026"
    nonisolated static let espn = (
        done: "6f1d1c52-2626-4a26-9a26-000000000035",
        refused: "6f1d1c52-2626-4a26-9a26-000000000036",
        pending: "6f1d1c52-2626-4a26-9a26-000000000037"
    )
    static let clock = "2026-10-17T17-00-00Z"
    static let zone = TimeZone(identifier: "America/Chicago")!

    enum Scene: String, CaseIterable, Sendable {
        case before
        case drops
        case faab
        case pending
        case refused
        case done
        case stale
        /// The D/ST card chosen: no rest-of-season order, so its card ranks this week's Proj; the defenses' own
        /// read under the page's strip.
        case narrowed
        /// The table sorted by name, A to Z, its head lit with the caret.
        case sorted
        /// A wide receiver past the page's rows reached: the WR card's read, his name searched.
        case reach
        /// The toggle on This week on the landing's TE card: every card on the week, the list by Proj.
        case week
        /// The All card: every free agent, no player of the member's.
        case all

        var parts: [Part] {
            switch self {
            case .before: [.phone, .top, .foot]
            case .narrowed, .sorted, .week, .all: [.top]
            case .reach: [.top, .foot]
            case .drops: [.panel, .pin]
            case .faab, .pending, .refused, .done: [.pin]
            case .stale: [.phone]
            }
        }

        var league: String {
            switch self {
            case .before, .narrowed, .sorted, .reach, .week, .all: WaiverSnapshotTests.ffpc
            case .refused: WaiverSnapshotTests.espn.refused
            case .done: WaiverSnapshotTests.espn.done
            default: WaiverSnapshotTests.espn.pending
            }
        }
    }

    enum Part: String, Sendable {
        /// The phone's first screen: the strip and the top of the table with the verb pinned above the bar.
        case phone
        case top
        /// The open row and its drop panel under the heads.
        case panel
        case foot
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

    static func answer<T: Decodable>(_ type: T.Type, _ file: String) throws -> T {
        try APIDecoding.envelopeData(type, from: Data(contentsOf: inseason.appendingPathComponent(file)))
    }

    static var now: Date {
        APIDecoding.parseDate(clock.replacingOccurrences(
            of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
        ))!
    }

    /// The view model at the scene's state, through the stub: loaded, saved with no signal, a row's drop
    /// panel open, or the claim pressed, planned and made.
    static func viewModel(_ scene: Scene) async throws -> WaiverViewModel {
        let league = scene.league
        var advice = try answer(WaiverAdvice.self, "waivers-\(league)-\(clock).json")
        let full = advice
        let isReceiver = { (row: WaiverRow) in row.add.player.position == "WR" }
        if scene == .reach, let first = advice.rows.first(where: isReceiver) {
            // The page as the API's first rows leave a deep pool: one wide receiver of the eleven.
            advice.rows = full.rows.filter { !isReceiver($0) || $0 == first }
        }
        var receivers = full
        receivers.rows = full.rows.filter(isReceiver)
        receivers.pickups = full.pickups.filter(isReceiver)
        let espn = league != ffpc
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("waiver-snapshots-\(UUID().uuidString)"))
        if scene == .stale {
            await cache.write(advice, route: WaiverViewModel.route(league), stamp: now)
        }
        let stub = try StubWaivers(
            advice: scene == .stale ? nil : advice,
            plan: espn ? answer(HostMovePlan.self, "claim-plan-\(league).json") : nil,
            result: espn ? answer(HostMoveResult.self, "claim-move-\(league).json") : nil,
            positions: espn ? [:] : [
                .def: answer(WaiverAdvice.self, "waivers-\(league)-DEF-\(clock).json"), .wr: receivers,
                .te: tightEnds(full),
            ]
        )
        let viewModel = WaiverViewModel(
            api: stub, cache: cache, clock: FixedClock(now.addingTimeInterval(scene == .stale ? 1800 : 0)),
            host: .init(value1: espn ? .espn : .ffpc), zone: zone, copy: { _ in }
        )
        await viewModel.load(leagueID: league)
        await act(scene, on: viewModel, league: league)
        return viewModel
    }

    /// The TE card's own read: the page's tight ends.
    static func tightEnds(_ full: WaiverAdvice) -> WaiverAdvice {
        var tightEnds = full
        tightEnds.rows = full.rows.filter { $0.add.player.position == "TE" }
        return tightEnds
    }

    /// The scene's state from the loaded screen: a row's drop panel open, the claim pressed, planned and
    /// made, a position chosen, a head chosen, a name searched.
    static func act(_ scene: Scene, on viewModel: WaiverViewModel, league: String) async {
        switch scene {
        case .drops:
            if case let .loaded(model, _, _) = viewModel.state, let row = model.gaining.first(where: { !$0.named }) {
                viewModel.tap(row: row.key)
            }
        case .faab:
            await viewModel.press(leagueID: league)
        case .pending, .refused, .done:
            await viewModel.press(leagueID: league)
            await viewModel.confirm(leagueID: league)
        case .narrowed:
            await viewModel.choose(nav: "DEF", leagueID: league)
        case .sorted:
            viewModel.sort(by: .name)
        case .reach:
            await viewModel.choose(nav: "WR", leagueID: league)
            viewModel.find("dotson")
        case .week:
            viewModel.choose(panelMode: .week)
        case .all:
            await viewModel.choose(nav: WaiverNav.all, leagueID: league)
        case .before, .stale:
            break
        }
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = try await viewModel(item.scene)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        return WaiverMock(
            model: model, stamp: viewModel.stampWords, pin: viewModel.pin, part: item.part, device: item.device,
            actions: TableActions(
                open: { _ in }, tap: { _ in }, chooseDrop: { _ in }, opened: viewModel.openRow,
                drops: viewModel.drops, chosenDrop: viewModel.chosenDrop,
                dropHead: viewModel.opened.map { model.dropHead($0) }, table: viewModel.table,
                sort: viewModel.sort, onSort: { _ in }, reading: viewModel.reading, compare: viewModel.compare,
                empty: viewModel.empty
            ),
            chosenCard: viewModel.card?.key,
            filters: FiltersView(query: viewModel.query, find: { _ in }, problem: viewModel.problem, still: true),
            nav: NavActions(
                cards: viewModel.nav, chosen: viewModel.navKey, mode: viewModel.panelMode,
                hasWeek: viewModel.navHasWeek, lead: viewModel.lead, choose: { _ in }, chooseMode: { _ in },
                still: true
            )
        )
    }

    @Test(arguments: 0 ..< cases.count)
    func waivers(index: Int) async throws {
        let item = Self.cases[index]
        let name = "waivers-\(item.scene.rawValue)-\(item.part.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theMockShowsTheStatesItNames() async throws {
        let faab = try await Self.viewModel(.faab)
        #expect(faab.pin.bid?.label == "Your bid in waiver dollars, $0 to $87, what your team has left")
        let pending = try await Self.viewModel(.pending)
        #expect(pending.pin.panel?.line.hasPrefix("Claim submitted. ESPN processes it Wed 2:00 am") == true)
        let refused = try await Self.viewModel(.refused)
        #expect(refused.pin.panel?.said == "ESPN said: Player 4808766 is not a free agent.")
        let stale = try await Self.viewModel(.stale)
        #expect(stale.pin.enabled == false)
        let drops = try await Self.viewModel(.drops)
        #expect(drops.pin.pair != nil)
        let reach = try await Self.viewModel(.reach)
        #expect(reach.table.rows.map(\.cells.row.name) == ["Jahan Dotson"])
        let before = try await Self.viewModel(.before)
        #expect(before.navKey == "TE")
        #expect(before.compare?.rows.isEmpty == false)
        #expect(before.nav.first { $0.key == "TE" }?.need == true)
        let week = try await Self.viewModel(.week)
        #expect(week.panelMode == .week)
        #expect(week.lead?.head == "TE rank 12 of 12")
        let all = try await Self.viewModel(.all)
        #expect(all.compare == nil)
        let narrowed = try await Self.viewModel(.narrowed)
        #expect(narrowed.position == .def)
        #expect(narrowed.nav.first { $0.key == "DEF" }?.tag == Words.WaiverNav.weekTag)
        #expect(narrowed.table.rows.allSatisfy { $0.cells.row.position == "D/ST" })
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// A part of the screen as the mock draws it. The phone's first screen is the room between the top bar
/// and the tab bar (the app draws both natively), the screen's top with the pin over its foot.
struct WaiverMock: View {
    let model: WaiverModel
    let stamp: String?
    let pin: WaiverPin
    let part: WaiverSnapshotTests.Part
    let device: SnapshotDevice
    let actions: TableActions
    let chosenCard: String?
    let filters: FiltersView
    let nav: NavActions

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        switch part {
        case .phone:
            VStack(spacing: 0) {
                screen(.top)
                    .padding(.top, Tokens.Space.s4)
                    .frame(height: room - pinHeight, alignment: .top)
                    .clipped()
                WaiverPinView(pin: pin, actions: .none, still: true)
            }
            .frame(height: room, alignment: .top)
        case .top:
            screen(.top).padding(.vertical, Tokens.Space.s4)
        case .foot:
            screen(.foot).padding(.vertical, Tokens.Space.s4)
        case .panel:
            WaiverTableView(model: model, groups: .opened, actions: actions)
                .padding(.horizontal, Tokens.Space.s3)
                .padding(.vertical, Tokens.Space.s4)
        case .pin:
            WaiverPinView(pin: pin, actions: .none, still: true)
        }
    }

    private func screen(_ part: WaiverPart) -> WaiverPartView {
        WaiverPartView(
            part: part, model: model, stamp: stamp, chosenCard: chosenCard, chooseCard: { _ in }, actions: actions,
            filters: filters, nav: nav
        )
    }

    /// The pin's room: the verb and two lines under it.
    private var pinHeight: Double {
        pin.isEmpty ? 0 : 112
    }
}

/// The Waivers routes as the fixture answers them: the advice (or no signal), the plan with the bid
/// asked for, the make answering the fixture's outcome.
struct StubWaivers: WaiversAPI {
    let advice: WaiverAdvice?
    let plan: HostMovePlan?
    let result: HostMoveResult?
    /// Each position's own read.
    let positions: [WaiverPosition: WaiverAdvice]

    func waivers(id _: String, position: WaiverPosition?) async throws -> WaiverAdvice {
        if let position, let narrowed = positions[position] {
            return narrowed
        }
        guard let advice else {
            throw URLError(.notConnectedToInternet)
        }
        return advice
    }

    func planMove(id _: String, move: HostMoveInput) async throws -> HostMovePlan {
        guard var answer = plan else {
            throw URLError(.badServerResponse)
        }
        if var bid = answer.bid?.value1, let asked = move.claim?.value1.bid {
            bid.amount = asked
            answer.bid = .init(value1: bid)
        }
        return answer
    }

    func makeMove(id _: String, move _: HostMoveInput, confirm _: String) async throws -> HostMoveResult {
        guard let result else {
            throw URLError(.badServerResponse)
        }
        return result
    }
}
