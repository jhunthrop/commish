import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The Board at the order's clock for a player whose status the run's capture does not hold (Lane 243,
/// B251, fix round 1): put on IR after the nightly as the API answers him (placed, his figures kept,
/// the list's word in his pill, M2); returned with no figure (drawn after the ranked rows with the
/// order's word, else the run's, else "--"); under the list's head only when on a list (M1); a board id
/// the order repeats keeps its first row; and a position chip reads again from the share's window on.
@MainActor
struct OneValueUnplacedTests {
    typealias Reads = OneValueReads
    private let reads = OneValueReads()

    static let cook = "James Cook"

    func board(_ answer: OrderAdvice, position: BoardPosition? = nil, read: RunBoardRead? = nil) throws -> BoardModel {
        try BoardModel(
            read: read ?? RunFixture.oneValue.read(format: Reads.ppr), position: position, inSeason: true,
            following: false, now: Reads.now, zone: Reads.zone, order: OrderAtClock(answer: answer, landed: Reads.now)
        )
    }

    @Test func aPlayerPutOnIRAfterTheNightlyIsDrawnPlacedWithTheListsWordAsTheAPIAnswersHim() throws {
        let swift = try #require(Reads.parity.players.first)
        let run = try RunFixture.oneValue.read(format: Reads.ppr)
        #expect(run.designations.value?.players.additionalProperties[swift.id] == nil, "the run does not list him")
        let answer = try OneValueFixture.listing(swift.id, in: Reads.order().answer)
        let place = try #require(LiveOrder.places(answer)[swift.id], "the order places him")
        #expect(place.positionRank == nil, "the API keeps his figures and drops his place at his position")
        let all = try board(answer)
        #expect(all.atClock)
        #expect(all.rows.map(\.id).sorted() == Reads.parity.board.ids.sorted(), "every player is drawn, once")
        let row = try #require(all.rows.first { $0.id == swift.id })
        #expect(row.pill == "RB \(Words.DesignationRank.injured_reserve)", "the list's word, as the Rankings' # cell")
        #expect(row.status?.rank == Words.DesignationRank.injured_reserve)
        #expect(row.projected == BoardFigures.projected(place.projected), "placed, so the order's figures")
        let index = try #require(all.rows.firstIndex { $0.id == swift.id })
        #expect(all.rows.indices.filter { all.rows[$0].status == nil }.allSatisfy { $0 < index }, "after the available")
        #expect(!all.basis.contains { $0.hasPrefix("The first") }, "a whole answer says no count")
    }

    @Test func aPlayerTheOrderReturnsWithNoFigureIsDrawnAfterTheRankedRowsWithTheOrdersWord() throws {
        let swift = try #require(Reads.parity.players.first)
        let answer = try OneValueFixture.unvalued(swift.id, status: .injuredReserve, in: Reads.order().answer)
        #expect(LiveOrder.places(answer)[swift.id] == nil, "the order holds his row with no figure")
        #expect(LiveOrder.rows(answer)[swift.id] != nil)
        let all = try board(answer)
        #expect(all.rows.map(\.id).sorted() == Reads.parity.board.ids.sorted(), "every player is drawn, once")
        let last = try #require(all.rows.last)
        #expect(last.id == swift.id, "he follows the order's ranked rows")
        #expect(last.pill == "RB \(Words.DesignationRank.injured_reserve)")
        #expect(last.projected == Words.Box.none)
        #expect(last.overReplacement == Words.Box.none)
        #expect(!all.basis.contains { $0.hasPrefix("The first") }, "a whole answer says no count")
        let backs = try board(answer, position: .runningBack)
        #expect(backs.sections.last?.head == Words.Board.heldHead)
        #expect(backs.sections.last?.rows.map(\.id) == [swift.id])
    }

    @Test func aRowWithNoStatusFallsBackToTheRunsWordElseTheDashNeverUnderTheListsHead() throws {
        let swift = try #require(Reads.parity.players.first)
        let answer = try OneValueFixture.unvalued(swift.id, status: nil, in: Reads.order().answer)
        let out = try OneValueBoardTests.read(listing: swift.id, status: "out", seasonLong: false)
        let said = try board(answer, read: out).rows.first { $0.id == swift.id }
        #expect(said?.pill == "RB \(Words.DesignationRank.out)", "the run's word where the order's row has none")
        #expect(try board(answer).rows.first { $0.id == swift.id }?.pill == "RB \(Words.Box.none)")
        let backs = try board(answer, position: .runningBack, read: out)
        #expect(!backs.sections.contains { $0.head == Words.Board.heldHead && $0.rows.contains { $0.id == swift.id } })
        #expect(backs.sections.last?.head == nil, "a row on no list sits after the order's rows with no head")
        #expect(backs.sections.last?.rows.map(\.id) == [swift.id])
    }

    @Test func theFixturesPlayersWithNoFigureAndNoStatusNeverSitUnderTheListsHead() throws {
        // James Cook: the shared Sunday order returns him with no figure and no status.
        let answer = try Reads.order().answer
        let cook = try #require(answer.rows.first { $0.line.player.name == Self.cook })
        #expect(cook.restOfSeasonPoints == nil)
        #expect(cook.line.facts.designation == nil)
        let id = try #require(cook.line.player.boardId)
        let swift = try #require(Reads.parity.players.first)
        var row = try #require(RunFixture.oneValue.board(format: Reads.ppr).rows.first { $0.id == swift.id })
        row.id = id
        row.name = Self.cook
        row.team = cook.line.player.team
        // The run lists only a player off the RB view, so Cook's word can come from the order alone.
        let read = try OneValueBoardTests.read(listing: "none", extra: [row])
        let backs = try board(answer, position: .runningBack, read: read)
        #expect(!backs.sections.contains { $0.head == Words.Board.heldHead && $0.rows.contains { $0.id == id } })
        #expect(backs.sections.last?.head == nil)
        #expect(backs.sections.last?.rows.map(\.id) == [id])
        #expect(backs.sections.last?.rows.first?.pill == "RB \(Words.Box.none)")
        let all = try board(answer, read: read)
        #expect(all.rows.last?.id == id)
        #expect(Set(all.rows.map(\.id)).count == all.rows.count, "no player drawn twice")
    }

    @Test func aBoardIDTheOrderRepeatsKeepsItsFirstRow() throws {
        var answer = try Reads.order().answer
        let first = try #require(answer.rows.first)
        var twin = first
        twin.restOfSeasonPoints = nil
        answer.rows.append(twin)
        #expect(LiveOrder.rows(answer)[first.line.player.boardId ?? ""] == first)
    }

    @Test func aPositionChipReadsTheOrderAgainFromTheSharesWindowOn() async throws {
        let clock = MovingClock(Reads.now)
        let counted = CountedOrder()
        let viewModel = BoardViewModel(
            api: StubRun(.oneValue), cache: reads.cache(), clock: clock, inSeason: true, following: false,
            zone: Reads.zone, orders: OrderReader(api: counted, clock: clock, memo: OrderMemo())
        )
        await viewModel.load()
        #expect(await counted.reads == 1)
        clock.now += 30
        #expect(viewModel.choose(position: .receiver) == nil, "inside the window the held order redraws")
        #expect(await counted.reads == 1)
        clock.now = Reads.now + OrderReader.window
        let atWindow = try #require(viewModel.choose(position: .receiver), "at exactly the window it reads again")
        await atWindow.value
        #expect(await counted.reads == 2, "a held order 60 s old is read again")
        clock.now += 61
        let reread = try #require(viewModel.choose(position: .runningBack), "past the window the chip reads again")
        await reread.value
        #expect(await counted.reads == 3, "a held order 61 s old is read again")
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw Reads.Failure.notLoaded("\(viewModel.state)")
        }
        #expect(model.atClock)
        #expect(model.rows.allSatisfy { $0.pill.hasPrefix("RB ") })
    }
}
