import CommishAPI
@testable import CommishCore
import Foundation
import OpenAPIRuntime
import Testing

/// The Waivers view model: the saved answer then the API's; the verb disabled with the stamp's reason when
/// the answer shown is a saved read (Review Focus 2, over the generated client and a throwing transport);
/// the claim's round trip against a stub over the fixture API's own answers (plan, the bid planned again,
/// confirm, done, refused and pending); the platform's page with his name copied where the claim is not
/// made here; a row's drop panel and the pair the verb then makes.
@MainActor
struct WaiverViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-waivers-tests-\(UUID().uuidString)")
    private static let base = URL(string: "http://localhost:8080")!
    static let espn = Components.Schemas.LeagueHost(value1: .espn)
    static let ffpc = Components.Schemas.LeagueHost(value1: .ffpc)
    static let saturday = Fixtures.instant(Fixtures.week)
    static let leagues = (
        done: "6f1d1c52-2626-4a26-9a26-000000000035",
        refused: "6f1d1c52-2626-4a26-9a26-000000000036",
        pending: "6f1d1c52-2626-4a26-9a26-000000000037"
    )

    private func model(
        _ api: any WaiversAPI, host: Components.Schemas.LeagueHost = espn, cache: (any AnswerCache)? = nil,
        clock: any Clock = FixedClock(saturday), copy: @escaping @MainActor (String) -> Void = { _ in },
        openPage: @escaping @MainActor (URL) -> Void = { _ in }, onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> WaiverViewModel {
        WaiverViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: clock, host: host, zone: Fixtures.zone,
            copy: copy, openPage: openPage, onSignedOut: onSignedOut
        )
    }

    static func stub(_ league: String) throws -> WaiverStub {
        try WaiverStub(
            advice: Fixtures.waivers(league, Fixtures.week),
            plan: Fixtures.claim(HostMovePlan.self, "claim-plan-\(league).json"),
            result: Fixtures.claim(HostMoveResult.self, "claim-move-\(league).json")
        )
    }

    private func loaded(_ viewModel: WaiverViewModel) -> (WaiverModel, Bool)? {
        guard case let .loaded(model, _, stale) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return nil
        }
        return (model, stale)
    }

    // MARK: reads

    @Test func aFreshReadLoadsIsCachedAndPinsTheFirstCardsVerb() async throws {
        let stub = try Self.stub(Self.leagues.pending)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.leagues.pending)
        let (screen, stale) = try #require(loaded(viewModel))
        #expect(stale == false)
        #expect(screen.title == "Two pickups")
        #expect(viewModel.pin.verb == "Add on ESPN")
        #expect(viewModel.pin.enabled)
        let saved = await FileCache(folder: folder).read(
            WaiverAdvice.self, route: WaiverViewModel.route(Self.leagues.pending)
        )
        #expect(saved?.stamp == Self.saturday)
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let api = APIClient(client: Client(serverURL: Self.base, transport: StatusTransport(status: .unauthorized)))
        let viewModel = model(api, onSignedOut: { signedOut = true })
        await viewModel.load(leagueID: Self.leagues.pending)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
        #expect(signedOut)
    }

    // MARK: Review Focus 2: offline never pretends to claim

    @Test func aSavedAnswerShownWithNoSignalDisablesTheClaimWithItsStamp() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(
            Fixtures.waivers(Self.leagues.pending, Fixtures.week),
            route: WaiverViewModel.route(Self.leagues.pending), stamp: Self.saturday
        )
        let offline = APIClient(client: Client(
            serverURL: Self.base, transport: FailingTransport(URLError(.notConnectedToInternet))
        ))
        let viewModel = model(offline, cache: cache, clock: FixedClock(Self.saturday.addingTimeInterval(1800)))
        await viewModel.load(leagueID: Self.leagues.pending)
        let (_, stale) = try #require(loaded(viewModel))
        #expect(stale)
        #expect(viewModel.pin.verb == "Add on ESPN")
        #expect(viewModel.pin.enabled == false)
        #expect(viewModel.pin.foot.map { $0.map(\.text).joined() }
            == ["Last read Sat 12:00 pm. Pull down to read waivers again before you claim."])
        await viewModel.press(leagueID: Self.leagues.pending)
        #expect(viewModel.step == .closed)
        // A row's own pair is held the same way.
        try viewModel.tap(row: #require(viewModel.card?.key))
        #expect(viewModel.pin.enabled == false)
    }

    @Test func aSavedAnswerDisablesThePlatformsPageToo() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(
            Fixtures.waivers(Fixtures.league, Fixtures.week),
            route: WaiverViewModel.route(Fixtures.league), stamp: Self.saturday
        )
        var copies: [String] = []
        let offline = APIClient(client: Client(
            serverURL: Self.base, transport: FailingTransport(URLError(.notConnectedToInternet))
        ))
        let viewModel = model(offline, host: Self.ffpc, cache: cache, copy: {
            copies.append($0)
        })
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.pin.verb == "Open FFPC waivers")
        #expect(viewModel.pin.enabled == false)
        await viewModel.press(leagueID: Fixtures.league)
        #expect(copies.isEmpty)
    }

    // MARK: the claim's round trip

    @Test func aClaimWhereTheLeagueBidsIsPlannedAtTheLeastBidConfirmedAndPending() async throws {
        let stub = try Self.stub(Self.leagues.pending)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.leagues.pending)
        await viewModel.press(leagueID: Self.leagues.pending)
        let planned = await stub.planned
        // The first plan has no bid; it is planned again at the league's least, the bid the member sees.
        #expect(planned.map { $0.claim?.value1.bid } == [nil, 0])
        #expect(planned.first?.claim?.value1.add == "4808766")
        #expect(planned.first?.week == 6)
        let pin = viewModel.pin
        #expect(pin.verb == nil)
        #expect(pin.panel?
            .line ==
            "Add Mason Taylor, drop Jaxson Dart, bid $0. He is on waivers, so ESPN runs the claim on Wednesday.")
        #expect(pin.panel?.verb == "Claim on ESPN")
        #expect(pin.panel?.verbEnabled == true)
        #expect(pin.bid == BidField(
            label: "Your bid in waiver dollars, $0 to $87, what your team has left", typed: "0", problem: nil,
            editable: true
        ))
        await viewModel.confirm(leagueID: Self.leagues.pending)
        let made = await stub.made
        #expect(made.map(\.token) == ["fixture-token"])
        #expect(made.first?.move.claim?.value1.bid == 0)
        let queued = "Claim submitted. ESPN processes it Wed 2:00 am, "
            + "and your lineup screen will show him once it goes through."
        #expect(viewModel.pin.panel?.line == queued)
        #expect(viewModel.pin.panel?.page?.text == "Open ESPN")
        #expect(viewModel.pin.panel?.close == "Done")
        #expect(await stub.reads == 2)
        viewModel.close()
        #expect(viewModel.step == .closed)
        #expect(viewModel.pin.verb == "Add on ESPN")
    }

    @Test func aTypedBidHoldsTheVerbUntilItIsPlannedAndOneTheLeagueRefusesIsSaid() async throws {
        let stub = try Self.stub(Self.leagues.pending)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.leagues.pending)
        await viewModel.press(leagueID: Self.leagues.pending)
        viewModel.type(bid: "12")
        #expect(viewModel.pin.panel?.verbEnabled == false, "the bid typed is not the one planned")
        await viewModel.confirm(leagueID: Self.leagues.pending)
        #expect(await stub.made.isEmpty)
        await viewModel.replanBid(leagueID: Self.leagues.pending)
        #expect(await stub.planned.last?.claim?.value1.bid == 12)
        #expect(viewModel.pin.panel?.verbEnabled == true)
        viewModel.type(bid: "88")
        #expect(viewModel.pin.bid?.problem == "ESPN takes bids from $0 to $87 in this league.")
        await viewModel.replanBid(leagueID: Self.leagues.pending)
        #expect(await stub.planned.count == 3, "a bid the league refuses is never planned")
        #expect(viewModel.pin.panel?.verbEnabled == false)
    }

    @Test func aRefusedClaimSaysThePlatformsOwnWords() async throws {
        let stub = try Self.stub(Self.leagues.refused)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.leagues.refused)
        await viewModel.press(leagueID: Self.leagues.refused)
        #expect(viewModel.pin.bid == nil, "the league does not bid")
        await viewModel.confirm(leagueID: Self.leagues.refused)
        let panel = try #require(viewModel.pin.panel)
        #expect(panel.line == "ESPN did not take the claim, so nothing changed there.")
        #expect(panel.said == "ESPN said: Player 4808766 is not a free agent.")
        #expect(panel.page?.text == "Open ESPN")
        #expect(panel.verb == nil)
    }

    @Test func aDoneClaimSaysSoWithNoPage() async throws {
        let stub = try Self.stub(Self.leagues.done)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.leagues.done)
        await viewModel.press(leagueID: Self.leagues.done)
        #expect(viewModel.pin.panel?.line
            == "Add Mason Taylor, drop Jaxson Dart, on ESPN now. He is a free agent, so the add is made at once.")
        await viewModel.confirm(leagueID: Self.leagues.done)
        #expect(viewModel.pin.panel?.line == "Done on ESPN. He is on your roster there now.")
        #expect(viewModel.pin.panel?.page == nil)
        #expect(viewModel.pin.panel?.said == nil)
    }

    @Test func aClaimWhoseAnswerNeverCameSaysCheckTheClaims() async throws {
        let stub = try Self.stub(Self.leagues.done)
        await stub.failMake()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.leagues.done)
        await viewModel.press(leagueID: Self.leagues.done)
        await viewModel.confirm(leagueID: Self.leagues.done)
        #expect(viewModel.pin.panel?.line
            ==
            "We did not hear back, so the claim may have been made. Check your claims on ESPN before you claim again.")
        #expect(viewModel.pin.panel?.tone == .problem)
    }

    // MARK: the platform's page, the drop panel

    @Test func whereTheClaimIsNotMadeHereHisNameIsCopiedAndThePageOpened() async throws {
        var copies: [String] = []
        var opened: [URL] = []
        let stub = try WaiverStub(advice: Fixtures.waivers(Fixtures.league, Fixtures.week))
        let viewModel = model(stub, host: Self.ffpc, copy: {
            copies.append($0)
        }, openPage: { opened.append($0) })
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.pin.foot.map { $0.map(\.text).joined() }
            == ["Sleeper does not take claims from here, so add him on its waiver page."])
        await viewModel.press(leagueID: Fixtures.league)
        #expect(copies == ["Mason Taylor"])
        #expect(opened.map(\.absoluteString) == ["https://sleeper.com/leagues/1382163311038038016/players"])
        #expect(viewModel.pin.foot.map { $0.map(\.text).joined() } == ["Copied Taylor. Add him on FFPC's waiver page."])
        #expect(await stub.planned.isEmpty)
    }

    @Test func aRowsDropPanelNamesThePairTheVerbClaims() async throws {
        let stub = try Self.stub(Self.leagues.pending)
        let viewModel = model(stub)
        await viewModel.load(leagueID: Self.leagues.pending)
        let (screen, _) = try #require(loaded(viewModel))
        let row = try #require(screen.gaining.first { !$0.named })
        viewModel.tap(row: row.key)
        #expect(viewModel.opened?.key == row.key)
        let drops = viewModel.drops
        let second = try #require(drops.dropFirst().first)
        #expect(viewModel.pin.pair == screen.pairWords(row.source, drop: drops.first))
        viewModel.choose(drop: second.key)
        #expect(viewModel.pin.pair == screen.pairWords(row.source, drop: second))
        await viewModel.press(leagueID: Self.leagues.pending)
        let claim = await stub.planned.first?.claim?.value1
        #expect(claim?.add == row.source.add.player.hostId)
        #expect(claim?.drop == second.key)
        viewModel.close()
        viewModel.tap(row: row.key)
        #expect(viewModel.opened == nil, "a second tap closes the panel")
    }
}

