import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Trades screen's reads through the generated client: the finder at every fixture clock (each
/// player line carrying the API's game state), the check posted with its trade, an API older than the
/// check answering without one, and the refusals that throw.
struct TradesAPITests {
    private static let base = URL(string: "http://localhost:8080")!
    private static let check = TradeCheckInput(team: 8, give: ["96"], get: ["7526", "8116"])

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport
        ))
    }

    private static func client(_ status: HTTPResponse.Status, _ body: Data) -> APIClient {
        client(AnswerTransport(status: status, body: body))
    }

    @Test(arguments: LineupAPITests.clocks)
    func theFinderReadsAtEveryClockWithEachLinesGameState(clock: String) async throws {
        let body = try LineupAPITests.answered("trades-\(Fixture.league)-\(clock).json")
        let advice = try await Self.client(.ok, body).trades(id: Fixture.league, player: nil)
        #expect(advice.week == 6)
        #expect(advice.teams.count == 11)
        let lines = advice.teams.flatMap { $0.trades.flatMap { $0.give + $0.get } }
        #expect(!lines.isEmpty)
        let stated: Bool = lines.allSatisfy { $0.gameState?.value1.state.value1 != nil }
        #expect(stated, "\(clock)")
    }

    @Test func theCheckPostsItsTradeAndReadsBothLineups() async throws {
        let body = try LineupAPITests.answered("trade-check-\(Fixture.league)-2026-10-17T17-00-00Z-1.json")
        let transport = RecordingTransport(status: .ok, body: body)
        let check = try #require(try await Self.client(transport).checkTrade(id: Fixture.league, trade: Self.check))
        #expect(check.totals.yours.projBefore == 98.9)
        #expect(check.totals.yours.seasonAfter == 7.3)
        #expect(check.fills.yoursRoom)
        // Lane 269's fields, read through the generated client (Lane 277).
        #expect(check.trade.value1.myRestOfSeason == 9.6)
        #expect(check.trade.value1.theirRestOfSeason == -9.6)
        #expect(check.acceptable?.value1.theirs == true)
        #expect(check.restOfSeasonBasis?.hasSuffix("A side takes a trade that costs it 12.0 or less.") == true)
        let sent = await transport.sent
        #expect(sent.first?.method == .post)
        #expect(sent.first?.path == "/leagues/attached/\(Fixture.league)/trades/check")
        let data = try #require(sent.first?.body)
        let posted = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(posted["team"] as? Int == 8)
        #expect(posted["give"] as? [String] == ["96"])
        #expect(posted["get"] as? [String] == ["7526", "8116"])
    }

    @Test func theTradesHoldingOnePlayerAreAskedByHisBoardID() async throws {
        let body = try LineupAPITests.answered("trades-\(Fixture.league)-player-8439-2026-10-17T17-00-00Z.json")
        let transport = RecordingTransport(status: .ok, body: body)
        let advice = try await Self.client(transport).trades(id: Fixture.league, player: "8439")
        let held = advice.teams.flatMap(\.trades).allSatisfy { row in
            (row.give + row.get).contains { $0.player.boardId == "8439" }
        }
        #expect(held)
        #expect(await transport.sent.first?.path == "/leagues/attached/\(Fixture.league)/trades?player=8439")
    }

    @Test func aTeamNotInTheReadIsTheAPIsSentenceNotAnOlderAPI() async throws {
        let body = LineupAPITests.problem("team_not_read", "Your team is not in this league's last read.")
        await #expect(
            throws: APIError.envelope(code: "team_not_read", message: "Your team is not in this league's last read.")
        ) {
            try await Self.client(.notFound, body).checkTrade(id: Fixture.league, trade: Self.check)
        }
    }

    @Test func anAPIOlderThanTheCheckAnswersNone() async throws {
        let body = LineupAPITests.problem("not_found", "No route here")
        #expect(try await Self.client(.notFound, body).checkTrade(id: Fixture.league, trade: Self.check) == nil)
    }

    @Test func aTradeTheCheckRefusesThrowsItsSentence() async throws {
        let body = LineupAPITests.problem("invalid", "Josh Allen is not on your roster.")
        await #expect(throws: APIError.envelope(code: "invalid", message: "Josh Allen is not on your roster.")) {
            try await Self.client(.unprocessableContent, body).checkTrade(id: Fixture.league, trade: Self.check)
        }
    }

    @Test func aRefusedTokenThrowsItsStatus() async throws {
        await #expect(throws: APIError.status(401)) {
            try await Self.client(.unauthorized, Data()).trades(id: Fixture.league, player: nil)
        }
    }
}
