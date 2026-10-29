import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Trades' view model, builder-first (Lane 260): the saved trades at once and the API's after it; a
/// failed read keeps them with its stamp; the builder opens on our best trade's team with nothing
/// ticked; an idea loads its ticks and posts the check; ticks and another team ask again, keeping only
/// the latest answer; the builder stands without a check on an older API and when the check fails; the
/// verb copies the web's offer and Share the web's text, only while the answer is the ticks'; a refused
/// token signs out.
@MainActor
struct TradesViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-trades-tests-\(UUID().uuidString)")
    static let best = "8:96>7526+8116"
    static let me = TradeMe(name: "McConkey Kong Country", aside: "5-1, 2nd of 12")

    static func stub(check: Bool = true) throws -> TradesStub {
        try TradesStub(
            advice: Fixtures.trades(Fixtures.week),
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

    @Test func theScreenOpensOnTheBestTradesTeamWithNothingTicked() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        let shown = try Self.shown(viewModel)
        #expect(!shown.stale)
        #expect(viewModel.stampWords == nil)
        #expect(viewModel.building == TradePicks(team: 8, give: [], get: []))
        let builder = try #require(viewModel.builder)
        #expect(builder.sentence == Words.Builder.pickBoth)
        #expect(builder.quiet)
        #expect(builder.bug.yours.figures.projBefore == Words.Box.none)
        #expect(builder.theirs.team == "Max_Jensen10")
        #expect(builder.yours.aside == "5-1, 2nd of 12")
        #expect(builder.ideas.count == TradeIdeas.shown)
        #expect(builder.more != nil)
        #expect(!builder.verbEnabled)
        #expect(await stub.checked.isEmpty)
    }

    @Test func aSavedReadShowsAtOnceDatedThenAFailedReadKeepsIt() async throws {
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
        #expect(second.builder?.pressed == nil)
    }

    @Test func aFirstReadThatFailsSaysWhy() async throws {
        let stub = try Self.stub()
        await stub.fail(URLError(.notConnectedToInternet))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func anIdeaLoadsItsTicksAndDrawsBothLineups() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.load(idea: Self.best, leagueID: Fixtures.league)
        #expect(await stub.checked == [TradeCheckInput(team: 8, give: ["96"], get: ["7526", "8116"])])
        let builder = try #require(viewModel.builder)
        #expect(builder.pressed == Self.best)
        // The best trade moves Waddle, whose Thursday game is final: no change this week (heldCheck).
        #expect(builder.bug.yours.figures.projBefore == Words.Box.none)
        #expect(builder.bug.yours.figures.seasonAfter == "7.3")
        #expect(builder.bug.theirs.name == "Max_Jensen10")
        #expect(builder.bug.yours.bar > builder.bug.theirs.bar)
        #expect(builder.sentence == TradesBuilderParityTests.parity.builder.sentence)
        #expect(builder.verbEnabled)
    }

    @Test func ticksAskForBothSidesThenCheckAsTheyLand() async throws {
        let stub = try Self.stub()
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.tap(.give, player: "96", leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.Builder.pickTheirs)
        #expect(viewModel.builder?.rosters.yours == "You, 1")
        #expect(await stub.checked.isEmpty)
        await viewModel.tap(.get, player: "12481", leagueID: Fixtures.league)
        #expect(await stub.checked == [TradeCheckInput(team: 8, give: ["96"], get: ["12481"])])
        #expect(viewModel.builder?.verbEnabled == true)
        await viewModel.tap(.get, player: "12481", leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.Builder.pickTheirs)
        #expect(viewModel.builder?.verbEnabled == false)
    }

    @Test func anotherTeamStartsTheirSideAgain() async throws {
        let viewModel = try model(Self.stub())
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.load(idea: Self.best, leagueID: Fixtures.league)
        await viewModel.choose(team: 3, leagueID: Fixtures.league)
        #expect(viewModel.building == TradePicks(team: 3, give: ["96"], get: []))
        #expect(viewModel.builder?.sentence == Words.Builder.pickTheirs)
        #expect(viewModel.builder?.pressed == nil)
    }

    @Test func nMoreShowsEveryIdeaAndTheSwitchShowsTheirRoster() async throws {
        let viewModel = try model(Self.stub())
        await viewModel.load(leagueID: Fixtures.league)
        viewModel.showAllIdeas()
        let builder = try #require(viewModel.builder)
        #expect(builder.more == nil)
        #expect(builder.ideas.count == Self.shownPlaces(viewModel))
        #expect(viewModel.drawn == .give)
        viewModel.show(.get)
        #expect(viewModel.drawn == .get)
    }

    static func shownPlaces(_ viewModel: TradesViewModel) -> Int {
        guard case let .loaded(model, _, _) = viewModel.state else {
            return 0
        }
        return model.ideas.places.count
    }

    /// Review M3 and L1: tick A, then tick B while A's check is out; B's answer lands and is live, and
    /// A's read is cancelled, so it can never land over B's.
    @Test func aNewerTickCancelsTheOlderCheckAndItsAnswerIsLive() async throws {
        let gated = try GatedTrades(
            advice: Fixtures.trades(Fixtures.week),
            check: Fixtures.tradeCheck(Fixtures.week, 1)
        )
        let viewModel = model(gated)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.tap(.give, player: "96", leagueID: Fixtures.league)
        let first = Task { await viewModel.tap(.get, player: "7526", leagueID: Fixtures.league) }
        try await Self.until { await gated.asked.count == 1 }
        let second = Task { await viewModel.tap(.get, player: "8116", leagueID: Fixtures.league) }
        try await Self.until { await gated.asked.count == 2 }
        await gated.release(["7526", "8116"])
        await second.value
        await gated.release(["7526"])
        await first.value
        #expect(await gated.cancelled == [["7526"]])
        #expect(viewModel.building == TradePicks(team: 8, give: ["96"], get: ["7526", "8116"]))
        #expect(viewModel.builder?.live == true)
        #expect(viewModel.builder?.pressed == Self.best)
        #expect(viewModel.checking == false)
    }

    /// Waits for a condition the stub reaches on its own task, a few seconds at most.
    static func until(_ condition: () async -> Bool) async throws {
        for _ in 0 ..< 2000 {
            if await condition() {
                return
            }
            try await Task.sleep(for: .milliseconds(2))
        }
        Issue.record("the condition was never met")
    }

    @Test func aThirdPickWaitsForOnePutBack() {
        let picks = TradePicks(team: 8, give: ["a", "b"], get: [])
        #expect(picks.tapped(.give, "c") == picks)
        #expect(picks.tapped(.give, "a") == TradePicks(team: 8, give: ["b"], get: []))
    }

    @Test func anAPIOlderThanTheCheckLeavesTheBuilderWithTheWebsLine() async throws {
        let viewModel = try model(Self.stub(check: false))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.load(idea: Self.best, leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.InSeason.narrowingUnread)
        #expect(viewModel.builder?.verbEnabled == false)
        #expect(try !Self.shown(viewModel).stale)
    }

    @Test func aCheckWithNoSignalDatesTheReadAndAsksAgainOnTheNextTick() async throws {
        let stub = try Self.stub()
        await stub.failCheck(URLError(.notConnectedToInternet))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.load(idea: Self.best, leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == Words.InSeason.narrowingUnread)
        #expect(try Self.shown(viewModel).stale)
        await stub.failCheck(nil)
        await viewModel.tap(.get, player: "8116", leagueID: Fixtures.league)
        await viewModel.tap(.get, player: "8116", leagueID: Fixtures.league)
        #expect(viewModel.builder?.verbEnabled == true)
    }

    /// Review L1: an API refusal says the API's sentence and does not date a fresh read.
    @Test func aCheckTheAPIRefusesSaysTheAPIsSentenceAndLeavesTheReadFresh() async throws {
        let stub = try Self.stub()
        await stub.failCheck(APIError.envelope(code: "invalid", message: "Josh Allen is not on your roster."))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.load(idea: Self.best, leagueID: Fixtures.league)
        #expect(viewModel.builder?.sentence == "Josh Allen is not on your roster.")
        #expect(try !Self.shown(viewModel).stale)
        #expect(viewModel.stampWords == nil)
    }

    @Test func theVerbAndShareCopyTheWebsWordsAndSayWhatHappened() async throws {
        var copied: [String] = []
        let viewModel = try model(Self.stub(), copy: { text in
            copied.append(text)
            return true
        })
        await viewModel.load(leagueID: Fixtures.league)
        viewModel.pressBuilder()
        #expect(copied.isEmpty)
        await viewModel.load(idea: Self.best, leagueID: Fixtures.league)
        viewModel.pressBuilder()
        viewModel.share()
        let offer = "Trade with Max_Jensen10: Aaron Rodgers (QB PIT) for Jaylen Waddle (WR DEN) and "
            + "Pierre Strong (RB GB)."
        #expect(copied.first == offer)
        #expect(copied.last?.hasPrefix("\(offer) Both lineups gain: yours 5.3") == true)
        #expect(copied.last?.hasSuffix("You drop Jaxson Dart to make room.") == true)
        #expect(viewModel.builderCopied?.words == TradesParityTests.parity.copied.done)
        #expect(viewModel.shared == Words.Analyzer.shared)
    }

    @Test func aCopyThatDidNotTakeSaysSo() async throws {
        let viewModel = try model(Self.stub(), copy: { _ in false })
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.load(idea: Self.best, leagueID: Fixtures.league)
        viewModel.pressBuilder()
        viewModel.share()
        #expect(viewModel.builderCopied?.words == TradesParityTests.parity.copied.failed)
        #expect(viewModel.shared == Words.Trades.copyFailed)
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

    @Test func theRostersRowsOpenThePlayerSheetByTheirIDs() async throws {
        let viewModel = try model(Self.stub())
        await viewModel.load(leagueID: Fixtures.league)
        let ids = try #require(viewModel.builder).sheetPlayers.map(\.id)
        #expect(ids.contains("96"))
        #expect(ids.contains("7526"))
        // A player the site has no page for (no slug) opens no sheet, as the web's row draws no link.
        #expect(!ids.contains("8116"))
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
            advice: advice, host: TradesParityTests.host, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(model.basis.contains("Week 6 projections expected Thursday."))
        #expect(!model.basis.contains("published projection"))
    }
}