extension WaiverViewModelTests {
    /// The FFPC stand-in's page cut to one wide receiver, as the API's first 60 rows leave the rest of a
    /// deep pool out, and the WR chip's own read holding every wide receiver (the route's position query).
    static func paged() throws -> (page: WaiverAdvice, receivers: WaiverAdvice) {
        let full = try Fixtures.waivers(Fixtures.league, Fixtures.week)
        let isReceiver = { (row: WaiverRow) in row.add.player.position == "WR" }
        let first = try #require(full.rows.first(where: isReceiver))
        var page = full
        page.rows = full.rows.filter { !isReceiver($0) || $0 == first }
        var receivers = full
        receivers.rows = full.rows.filter(isReceiver)
        receivers.pickups = full.pickups.filter(isReceiver)
        return (page, receivers)
    }

    @Test func aPlayerPastThePagesRowsIsReachedByHisPositionsChipAndTheSearch() async throws {
        let (page, receivers) = try Self.paged()
        let stub = WaiverStub(advice: page, positions: [.wr: receivers])
        let viewModel = model(stub, host: Self.ffpc)
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.table.rows.contains { $0.cells.row.name == "Jahan Dotson" } == false)
        #expect(viewModel.model?.positions.map(\.word) == ["QB", "WR", "TE", "D/ST"])
        await viewModel.choose(position: .wr, leagueID: Fixtures.league)
        #expect(await stub.asked == [nil, .te, .wr], "the screen opened on the TE Need, read quietly")
        #expect(viewModel.reading == false)
        viewModel.find("dotson")
        let found = viewModel.table.rows
        #expect(found.map(\.cells.row.name) == ["Jahan Dotson"])
        try viewModel.tap(row: #require(found.first?.key))
        #expect(viewModel.pin.verb == "Open FFPC waivers")
        // The strip stays the page's: its cards and sum are the API's for every position.
        #expect(viewModel.model?.title == "Two pickups")
        await viewModel.choose(position: nil, leagueID: Fixtures.league)
        viewModel.find("")
        #expect(viewModel.table.rows.count == page.rows.count)
    }

