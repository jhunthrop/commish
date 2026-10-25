import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Waivers screen's routes through the generated client: the players free to add at every fixture
/// clock (each line carrying the API's game state, the pickup rule in the API's sentence), the ESPN
/// stand-in's answer with the claim open, and the claim's two calls, planned with its bid where the league
/// bids and made with its token, each outcome as the fixture API answered it.
struct WaiversAPITests {
    private static let base = URL(string: "http://localhost:8080")!
    static let pending = "6f1d1c52-2626-4a26-9a26-000000000037"
    static let refused = "6f1d1c52-2626-4a26-9a26-000000000036"
    static let done = "6f1d1c52-2626-4a26-9a26-000000000035"
    static let week = "2026-10-17T17-00-00Z"

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport
        ))
    }

    private static func client(_ status: HTTPResponse.Status, _ body: Data) -> APIClient {
        client(AnswerTransport(status: status, body: body))
    }

    @Test(arguments: LineupAPITests.clocks)
    func theAddsReadAtEveryClockWithEachLinesGameStateAndThePickupRule(clock: String) async throws {
        let body = try LineupAPITests.answered("waivers-\(Fixture.league)-\(clock).json")
        let advice = try await Self.client(.ok, body).waivers(id: Fixture.league, position: nil)
        #expect(advice.rows.isEmpty == false)
        #expect(advice.basis.isEmpty == false, "the pickup rule is the API's sentence")
        let lines = advice.rows.map(\.add) + advice.roster
        let stated: Bool = lines.allSatisfy { $0.gameState?.value1.state.value1 != nil }
        #expect(stated, "\(clock)")
        #expect(advice.moves.claim.value1 != .available, "the FFPC stand-in takes no claim from here")
    }

    @Test func theESPNStandInOpensTheClaim() async throws {
        let body = try LineupAPITests.answered("waivers-\(Self.pending)-\(Self.week).json")
        let advice = try await Self.client(.ok, body).waivers(id: Self.pending, position: nil)
        #expect(advice.moves.claim.value1 == .available)
        #expect(advice.pickups.first?.add.player.hostId == "4808766")
    }

    @Test func aClaimIsPlannedWithItsBidAndMadeOnceWithItsToken() async throws {
        let plan = try LineupAPITests.answered("claim-plan-\(Self.pending).json")
        let transport = RecordingTransport(status: .ok, body: plan)
        let move = HostMoveInput(
            kind: .init(value1: .claim), week: 6, changes: [],
            claim: .init(value1: .init(add: "4808766", drop: "12345", bid: nil))
        )
        let ready = try await Self.client(transport).planMove(id: Self.pending, move: move)
        #expect(ready.confirm == "fixture-token")
        #expect(ready.bid?.value1.max == 87)
        #expect(ready.bid?.value1.leftKnown == true)
        let sent = await transport.sent
        let data = try #require(sent.first?.body)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["kind"] as? String == "claim")
        #expect((body["claim"] as? [String: Any])?["add"] as? String == "4808766")
    }

    @Test(arguments: [(done, "done"), (refused, "refused"), (pending, "pending")])
    func eachOutcomeOfAClaimReads(league: String, outcome: String) async throws {
        let result = try LineupAPITests.answered("claim-move-\(league).json")
        let move = HostMoveInput(kind: .init(value1: .claim), week: 6, changes: [])
        let made = try await Self.client(.ok, result).makeMove(id: league, move: move, confirm: "fixture-token")
        #expect(made.outcome.value1?.rawValue == outcome)
        #expect((made.hostWords != nil) == (outcome == "refused"))
        #expect((made.processesAt != nil) == (outcome == "pending"))
    }

    @Test func aPositionIsSentAsTheRoutesQuery() async throws {
        let body = try LineupAPITests.answered("waivers-\(Fixture.league)-DEF-\(Self.week).json")
        let transport = RecordingTransport(status: .ok, body: body)
        let advice = try await Self.client(transport).waivers(id: Fixture.league, position: .def)
        #expect(advice.rows.allSatisfy { $0.add.player.position == "DEF" })
        let sent = await transport.sent
        #expect(sent.first?.path == "/leagues/attached/\(Fixture.league)/waivers?position=DEF")
        _ = try await Self.client(transport).waivers(id: Fixture.league, position: nil)
        #expect(await transport.sent.last?.path == "/leagues/attached/\(Fixture.league)/waivers")
    }

    @Test func aRefusedReadThrowsItsSentenceAndAFailedOneItsStatus() async {
        let body = LineupAPITests.problem("host_failed", "FFPC is not answering.")
        await #expect(throws: APIError.envelope(code: "host_failed", message: "FFPC is not answering.")) {
            try await Self.client(.badGateway, body).waivers(id: Fixture.league, position: nil)
        }
        await #expect(throws: APIError.status(401)) {
            try await Self.client(.unauthorized, Data()).waivers(id: Fixture.league, position: nil)
        }
    }
}
