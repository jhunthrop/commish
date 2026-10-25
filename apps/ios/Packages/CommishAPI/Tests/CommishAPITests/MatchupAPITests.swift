import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Matchup screen's reads through the generated client: the box score and the league read at every
/// fixture clock (each starter's line carrying the API's game state), the refusals the screen stands
/// without the box for, and the ones it does not.
struct MatchupAPITests {
    private static let base = URL(string: "http://localhost:8080")!

    private static func client(_ status: HTTPResponse.Status, _ body: Data) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()),
            transport: AnswerTransport(status: status, body: body)
        ))
    }

    @Test(arguments: LineupAPITests.clocks)
    func theBoxReadsAtEveryClockWithEachStartersGameState(clock: String) async throws {
        let body = try LineupAPITests.answered("matchup-\(Fixture.league)-\(clock).json")
        let box = try #require(try await Self.client(.ok, body).matchup(id: Fixture.league))
        #expect(box.week == 6)
        #expect(box.sides.map(\.rosterId) == [1, 7])
        let starters = box.sides.flatMap(\.starters)
        #expect(starters.count == 10)
        let stated: Bool = starters.allSatisfy { $0.line.gameState?.value1.state.value1 != nil }
        #expect(stated, "\(clock)")
    }

    @Test(arguments: LineupAPITests.clocks)
    func theLeagueReadAtEveryClockKeepsTheScore(clock: String) async throws {
        let body = try LineupAPITests.answered("sync-\(Fixture.league)-\(clock).json")
        let sync = try await Self.client(.ok, body).leagueSync(id: Fixture.league)
        #expect(sync.matchup?.value1.mine.rosterId == sync.me)
    }

    @Test(arguments: [HTTPResponse.Status.notFound, .conflict, .unprocessableContent])
    func aBoxTheAPIHasNoneForIsNone(status: HTTPResponse.Status) async throws {
        let body = LineupAPITests.problem("no_scoring", "This league has no saved scoring yet.")
        #expect(try await Self.client(status, body).matchup(id: Fixture.league) == nil)
    }

    @Test func aPlatformThatDidNotAnswerThrowsItsSentence() async throws {
        let body = LineupAPITests.problem("host_failed", "FFPC is not answering.")
        await #expect(throws: APIError.envelope(code: "host_failed", message: "FFPC is not answering.")) {
            try await Self.client(.badGateway, body).matchup(id: Fixture.league)
        }
    }

    @Test func aRefusedTokenThrowsItsStatus() async throws {
        await #expect(throws: APIError.status(401)) {
            try await Self.client(.unauthorized, Data()).matchup(id: Fixture.league)
        }
    }
}
