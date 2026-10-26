import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// One value and one order on Compare and the player page's every-format table (Lane 224, the web's
/// Lane 220 rule), as the web prints them (one-value.json) once the order or the week answers and while
/// either is unread; and every screen's rank and points for the three players against the Rankings'.
@MainActor
struct OneValueScreenTests {
    typealias Reads = OneValueReads
    private let reads = OneValueReads()

    // MARK: Compare

    private func expect(_ table: CompareTable, _ pair: OneValueParity.Pair) {
        let sides = pair.sides.sorted { $0.rank < $1.rank }
        #expect(table.evidence == pair.evidence)
        #expect(table.heads.map(\.id) == sides.map(\.id))
        let cells = { (label: String) in table.rows.first { $0.label == label }?.cells.map(\.text) }
        #expect(cells("Our rank") == sides.map { String($0.rank) })
        #expect(cells(Words.Figure.projected) == sides.map { Formatting.fixed($0.projected) })
        #expect(cells("Over replacement") == sides.map { BoardFigures.signed($0.vor) })
        #expect(cells(CompareRows.gapLabel) == nil)
    }

    @Test func comparesPairAtTheOrdersClockIsTheOrders() async throws {
        let model = try await reads.loaded(reads.compare(orders: Reads.orders()))
        let pair = try #require(Reads.parity.compare["read"])
        #expect(model.atClock == pair.atClock)
        let table = try reads.table(model)
        expect(table, pair)
        #expect(table.basis.contains(Reads.parity.basis.lead))
    }

    @Test func comparesPairUnreadOrInAnotherScoringIsTheRuns() async throws {
        let unread = try await reads.loaded(reads.compare(orders: Reads.orders(offline: true)))
        let run = try #require(Reads.parity.compare["run"])
        #expect(!unread.atClock)
        let table = try reads.table(unread)
        expect(table, run)
        #expect(table.basis.last == Reads.parity.basis.stamp)
        let viewModel = await reads.compare(orders: Reads.orders())
        let other = try #require(Reads.parity.compare["otherFormat"])
        await viewModel.choose(format: other.format)
        let half = try reads.loaded(viewModel)
        #expect(!half.atClock)
        #expect(try reads.table(half).evidence == other.evidence)
    }

    // MARK: The player page

    @Test(arguments: [false, true])
    func theFormatsTableIsOnOneClock(read: Bool) async throws {
        for player in Reads.parity.players {
            let model = try await reads.page(player, offline: !read)
            let table = try #require(model.formats)
            let want = try #require(player.formats[read ? "read" : "run"])
            #expect(table.rankHead == Words.FormatsRank.head)
            #expect(table.rows.map(\.rank) == want.rows
                .map { $0.rank.map { "\(player.position) \($0)" } ?? Words.Box.none })
            #expect(table.rows.map(\.points) == want.rows
                .map { $0.points.map { Formatting.fixed($0) } ?? Words.Box.none })
            #expect(table.rows.map(\.vor) == want.rows.map { $0.vor.map { BoardFigures.signed($0) } ?? Words.Box.none })
            #expect(table.footnote == want.footnote, "\(player.name)")
            let head = read ? player.order.positionRank : player.run.positionRank
            #expect(model.hero.pill == "\(player.position) \(head)", "\(player.name)")
        }
    }

    // MARK: Every screen against the Rankings

    /// What a screen shows of a player: his pill ("RB 15") and his rest-of-season points where it draws them.
    struct Shown {
        let screen: String
        let pill: String?
        let points: Double?
    }

    /// The three players' rank at their position and rest-of-season points on every screen at the
    /// order's clock are the Rankings' (the web's one-value.test.ts over the apps' screens).
    @Test func everyScreenAgreesWithTheRankings() async throws {
        let rankings = try RankingsModel(
            advice: Reads.order().answer, chip: nil, query: "", inSeason: true, zone: Reads.zone, now: Reads.now
        )
        let board = try Reads.board(order: Reads.order())
        let compared = try await reads.table(reads.loaded(reads.compare(orders: Reads.orders())))
        for player in Reads.parity.players {
            let ranked = try #require(rankings.rows.first { $0.player.key == player.id })
            #expect(ranked.rank == player.order.rank)
            let club = try await reads.club(player.team, orders: Reads.orders())
            let page = try await reads.page(player, offline: false)
            let row = { (rows: [BoardRow]) in rows.first { $0.id == player.id } }
            let shown = [
                Shown(
                    screen: "board",
                    pill: row(board.rows)?.pill,
                    points: row(board.rows).flatMap { Double($0.projected) }
                ),
                Shown(
                    screen: "club",
                    pill: row(club.rows)?.pill,
                    points: row(club.rows).flatMap { Double($0.projected) }
                ),
                Shown(
                    screen: "player", pill: page.hero.pill,
                    points: page.formats?.rows.first.flatMap { Double($0.points) }
                ),
                Shown(screen: "formats", pill: page.formats?.rows.first?.rank, points: nil),
            ]
            for screen in shown {
                #expect(screen.pill == ranked.player.pill, "\(screen.screen): \(player.name)")
                #expect(screen.points.map { $0 == Double(ranked.total) } != false, "\(screen.screen): \(player.name)")
            }
            // Compare draws the first two players.
            if let column = compared.heads.firstIndex(where: { $0.id == player.id }) {
                #expect(compared.heads[column].pill == ranked.player.pill, "compare: \(player.name)")
                let ourRank = compared.rows.first { $0.label == "Our rank" }?.cells[column].text
                #expect(ourRank == String(ranked.rank), "compare: \(player.name)")
            }
        }
    }
}
