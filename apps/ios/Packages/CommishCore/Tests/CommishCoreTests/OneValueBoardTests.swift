import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The Board and the share at the order's clock past the first round (Lane 224 fix round 1): a bye
/// club's players stay on the Board and the clubs index stays at the clock (H1), a failed read after a
/// good one leaves the run's rows with the run's stamp (H2), the players on a season-long list follow
/// the order's rows with the list's word (M1), the Board says how far one read reaches and its head is on
/// the basis's clock (M2), and the share drops what its window has passed and keys a read in any case
/// (L2).
@MainActor
struct OneValueBoardTests {
    typealias Reads = OneValueReads
    private let reads = OneValueReads()

    /// The clubs on bye in the fixture's week 6, every one of their players kept in his place.
    static let byes: Set = ["CIN", "DET", "MIA", "MIN"]

    @Test func aByeClubsPlayersStayOnTheBoardAndTheClubsIndexAtTheClock() async throws {
        let order = try Reads.order()
        let byePlayers = order.answer.rows.filter { Self.byes.contains($0.line.player.team) && $0.line.facts.bye }
        #expect(!byePlayers.isEmpty, "the fixture's week has clubs on bye")
        let model = try Reads.board(order: order)
        #expect(model.atClock)
        let burrow = try #require(Reads.parity.players.first { $0.name == "Joe Burrow" })
        #expect(model.rows.contains { $0.id == burrow.id }, "a bye club's QB is on the Board at the clock")
        #expect(model.rows.map(\.id) == Reads.parity.board.ids)
        let clubs = RunScreenViewModel.clubs(
            run: StubRun(.oneValue), pages: StubPages(.oneValue), cache: reads.cache(), clock: FixedClock(Reads.now),
            zone: Reads.zone, orders: Reads.orders()
        )
        await clubs.load()
        let index = try reads.loaded(clubs)
        #expect(index.atClock, "every club's first three are within the whole read")
        let cin = try #require(Reads.parity.clubs["read"]?.first { $0.abbr == "CIN" }?.lead)
        #expect(index.clubs.first { $0.abbr == "CIN" }?.lead?.rank == "\(Words.ClubPage.ourRank) \(cin.rank)")
    }

    @Test func theRankingsByesLastReadStopsBeforeTheByeClubs() async throws {
        // The Rankings' own read numbers the byes last and its first rows hold none of a bye club's
        // available players: the whole read the pages take keeps them (review H1).
        let byesLast = try await StubOrderSearch().order(OrderQuery(position: nil, search: nil, limit: 100))
        let whole = try await StubOrderSearch().order(OrderReader.query(search: nil))
        let available = { (row: OrderRow) in Self.byes.contains(row.line.player.team) && row.line.positionRank != nil }
        #expect(!byesLast.rows.contains(where: available))
        #expect(whole.rows.contains(where: available))
        let limited = try await StubOrderSearch().order(OrderQuery(
            position: nil,
            search: nil,
            limit: 10,
            byesLast: false
        ))
        #expect(limited.rows.count == 10)
    }

    @Test func aFailedReadAfterAGoodOneLeavesTheRunsRowsAndStamp() async throws {
        let clock = MovingClock(Reads.now)
        let flaky = FlakyOrder()
        let viewModel = BoardViewModel(
            api: StubRun(.oneValue), cache: reads.cache(), clock: clock, inSeason: true, following: false,
            zone: Reads.zone, orders: OrderReader(api: flaky, clock: clock, memo: OrderMemo())
        )
        await viewModel.load()
        guard case let .loaded(read, _, _) = viewModel.state else {
            throw Reads.Failure.notLoaded("\(viewModel.state)")
        }
        #expect(read.atClock)
        await flaky.fail()
        clock.now += OrderReader.window + 1
        await viewModel.load()
        guard case let .loaded(unread, _, _) = viewModel.state else {
            throw Reads.Failure.notLoaded("\(viewModel.state)")
        }
        #expect(!unread.atClock, "no order from an earlier read under the run")
        #expect(unread.basis.last == Reads.parity.basis.stamp)
        #expect(unread.basis.first != Reads.parity.basis.lead)
    }

