import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The fixture's trades and checks, counted; or failing as told.
actor TradesStub: TradesAPI {
    private let advice: TradeAdvice
    private let check: TradeCheck?
    private var failure: (any Error)?
    private var checkFailure: (any Error)?
    private(set) var reads = 0
    private(set) var checked: [TradeCheckInput] = []

    init(advice: TradeAdvice, check: TradeCheck?) {
        self.advice = advice
        self.check = check
    }

    func fail(_ error: (any Error)?) {
        failure = error
    }

    func failCheck(_ error: (any Error)?) {
        checkFailure = error
    }

    func trades(id _: String) async throws -> TradeAdvice {
        reads += 1
        if let failure {
            throw failure
        }
        return advice
    }

    func checkTrade(id _: String, trade: TradeCheckInput) async throws -> TradeCheck? {
        checked.append(trade)
        if let checkFailure {
            throw checkFailure
        }
        return check
    }
}

/// The Trades' view model: the saved finder at once and the API's after it; a failed read keeps the
/// finder with its stamp; the chips and the gain heads reorder it; a trade opened reads its check once,
/// stands without it where the API is older than the check, and keeps the finder with its stamp when
/// the check fails; the verb copies the web's share text; a refused token signs out.
@MainActor
struct TradesViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-trades-tests-\(UUID().uuidString)")
    static let best = "8:96>12481+8116"

    static func stub(check: Bool = true) throws -> TradesStub {
        try TradesStub(
            advice: Fixtures.trades(Fixtures.week), check: check ? Fixtures.tradeCheck(Fixtures.week, 1) : nil
        )
    }

    private func model(
        _ api: any TradesAPI, cache: (any AnswerCache)? = nil,
        copy: @escaping @MainActor (String) -> Bool = { _ in true },
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> TradesViewModel {
        TradesViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: FixedClock(Fixtures.instant(Fixtures.week)),
            host: TradesParityTests.host, me: TradesParityTests.parity.me, zone: Fixtures.zone, copy: copy,
            onSignedOut: onSignedOut
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
        #expect(shown.model.rows.count == 11)
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

    @Test func openingATradeReadsItsCheckOnceWithItsPlayers() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        #expect(viewModel.opened == [Self.best])
        guard case let .answered(bug)? = viewModel.checks[Self.best] else {
            throw Unexpected.state("\(String(describing: viewModel.checks[Self.best]))")
        }
        #expect(bug.yours.figures.projBefore == "98.9")
        #expect(bug.theirs.room == "Has room")
        #expect(await stub.checked == [TradeCheckInput(team: 8, give: ["96"], get: ["12481", "8116"])])
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        #expect(viewModel.opened.isEmpty)
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        #expect(await stub.checked.count == 1)
    }

    @Test func anAPIOlderThanTheCheckLeavesTheTradeWithoutIt() async throws {
        let viewModel = try model(Self.stub(check: false))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        #expect(viewModel.checks[Self.best] == TradeCheckState.absent)
        #expect(try !Self.shown(viewModel).stale)
    }

    @Test func aFailedCheckKeepsTheFinderWithItsStampAndReadsAgainOnTheNextOpen() async throws {
        let stub = try Self.stub()
        await stub.failCheck(URLError(.notConnectedToInternet))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        #expect(viewModel.checks[Self.best] == .failed(AppWords.Trades.checkUnread))
        let shown = try Self.shown(viewModel)
        #expect(shown.stale)
        #expect(shown.model.rows.first?.id == Self.best)
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
        await stub.failCheck(nil)
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        guard case .answered? = viewModel.checks[Self.best] else {
            throw Unexpected.state("\(String(describing: viewModel.checks[Self.best]))")
        }
    }

    @Test func aCheckTheAPIRefusesSaysTheAPIsSentence() async throws {
        let stub = try Self.stub()
        await stub.failCheck(APIError.envelope(code: "invalid", message: "Josh Allen is not on your roster."))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.toggle(Self.best, leagueID: Fixtures.league)
        #expect(viewModel.checks[Self.best] == .failed("Josh Allen is not on your roster."))
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
        #expect(ids.contains("12481"))
        // A player the site has no page for (no slug) opens no sheet, as the web's row draws no link.
        #expect(!ids.contains("8116"))
    }

    @Test func onSundayAfternoonTheTradesMovingPlayersInPlayDrawNoWeek() throws {
        let model = try TradesParityTests.model(Fixtures.sunday)
        let best = try #require(model.rows.first { $0.id == Self.best })
        #expect(best.opened.week == nil)
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
        #expect(model.basis.contains("Week 6 projections expected Thursday."))
        #expect(!model.basis.contains("published projection"))
    }
}
