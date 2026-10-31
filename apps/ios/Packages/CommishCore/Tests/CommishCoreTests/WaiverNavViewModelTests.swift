import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The position cards as the Waivers view model's navigation (WaiverScreen.svelte, Lane 305): the screen
/// opens on the weakest Need and reads it quietly; a card chosen reads its position, All the page's rows; the
/// toggle sets the cards and the list's order together; after a claim the chosen position is read again, and
/// until it lands the kept list never lists a player the fresher roster holds.
@MainActor
struct WaiverNavViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-waiver-nav-tests-\(UUID().uuidString)")
    static let league = WaiverViewModelTests.leagues.pending

    private func model(_ api: any WaiversAPI) -> WaiverViewModel {
        WaiverViewModel(
            api: api, cache: FileCache(folder: folder), clock: FixedClock(WaiverViewModelTests.saturday),
            host: WaiverViewModelTests.espn, zone: Fixtures.zone, copy: { _ in }
        )
    }

    static func page() throws -> WaiverAdvice {
        try Fixtures.waivers(league, Fixtures.week)
    }

    /// The page's tight ends, the TE card's own read.
    static func tightEnds(_ page: WaiverAdvice) -> WaiverAdvice {
        WaiverNav.atPosition(page, key: "TE")
    }

    @Test func theScreenOpensOnTheWeakestNeedAndReadsItQuietly() async throws {
        let page = try Self.page()
        let stub = WaiverStub(advice: page, positions: [.te: Self.tightEnds(page)])
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.league)
        #expect(viewModel.navKey == "TE")
        #expect(await stub.asked == [nil, .te])
        #expect(viewModel.reading == false)
        #expect(!viewModel.table.rows.isEmpty)
        #expect(viewModel.table.rows.allSatisfy { $0.source.add.player.position == "TE" })
        let compare = try #require(viewModel.compare)
        #expect(compare.yours == "Your TE")
        #expect(compare.free == "Free at TE")
        #expect(compare.rows.first?.role == Words.Waivers.starter)
        #expect(viewModel.lead == NavLead(head: "TE rank 9 of 12", words: Words.WaiverPanel.needSays))
        #expect(viewModel.nav.first?.key == WaiverNav.all)
        #expect(viewModel.nav.first { $0.key == "TE" }?.pickup == true)
        // The same answer again reads the position no second time.
        await viewModel.load(leagueID: Self.league)
        #expect(await stub.asked == [nil, .te, nil])
    }

    @Test func aCardChosenReadsItsPositionAndAllTheWholePage() async throws {
        let page = try Self.page()
        let stub = WaiverStub(advice: page)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.league)
        await viewModel.choose(nav: "QB", leagueID: Self.league)
        #expect(viewModel.navKey == "QB")
        #expect(await stub.asked.last == .qb)
        #expect(viewModel.compare?.yours == "Your QB")
        await viewModel.choose(nav: WaiverNav.all, leagueID: Self.league)
        #expect(viewModel.position == nil)
        #expect(viewModel.compare == nil)
        #expect(viewModel.lead == NavLead(head: Words.WaiverNav.allHead, words: Words.WaiverNav.allSays))
        #expect(viewModel.table.rows.count == page.rows.count)
        #expect(viewModel.empty == Words.Waivers.noneFound)
    }

    @Test func theToggleSetsTheCardsAndTheListsOrder() async throws {
        let stub = try WaiverStub(advice: Self.page())
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.league)
        #expect(viewModel.navHasWeek)
        viewModel.choose(panelMode: .week)
        #expect(viewModel.sort == WaiverSort(key: .proj, down: true))
        #expect(viewModel.nav.allSatisfy { !$0.need }, "the need is the rest of the season's")
        #expect(viewModel.nav.first { $0.key == "TE" }?.place == "rank 12 of 12")
        viewModel.choose(panelMode: .season)
        #expect(viewModel.sort == .initial)
    }

    @Test func afterAClaimTheListNeverListsAPlayerTheRosterNowHolds() async throws {
        let page = try Self.page()
        let stub = WaiverStub(advice: page, positions: [.te: Self.tightEnds(page)])
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.league)
        let taylor = try #require(page.pickups.first { $0.add.player.position == "TE" })
        #expect(viewModel.table.rows.contains { $0.key == taylor.add.player.hostId })
        // Claimed: the page's fresher answer has him on the roster; the TE read fails this time.
        var claimed = page
        claimed.rows.removeAll { $0.add.player.hostId == taylor.add.player.hostId }
        claimed.roster.append(taylor.add)
        claimed.readAt = page.readAt.addingTimeInterval(60)
        await stub.answer(claimed)
        await stub.failPosition()
        await viewModel.load(leagueID: Self.league)
        #expect(await stub.asked.filter { $0 == .te }.count == 2)
        #expect(!viewModel.table.rows.contains { $0.key == taylor.add.player.hostId })
        #expect(viewModel.problem == nil, "a position's own list stands, saying nothing")
        // Read again, the position's own read lands.
        await stub.failPosition(false)
        await stub.answer(Self.tightEnds(claimed), at: .te)
        await viewModel.load(leagueID: Self.league)
        #expect(await stub.asked.filter { $0 == .te }.count == 3)
        #expect(!viewModel.table.rows.contains { $0.key == taylor.add.player.hostId })
    }

    @Test func aFailedFirstReadKeepsThePagesRowsAndSaysSo() async throws {
        let page = try Self.page()
        let stub = WaiverStub(advice: page)
        await stub.failPosition()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.league)
        #expect(viewModel.problem == WaiverNav.firstRead("TE"))
        let here = Set(WaiverNav.atPosition(page, key: "TE").rows.map(WaiverRows.key))
        #expect(!here.isEmpty)
        #expect(Set(viewModel.table.rows.map(\.key)) == here)
    }
}
