import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The position panel's controls on the Waivers view model: the toggle and a card opened and closed, and
/// a free agent's Add through the screen's one verb with the advice's drop (the claim planned where it is
/// made here, else his name copied and the platform's page opened), as WaiverScreen.svelte addFromPanel.
@MainActor
struct WaiverPanelViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-waiver-panel-tests-\(UUID().uuidString)")
    static let pending = WaiverViewModelTests.leagues.pending

    private func model(
        _ api: any WaiversAPI, host: Components.Schemas.LeagueHost = WaiverViewModelTests.espn,
        copy: @escaping @MainActor (String) -> Void = { _ in }
    ) -> WaiverViewModel {
        WaiverViewModel(
            api: api, cache: FileCache(folder: folder), clock: FixedClock(WaiverViewModelTests.saturday),
            host: host, zone: Fixtures.zone, copy: copy
        )
    }

    /// The ESPN stand-in with the strip's first pickup listed as a card's one free agent, so his Add is a
    /// claim made here (the fixture's own free agents carry board ids alone).
    static func claimable() throws -> (advice: WaiverAdvice, pickup: WaiverRow) {
        var advice = try Fixtures.waivers(pending, Fixtures.week)
        let pickup = try #require(advice.pickups.first)
        var cards = try #require(advice.positions)
        cards[0].available = [.init(row: pickup, restOfSeasonPoints: 100)]
        advice.positions = cards
        return (advice, pickup)
    }

    @Test func theToggleAndACardOpenAndClose() async throws {
        let stub = try WaiverViewModelTests.stub(Self.pending)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.pending)
        #expect(viewModel.panelMode == .season)
        #expect(viewModel.panelHasWeek)
        let first = try #require(viewModel.panel.first)
        #expect(viewModel.openedCard == nil)
        viewModel.toggle(card: first.key)
        #expect(viewModel.openedCard?.key == first.key)
        viewModel.choose(panelMode: .week)
        #expect(viewModel.openedCard?.key == first.key, "the open card stays open across the toggle")
        #expect(viewModel.panel.allSatisfy { !$0.need }, "the need is the rest of the season's")
        viewModel.toggle(card: first.key)
        #expect(viewModel.openedCard == nil)
    }

    @Test func anAddMadeHereIsClaimedWithTheAdvicesDrop() async throws {
        let (advice, pickup) = try Self.claimable()
        let stub = try WaiverStub(
            advice: advice,
            plan: Fixtures.claim(HostMovePlan.self, "claim-plan-\(Self.pending).json"),
            result: Fixtures.claim(HostMoveResult.self, "claim-move-\(Self.pending).json")
        )
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.pending)
        let screen = try #require(viewModel.model)
        let entry = try #require(viewModel.panel.first?.free.first)
        #expect(entry.pool?.source == pickup)
        #expect(screen.panelVerb(pickup) == "Add on ESPN")
        try await viewModel.addFromPanel(#require(entry.pool).source, leagueID: Self.pending)
        let claim = await stub.planned.first?.claim?.value1
        #expect(claim?.add == pickup.add.player.hostId)
        #expect(claim?.drop == screen.drops(pickup).first?.key)
        #expect(viewModel.step != .closed)
    }

    @Test func anAddNotMadeHereCopiesHisNameForThePlatformsPage() async throws {
        var copies: [String] = []
        let stub = try WaiverViewModelTests.stub(Self.pending)
        let viewModel = model(stub, copy: { copies.append($0) })
        await viewModel.load(leagueID: Self.pending)
        let entry = try #require(viewModel.panel.flatMap(\.free).first)
        let source = try #require(entry.pool).source
        await viewModel.addFromPanel(source, leagueID: Self.pending)
        #expect(copies == [source.add.player.name])
        #expect(await stub.planned.isEmpty)
        #expect(viewModel.pin.foot.first?.first?.text.hasPrefix("Copied") == true)
    }

    @Test func anAnswerWithoutThePanelDrawsNone() async throws {
        var advice = try Fixtures.waivers(Self.pending, Fixtures.week)
        advice.positions = nil
        let viewModel = model(WaiverStub(advice: advice))
        await viewModel.load(leagueID: Self.pending)
        #expect(viewModel.panel.isEmpty)
        #expect(!viewModel.panelHasWeek)
    }
}
