import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// One value and one order for a player on every in-season screen (Lane 224, B207, the web's Lane 220
/// rule): the words a screen says its clock in, the Board, a club and the clubs index, each over the
/// one-value stand-in run with the order the Rankings read at the Sunday clock, print the figures and
/// ranks the web prints (one-value.json); while the order is unread each keeps the run's, every row,
/// with the run's stamp.
@MainActor
struct OneValueTests {
    typealias Reads = OneValueReads
    private let reads = OneValueReads()

    // MARK: The words

    @Test func theLeadAndTheRunsStampAreTheWebs() throws {
        let order = try Reads.order()
        let format = try #require(RunFixture.oneValue.manifest().formats.first)
        #expect(order.lead(teams: Reads.parity.teams, zone: Reads.zone) == Reads.parity.basis.lead)
        #expect(LiveOrderWords.runStamp(format, zone: Reads.zone) == Reads.parity.basis.stamp)
        let basis = Reads.parity.basis
        let board = basis.sample[1]
        #expect(LiveOrder.basis(basis.sample, board: board, lead: nil, stamp: basis.stamp) == basis.unread)
        #expect(LiveOrder.basis(basis.sample, board: board, lead: basis.lead, stamp: basis.stamp) == basis.read)
        #expect(LiveOrder.basis([], board: nil, lead: nil, stamp: basis.stamp) == basis.bare.unread)
        #expect(LiveOrder.basis([], board: nil, lead: basis.lead, stamp: basis.stamp) == basis.bare.read)
        #expect(LiveOrderWords
            .unranked(["Standard"]) == "Standard shows no position rank at this read, only its points.")
    }

    @Test func theOrderIsReadInItsOwnScoringAlone() throws {
        let order = try Reads.order()
        for format in try RunFixture.oneValue.manifest().formats {
            let api = try #require(format.apiFormat)
            #expect(LiveOrder.inScoring(order.answer, format: format) == Reads.parity.refused.inScoring[api])
        }
    }

    @Test func aRowTheOrderDoesNotPlaceKeepsTheRunsEveryRow() throws {
        let swift = try #require(Reads.parity.players.first)
        let places = try Reads.order().places.filter { $0.key != swift.id }
        let club = Reads.parity.players.compactMap { $0.team == swift.team ? $0.id : nil }
        #expect(Reads.parity.refused.club == nil)
        #expect(LiveOrder.placed(club, id: { $0 }, places: places) == nil)
        #expect(Reads.parity.refused.pair == nil)
        let pair = Reads.parity.players.prefix(2).map(\.id)
        #expect(LiveOrder.pair(pair, places: places, format: Reads.ppr, boardFormat: Reads.ppr) == nil)
        #expect(try LiveOrder
            .pair(pair, places: Reads.order().places, format: "half-ppr-12", boardFormat: Reads.ppr) == nil)
    }

    // MARK: The Board

    @Test func theBoardAtTheOrdersClockIsTheOrdersEveryRow() throws {
        let model = try BoardModel(
            read: RunFixture.oneValue.read(format: Reads.ppr), position: nil, inSeason: true, following: false,
            now: Reads.now, zone: Reads.zone, order: Reads.order()
        )
        #expect(model.atClock)
        #expect(model.rows.map(\.id) == Reads.parity.board.ids)
        #expect(model.sections.allSatisfy { $0.band == nil })
        #expect(model.basis.first == Reads.parity.basis.lead)
        for player in Reads.parity.players {
            let row = try #require(model.rows.first { $0.id == player.id })
            #expect(model.rows.firstIndex { $0.id == player.id } == player.board.row, "\(player.name)")
            #expect(row.pill == "\(player.position) \(player.board.positionRank)", "\(player.name)")
            #expect(row.projected == BoardFigures.projected(player.board.projected), "\(player.name)")
            #expect(row.overReplacement == BoardFigures.signed(player.board.vor), "\(player.name)")
            #expect(row.heat == Heat.of(vor: player.board.vor, round: player.board.round), "\(player.name)")
        }
    }

    /// The order ranks more players than one read gives: the Board at its clock draws the rows the read
    /// reaches, never a run row among them.
    @Test func theBoardDrawsTheRowsTheOrderReaches() throws {
        let swift = try #require(Reads.parity.players.first)
        let full = try Reads.order()
        var answer = full.answer
        answer.rows = answer.rows.filter { $0.line.player.boardId != swift.id }
        let model = try Reads.board(order: OrderAtClock(answer: answer, landed: Reads.now))
        #expect(model.atClock)
        #expect(model.rows.map(\.id) == Reads.parity.board.ids.filter { $0 != swift.id })
    }

    @Test func eachReadIsAskedOncePerClockAndSharedByItsScreens() async throws {
        let counted = CountedOrder()
        let orders = OrderReader(api: counted, clock: FixedClock(Reads.now), memo: OrderMemo())
        async let first = orders.read()
        async let second = orders.read()
        _ = try await (first, second)
        _ = try await orders.read(search: "chi")
        _ = try await orders.read()
        #expect(await counted.routes == [OrderReader.query(search: nil).route, OrderReader.query(search: "chi").route])
        let later = OrderReader(
            api: counted, clock: FixedClock(Reads.now + OrderReader.window), memo: orders.memo
        )
        _ = try await later.read()
        #expect(await counted.routes.count == 3, "an answer stands for its window alone")
    }

    /// The order's route over the fixture, counting the reads it is asked.
    actor CountedOrder: RankingsAPI {
        private(set) var routes: [String] = []

        func order(_ query: OrderQuery) async throws -> OrderAdvice {
            routes.append(query.route)
            return try await StubOrderSearch().order(query)
        }

        func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
            try await StubOrderSearch().weekOrder(position: position)
        }
    }

    @Test func aPositionViewAtTheOrdersClockDrawsNoTiers() throws {
        let model = try BoardModel(
            read: RunFixture.oneValue.read(format: Reads.ppr), position: .runningBack, inSeason: true,
            following: false, now: Reads.now, zone: Reads.zone, order: Reads.order()
        )
        #expect(model.atClock)
        #expect(model.sections.count == 1)
        #expect(model.sections.first?.band == nil)
        let swift = try #require(Reads.parity.players.first)
        #expect(model.rows.first { $0.id == swift.id }?.pill == "RB \(swift.order.positionRank)")
    }

    @Test func theBoardUnreadKeepsTheRunsRowsWithTheRunsStamp() throws {
        let model = try BoardModel(
            read: RunFixture.oneValue.read(format: Reads.ppr), position: nil, inSeason: true, following: false,
            now: Reads.now, zone: Reads.zone
        )
        #expect(!model.atClock)
        #expect(model.basis.last == Reads.parity.basis.stamp)
        for player in Reads.parity.players {
            let row = try #require(model.rows.first { $0.id == player.id })
            #expect(row.pill == "\(player.position) \(player.run.positionRank)")
            #expect(row.projected == BoardFigures.projected(player.run.projected))
        }
    }

    @Test func theBoardViewModelDrawsTheRunThenTheOrder() async throws {
        let viewModel = BoardViewModel(
            api: StubRun(.oneValue), cache: reads.cache(), clock: FixedClock(Reads.now), inSeason: true,
            following: false,
            zone: Reads.zone, orders: Reads.orders()
        )
        await viewModel.load()
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw Reads.Failure.notLoaded("\(viewModel.state)")
        }
        #expect(model.atClock)
        viewModel.choose(position: .receiver)
        guard case let .loaded(receivers, _, _) = viewModel.state else {
            throw Reads.Failure.notLoaded("\(viewModel.state)")
        }
        #expect(receivers.atClock, "a chip redraws on the order read")
        let failed = BoardViewModel(
            api: StubRun(.oneValue), cache: reads.cache(), clock: FixedClock(Reads.now), inSeason: true,
            following: false,
            zone: Reads.zone, orders: Reads.orders(offline: true)
        )
        await failed.load()
        guard case let .loaded(run, _, _) = failed.state else {
            throw Reads.Failure.notLoaded("\(failed.state)")
        }
        #expect(!run.atClock)
        #expect(run.basis.last == Reads.parity.basis.stamp)
    }

    // MARK: The clubs

    @Test func aClubAtTheOrdersClockIsTheOrdersEveryRow() async throws {
        for player in Reads.parity.players {
            let viewModel = RunScreenViewModel.club(
                player.team, run: StubRun(.oneValue), pages: StubPages(.oneValue), cache: reads.cache(),
                clock: FixedClock(Reads.now), zone: Reads.zone, orders: Reads.orders()
            )
            await viewModel.load()
            let model = try reads.loaded(viewModel)
            #expect(model.atClock, "\(player.team)")
            #expect(model.rows.map(\.id) == player.club.ids, "\(player.team)")
            let row = try #require(model.rows.first { $0.id == player.id })
            #expect(row.pill == "\(player.position) \(player.club.positionRank)")
            #expect(row.projected == BoardFigures.projected(player.club.projected))
            #expect(row.overReplacement == BoardFigures.signed(player.club.vor))
            #expect(model.basis.contains(Reads.parity.basis.lead))
            #expect(!model.basis.contains(Reads.parity.basis.stamp))
        }
    }

    @Test func aClubUnreadKeepsTheRunsRowsWithTheRunsStamp() async throws {
        let swift = try #require(Reads.parity.players.first)
        let viewModel = RunScreenViewModel.club(
            swift.team, run: StubRun(.oneValue), pages: StubPages(.oneValue), cache: reads.cache(),
            clock: FixedClock(Reads.now), zone: Reads.zone, orders: Reads.orders(offline: true)
        )
        await viewModel.load()
        let model = try reads.loaded(viewModel)
        #expect(!model.atClock)
        #expect(model.basis.last == Reads.parity.basis.stamp)
        #expect(model.rows.first { $0.id == swift.id }?.pill == "RB \(swift.run.positionRank)")
    }

    @Test func theClubsLeadsAreTheWebsOnEitherClock() async throws {
        for (clock, orders) in [("read", Reads.orders()), ("run", Reads.orders(offline: true))] {
            let viewModel = RunScreenViewModel.clubs(
                run: StubRun(.oneValue), pages: StubPages(.oneValue), cache: reads.cache(),
                clock: FixedClock(Reads.now),
                zone: Reads.zone, orders: orders
            )
            await viewModel.load()
            let model = try reads.loaded(viewModel)
            #expect(model.atClock == (clock == "read"))
            #expect(model.basis == [clock == "read" ? Reads.parity.basis.lead : Reads.parity.basis.stamp])
            for want in try #require(Reads.parity.clubs[clock]) {
                let card = model.clubs.first { $0.abbr == want.abbr }
                #expect(
                    card?.lead?.sheetPlayer.id == want.lead?.id,
                    "\(clock) \(want.abbr) \(String(describing: card?.lead))"
                )
                if let lead = want.lead {
                    #expect(card?.lead?.rank == "\(Words.ClubPage.ourRank) \(lead.rank)", "\(clock) \(want.abbr)")
                    #expect(card?.lead?.pill.hasSuffix(" \(lead.positionRank)") == true, "\(clock) \(want.abbr)")
                }
            }
        }
    }
}