    @Test func aPositionThatCannotBeReadSaysSoAndTheLastReadStands() async throws {
        let page = try Fixtures.waivers(Fixtures.league, Fixtures.week)
        let stub = WaiverStub(advice: page)
        await stub.failPosition()
        let viewModel = model(stub, host: Self.ffpc)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.choose(position: .qb, leagueID: Fixtures.league)
        #expect(viewModel.problem == "These could not be read just now. The last read stands.")
        #expect(viewModel.reading == false)
        // The page's own quarterbacks stand.
        #expect(viewModel.table.rows.count == page.rows.count { $0.add.player.position == "QB" })
    }

    @Test func aHeadChosenSortsTheTableAndTurnsAroundWhenChosenAgain() async throws {
        let stub = try WaiverStub(advice: Fixtures.waivers(Fixtures.league, Fixtures.week))
        let viewModel = model(stub, host: Self.ffpc)
        await viewModel.load(leagueID: Fixtures.league)
        viewModel.sort(by: .name)
        #expect(viewModel.sort == WaiverSort(key: .name, down: false))
        let names = viewModel.table.gaining.map(\.cells.row.name)
        #expect(names == names.sorted())
        viewModel.sort(by: .name)
        #expect(viewModel.table.gaining.map(\.cells.row.name) == names.sorted().reversed())
        viewModel.sort(by: .proj)
        #expect(viewModel.sort == WaiverSort(key: .proj, down: true))
    }

    @Test func aStashThatOpensThePlatformsPageIsHeldOnASavedRead() async throws {
        let parity = WaiverParityTests.parity
        let advice = try WaiverParityTests.synthetic("benchOpen")
        let cache = FileCache(folder: folder)
        await cache.write(advice, route: WaiverViewModel.route(Fixtures.league), stamp: Self.saturday)
        var copies: [String] = []
        let offline = APIClient(client: Client(
            serverURL: Self.base, transport: FailingTransport(URLError(.notConnectedToInternet))
        ))
        let viewModel = model(offline, host: Self.ffpc, cache: cache, copy: { copies.append($0) })
        await viewModel.load(leagueID: Fixtures.league)
        let stash = try #require(parity.stashed["benchOpen"]?.screen.stash.first { $0.opensPage })
        viewModel.tap(row: stash.key)
        #expect(copies.isEmpty)
        #expect(viewModel.openRow == nil)
        // Read fresh, the same tap copies his name and opens the page.
        let fresh = WaiverStub(advice: advice)
        let live = model(fresh, host: Self.ffpc, copy: { copies.append($0) })
        await live.load(leagueID: Fixtures.league)
        live.tap(row: stash.key)
        #expect(copies == ["De'Von Achane"])
    }
}