    @Test func playersOnASeasonLongListFollowTheOrdersRowsWithTheListsWord() throws {
        let washington = try #require(Reads.parity.players.first { $0.name == "Parker Washington" })
        var answer = try Reads.order().answer
        answer.rows = answer.rows.filter { $0.line.player.boardId != washington.id }
        let order = OrderAtClock(answer: answer, landed: Reads.now)
        let read = try Self.read(listing: washington.id)
        let all = BoardModel(
            read: read, position: nil, inSeason: true, following: false, now: Reads.now, zone: Reads.zone, order: order
        )
        #expect(all.atClock)
        let last = try #require(all.rows.last)
        #expect(last.id == washington.id, "the listed player follows the order's rows")
        #expect(last.pill == "WR IR")
        #expect(last.projected == Words.Box.none)
        #expect(last.overReplacement == Words.Box.none)
        let receivers = BoardModel(
            read: read, position: .receiver, inSeason: true, following: false, now: Reads.now, zone: Reads.zone,
            order: order
        )
        #expect(receivers.sections.last?.head == Words.Board.heldHead)
        #expect(receivers.sections.last?.rows.map(\.id) == [washington.id])
    }

    @Test func theBoardSaysHowFarOneReadReachesAndItsHeadIsOnTheBasisClock() throws {
        let order = try Reads.order()
        var answer = order.answer
        answer.rows = Array(answer.rows.prefix(40))
        #expect(LiveOrder.cut(answer), "the view holds more players than the rows it returned")
        let short = try Reads.board(order: OrderAtClock(answer: answer, landed: Reads.now))
        let total = try RunFixture.oneValue.board(format: Reads.ppr).rows.count
        #expect(short.basis.last == LiveOrderWords.reach(shown: short.rows.count, total: total))
        let whole = try Reads.board(order: order)
        #expect(
            whole.basis.contains { $0.hasPrefix("The first") } == false,
            "a read that reaches every row says no count"
        )
        #expect(whole.restLine == Reads.parity.basis.lead)
        #expect(try Reads.board(order: nil).restLine?.contains("refreshed") == true)
        let reach = Reads.parity.basis.reach
        #expect(LiveOrderWords.reach(shown: reach.shown, total: reach.total) == reach.text)
    }

    @Test func theShareDropsWhatItsWindowPassedAndKeysAReadInAnyCase() async throws {
        let memo = OrderMemo()
        let clock = MovingClock(Reads.now)
        let orders = OrderReader(api: StubOrderSearch(), clock: clock, memo: memo)
        _ = try await orders.read(search: "chi")
        _ = try await orders.read(search: "CHI")
        #expect(await memo.kept == 1)
        clock.now += OrderReader.window + 1
        _ = try await orders.read()
        #expect(await memo.kept == 1, "the club's read past its window is dropped")
    }

    /// The stand-in's read with one player under `status` in the run's capture, injured reserve (the
    /// season-long list) unless named, and its board with `extra` rows after its own.
    static func read(
        listing id: String, status: String = "injured_reserve", seasonLong: Bool = true, extra: [RunBoardRow] = []
    ) throws -> RunBoardRead {
        let fixture = RunFixture.oneValue
        let json = Data(#"""
        {"readAt":"2026-10-14T02:03:35.613Z","checkedAt":null,"source":"stand-in",
         "players":{"\#(id)":{"status":"\#(status)","seasonLong":\#(seasonLong),"since":"2026-10-12T19:00:00.000Z"}}}
        """#.utf8)
        let designations = try APIDecoding.decoder().decode(RunDesignations.self, from: json)
        var board = try fixture.board(format: Reads.ppr)
        board.rows += extra
        return try RunBoardRead(
            manifest: Kept(value: fixture.manifest(), tag: nil),
            board: Kept(value: board, tag: nil),
            sources: Kept(value: fixture.adpSources(), tag: nil),
            designations: Kept(value: designations, tag: nil),
            clubs: Kept(value: fixture.clubs(), tag: nil)
        )
    }
}

/// The order's route answering the fixture, counting each read it is asked.
actor CountedOrder: RankingsAPI {
    private(set) var reads = 0

    func order(_ query: OrderQuery) async throws -> OrderAdvice {
        reads += 1
        return try await StubOrderSearch().order(query)
    }

    func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
        try await StubOrderSearch().weekOrder(position: position)
    }
}

/// The order's route answering the fixture until told to fail, then failing with no signal.
actor FlakyOrder: RankingsAPI {
    private var failing = false

    func fail() {
        failing = true
    }

    func order(_ query: OrderQuery) async throws -> OrderAdvice {
        try await StubOrderSearch(offline: failing).order(query)
    }

    func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
        try await StubOrderSearch(offline: failing).weekOrder(position: position)
    }
}
