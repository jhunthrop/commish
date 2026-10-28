import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Trades' view model: the saved finder at once and the API's after it; a failed read keeps the
/// finder with its stamp; the chips and the gain heads reorder it; a trade opens into its players; the
/// picker narrows to the trades holding a player read from the API; the builder from a trade or new
/// posts the check of the trade built as picks land, stands without it on an older API, and keeps the
/// finder when the check fails; the verbs copy the web's share text; a refused token signs out.
@MainActor
struct TradesViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-trades-tests-\(UUID().uuidString)")
    static let best = "8:96>7526+8116"
    static let me = TradeMe(name: "McConkey Kong Country", aside: "5-1, 2nd of 12")

    static func stub(check: Bool = true) throws -> TradesStub {
        try TradesStub(
            advice: Fixtures.trades(Fixtures.week), holding: Fixtures.tradesHolding(),
            check: check ? Fixtures.tradeCheck(Fixtures.week, 1) : nil
        )
    }

    private func model(
        _ api: any TradesAPI, cache: (any AnswerCache)? = nil,
        copy: @escaping @MainActor (String) -> Bool = { _ in true },
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> TradesViewModel {
        TradesViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: FixedClock(Fixtures.instant(Fixtures.week)),
            host: TradesParityTests.host, me: Self.me, zone: Fixtures.zone, copy: copy, onSignedOut: onSignedOut
        )
    }

    static func shown(_ viewModel: TradesViewModel) throws -> (model: TradesModel, stale: Bool) {
        guard case let .loaded(model, _, stale) = viewModel.state else {
            throw Unexpected.state("\(viewModel.state)")
        }
        return (model, stale)
    }

    enum Unexpected: Error {
        case state(String)
    }

    @Test func theFinderReadsAndIsTheWebs() async throws {
        let viewModel = try model(Self.stub())
        await viewModel.load(leagueID: Fixtures.league)
        let shown = try Self.shown(viewModel)
        #expect(!shown.stale)
        #expect(viewModel.stampWords == nil)
        #expect(shown.model.rows.first?.id == Self.best)
        #expect(shown.model.rows.count == 9)
    }

    @Test func aSavedFinderShowsAtOnceDatedThenAFailedReadKeepsIt() async throws {
        let stub = try Self.stub()
        let cache = FileCache(folder: folder)
        let first = model(stub, cache: cache)
        await first.load(leagueID: Fixtures.league)
        await stub.fail(URLError(.notConnectedToInternet))
        let second = model(stub, cache: cache)
        await second.load(leagueID: Fixtures.league)
        let shown = try Self.shown(second)
        #expect(shown.stale)
        #expect(second.stampWords == "Last read Sat 12:00 pm")
        #expect(shown.model.rows.first?.id == Self.best)
    }

    @Test func aFirstReadThatFailsSaysWhy() async throws {
        let stub = try Self.stub()
        await stub.fail(URLError(.notConnectedToInternet))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func everyTradeAndTheirGainReorderTheFinder() async throws {
        let viewModel = try model(Self.stub())
        await viewModel.load(leagueID: Fixtures.league)
        let web = try #require(TradesParityTests.parity.clocks[Fixtures.week])
        viewModel.showEvery(true)
        viewModel.sort(by: .theirs)
        #expect(try Self.shown(viewModel).model.rows.map(\.id) == web.finder.every["theirs"]?.map(\.key))
        viewModel.showEvery(false)
        #expect(try Self.shown(viewModel).model.rows.map(\.id) == web.finder.best["theirs"]?.map(\.key))
    }

    @Test func aTradeOpensIntoItsPlayersAndTheBasisSaysTheirColumns() async throws {
        let viewModel = try model(Self.stub())
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.shownOpen == .none)
        viewModel.toggle(Self.best)
        #expect(viewModel.opened == [Self.best])
        #expect(viewModel.shownOpen == .trade)
        viewModel.toggle(Self.best)
        #expect(viewModel.opened.isEmpty)
    }

    @Test func thePickerReadsTheTradesHoldingAPlayerAndEveryTradeAgain() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.pick("8439", leagueID: Fixtures.league)
        let web = TradesBuilderParityTests.parity.holding
        #expect(try Self.shown(viewModel).model.rows.map(\.id) == web.rows.map(\.key))
        #expect(try Self.shown(viewModel).model.picker.label == "Aaron Rodgers")
        #expect(await stub.reads == [nil, "8439"])
        await viewModel.pick(nil, leagueID: Fixtures.league)
        #expect(try Self.shown(viewModel).model.rows.count == 9)
        #expect(await stub.reads.count == 2)
    }

    @Test func aPlayerOurBoardDoesNotPlaceIsInNoTradeAndIsNotRead() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        let unplaced = try #require(Self.shown(viewModel).model.picker.yours
            .first { $0.id.hasPrefix(TradeFinder.unplaced) })
        await viewModel.pick(unplaced.id, leagueID: Fixtures.league)
        let shown = try Self.shown(viewModel).model
        #expect(shown.noneHolding)
        #expect(shown.decision == "No trade we found includes \(unplaced.name).")
        #expect(await stub.reads == [nil])
    }

    @Test func aHoldingReadWithNoSignalKeepsTheRowsWithTheWebsLine() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await stub.fail(URLError(.notConnectedToInternet))
        await viewModel.pick("8439", leagueID: Fixtures.league)
        #expect(viewModel.problem == Words.InSeason.narrowingUnread)
        #expect(!viewModel.narrowing)
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
    }

    @Test func buildFromThisPostsTheTradeAndDrawsBothLineups() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.build(from: Self.best, leagueID: Fixtures.league)
        #expect(await stub.checked == [TradeCheckInput(team: 8, give: ["96"], get: ["7526", "8116"])])
        let builder = try #require(viewModel.builder)
        // The best trade moves Waddle, whose Thursday game is final: no change this week (heldCheck).
        #expect(builder.bug.yours.figures.projBefore == Words.Box.none)
        #expect(builder.bug.yours.figures.seasonAfter == "7.3")
        #expect(builder.bug.theirs.name == "Max_Jensen10")
        #expect(builder.yours.aside == "5-1, 2nd of 12")
        #expect(builder.sentence == TradesBuilderParityTests.parity.builder.sentence)
        #expect(viewModel.shownOpen == .builder)
        viewModel.pressBuilder()
        let web = try #require(TradesParityTests.parity.clocks[Fixtures.week]?.finder.best["mine"]?.first)
        #expect(viewModel.builderCopied?.words == TradesParityTests.parity.copied.done)
        #expect(web.offer.hasPrefix("Trade with Max_Jensen10"))
    }

    @Test func buildATradeAsksForBothSidesThenChecksAsPicksLand() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        viewModel.buildNew()
        let opening = try #require(viewModel.builder)
        #expect(opening.sentence == Words.Builder.pickBoth)
        #expect(opening.quiet)
        #expect(opening.bug.yours.figures.projBefore == Words.Box.none)
        #expect(!opening.verbEnabled)
        await viewModel.choose(team: 8, leagueID: Fixtures.league)
        await viewModel.tap(.give, player: "96", leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.Builder.pickTheirs)
        #expect(await stub.checked.isEmpty)
        await viewModel.tap(.get, player: "12481", leagueID: Fixtures.league)
        #expect(await stub.checked == [TradeCheckInput(team: 8, give: ["96"], get: ["12481"])])
        #expect(viewModel.builder?.verbEnabled == true)
        await viewModel.tap(.get, player: "12481", leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.Builder.pickTheirs)
        viewModel.closeBuilder()
        #expect(viewModel.builder == nil)
    }

    @Test func aThirdPickWaitsForOnePutBack() {
        let picks = TradePicks(team: 8, give: ["a", "b"], get: [])
        #expect(picks.tapped(.give, "c") == picks)
        #expect(picks.tapped(.give, "a") == TradePicks(team: 8, give: ["b"], get: []))
    }

    @Test func anAPIOlderThanTheCheckLeavesTheBuilderWithTheWebsLine() async throws {
        let viewModel = try model(Self.stub(check: false))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.build(from: Self.best, leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.InSeason.narrowingUnread)
        #expect(try !Self.shown(viewModel).stale)
    }

    @Test func aCheckWithNoSignalKeepsTheFinderWithItsStampAndAsksAgainOnTheNextPick() async throws {
        let stub = try Self.stub()
        await stub.failCheck(URLError(.notConnectedToInternet))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.build(from: Self.best, leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.InSeason.narrowingUnread)
        let shown = try Self.shown(viewModel)
        #expect(shown.stale)
        #expect(shown.model.rows.first?.id == Self.best)
        await stub.failCheck(nil)
        await viewModel.tap(.get, player: "8116", leagueID: Fixtures.league)
        await viewModel.tap(.get, player: "8116", leagueID: Fixtures.league)
        #expect(viewModel.builder?.verbEnabled == true)
    }

    /// Review L1: an API refusal says the API's sentence and does not date a fresh finder.
    @Test func aCheckTheAPIRefusesSaysTheAPIsSentenceAndLeavesTheFinderFresh() async throws {
        let stub = try Self.stub()
        await stub.failCheck(APIError.envelope(code: "invalid", message: "Josh Allen is not on your roster."))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.build(from: Self.best, leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == "Josh Allen is not on your roster.")
        #expect(try !Self.shown(viewModel).stale)
        #expect(viewModel.stampWords == nil)
    }

    @Test func theVerbCopiesTheWebsShareTextAndSaysWhereToProposeIt() async throws {
        var copied: [String] = []
        let viewModel = try model(Self.stub(), copy: { text in
            copied.append(text)
            return true
        })
        await viewModel.load(leagueID: Fixtures.league)
        viewModel.press(Self.best)
        let web = try #require(TradesParityTests.parity.clocks[Fixtures.week]?.finder.best["mine"]?.first)
        #expect(copied == [web.offer])
        #expect(viewModel.copied[Self.best]?.words == TradesParityTests.parity.copied.done)
    }

    @Test func aCopyThatDidNotTakeSaysSo() async throws {
        let viewModel = try model(Self.stub(), copy: { _ in false })
        await viewModel.load(leagueID: Fixtures.league)
        viewModel.press(Self.best)
        #expect(viewModel.copied[Self.best]?.words == TradesParityTests.parity.copied.failed)
    }

    @Test func aRefusedTokenSignsOut() async throws {
        let stub = try Self.stub()
        await stub.fail(APIError.status(401))
        var signedOut = false
        let viewModel = model(stub, onSignedOut: { signedOut = true })
        await viewModel.load(leagueID: Fixtures.league)
        #expect(signedOut)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
    }

    @Test func anOpenedTradesRowsOpenThePlayerSheetByTheirIDs() throws {
        let model = try TradesParityTests.model(Fixtures.week)
        let ids = model.sheetPlayers.map(\.id)
        #expect(ids.contains("96"))
        #expect(ids.contains("7526"))
        // A player the site has no page for (no slug) opens no sheet, as the web's row draws no link.
        #expect(!ids.contains("8116"))
    }

    @Test func onSundayAfternoonTheTradesMovingPlayersInPlayDrawNoWeek() throws {
        let model = try TradesParityTests.model(Fixtures.sunday)
        let best = try #require(model.rows.first { $0.id == Self.best })
        #expect(best.opened.week == nil)
    }

    @Test func theMemberIsYouWhereTheSavedLeagueKeptNoTeam() {
        let league = FollowedLeague(
            id: "l", name: "L", host: TradesParityTests.host, scoring: nil, format: nil, phase: nil, draftAt: nil,
            waiversOpen: true
        )
        #expect(TradeMe(league: league) == TradeMe(name: Words.Box.you, aside: ""))
    }

    /// next-week.ts arrivesPart: before the week's projection is read, the basis says the day it
    /// arrives in place of what Proj is.
    @Test func beforeTheProjectionIsReadTheBasisSaysTheDayItArrives() throws {
        var advice = try Fixtures.trades(Fixtures.week)
        advice.projectionReadAt = nil
        advice.projectionArrivesAt = Fixtures.instant("2026-10-15T17-00-00Z")
        let model = TradesModel(
            advice: advice, host: TradesParityTests.host, me: "", every: false, sort: .mine,
            now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(model.basis(.none).contains("Week 6 projections expected Thursday."))
        #expect(!model.basis(.none).contains("published projection"))
    }
}
