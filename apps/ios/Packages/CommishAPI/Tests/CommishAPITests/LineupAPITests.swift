import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Start screen's routes through the generated client: the lineup at every fixture clock (each
/// line carrying the API's game state), an older answer without the later fields, and the move's two
/// calls, the plan and the make, with their bodies, their answers and their refusals in the API's words.
struct LineupAPITests {
    private static let base = URL(string: "http://localhost:8080")!
    static let clocks = [
        "2026-10-16T02-00-00Z", "2026-10-17T17-00-00Z", "2026-10-18T18-56-00Z",
        "2026-10-19T16-00-00Z", "2026-10-20T00-40-00Z", "2026-10-20T17-00-00Z",
    ]

    static func file(_ clock: String) -> String {
        "lineup-\(Fixture.league)-\(clock).json"
    }

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport
        ))
    }

    private static func client(_ status: HTTPResponse.Status, _ body: Data) -> APIClient {
        client(AnswerTransport(status: status, body: body))
    }

    /// A fixture file as the API sends it over the wire: the fixtures keep the envelope without its
    /// request id, which every answer carries.
    static func answered(_ name: String) throws -> Data {
        var envelope = try #require(JSONSerialization.jsonObject(with: Fixture.data(name)) as? [String: Any])
        envelope["request_id"] = "r"
        return try JSONSerialization.data(withJSONObject: envelope)
    }

    static func envelope(_ json: String) -> Data {
        Data(#"{"ok":true,"data":\#(json),"error":null,"request_id":"r"}"#.utf8)
    }

    static func problem(_ code: String, _ message: String, fields: String = "null") -> Data {
        let error = #"{"code":"\#(code)","message":"\#(message)","fields":\#(fields)}"#
        return Data(#"{"ok":false,"data":null,"error":\#(error),"request_id":"r"}"#.utf8)
    }

    static let move = HostMoveInput(
        kind: .init(value1: .lineup),
        week: 6,
        changes: [
            HostMoveChange(slot: .init(value1: .qb), _in: "4046", out: "96"),
            HostMoveChange(slot: .init(value1: .flex), _in: "7543", out: nil),
        ]
    )

    @Test(arguments: clocks)
    func theLineupReadsAtEveryClockWithEachLinesGameState(clock: String) async throws {
        let advice = try await Self.client(.ok, Self.answered(Self.file(clock))).lineup(id: Fixture.league)
        #expect(advice.week == 6)
        #expect(advice.slots.count == 10)
        let lines = advice.slots.flatMap { [$0.ours] + ($0.host.map { [$0.value1] } ?? []) } + advice.bench
            + advice.reserve
        #expect(lines.allSatisfy { $0.gameState?.value1.state.value1 != nil }, "\(clock)")
    }

    @Test func anOlderAnswerWithoutTheLaterFieldsStillReads() throws {
        var envelope = try #require(
            JSONSerialization.jsonObject(with: Fixture.data(Self.file(Self.clocks[4]))) as? [String: Any]
        )
        var payload = try #require(envelope["data"] as? [String: Any])
        for key in ["week_done", "week_done_state", "missed", "projected_final", "basis_note_list"] {
            payload.removeValue(forKey: key)
        }
        envelope["data"] = payload
        let advice = try APIDecoding.envelopeData(
            LineupAdvice.self, from: JSONSerialization.data(withJSONObject: envelope)
        )
        #expect(advice.weekDone == nil)
        #expect(advice.weekDoneState == nil)
        #expect(advice.missed == nil)
        #expect(advice.projectedFinal == nil)
    }

    @Test func aMoveIsPlannedWithEachChangeAndReadyWithItsToken() async throws {
        let plan = Self.envelope("""
        {"status":"ready","sentence":"Start Patrick Mahomes over Aaron Rodgers at QB, on ESPN now.",\
        "confirm":"tok-1","expires_at":"2026-10-17T17:10:00Z","host_url":"https://fantasy.espn.com","bid":null}
        """)
        let transport = RecordingTransport(status: .ok, body: plan)
        let ready = try await Self.client(transport).planMove(id: Fixture.league, move: Self.move)
        #expect(ready.status.value1 == .ready)
        #expect(ready.confirm == "tok-1")
        #expect(ready.bid == nil)
        let sent = await transport.sent
        #expect(sent.first?.method == .post)
        #expect(sent.first?.path == "/leagues/attached/\(Fixture.league)/moves/plan")
        let data = try #require(sent.first?.body)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["kind"] as? String == "lineup")
        #expect(body["week"] as? Int == 6)
        let changes = try #require(body["changes"] as? [[String: Any]])
        #expect(changes.map { $0["in"] as? String } == ["4046", "7543"])
        #expect(changes.first?["out"] as? String == "96")
        #expect(changes.first?["slot"] as? String == "QB")
    }

    @Test func aPlanTheAPICannotMakeHereReadsWithNoToken() async throws {
        let plan = Self.envelope("""
        {"status":"unavailable","sentence":"Connect ESPN again to agree to moves.","confirm":null,\
        "expires_at":null,"host_url":"","bid":null}
        """)
        let answer = try await Self.client(.ok, plan).planMove(id: Fixture.league, move: Self.move)
        #expect(answer.status.value1 == .unavailable)
        #expect(answer.confirm == nil)
        #expect(answer.hostUrl.isEmpty)
    }

    @Test func aMoveIsMadeOnceWithItsTokenAndEachOutcomeReads() async throws {
        let result = Self.envelope("""
        {"outcome":"refused","sentence":"ESPN did not take the move, and nothing changed.",\
        "host_words":"Alexander Mattison is locked","host_url":"https://fantasy.espn.com",\
        "move_id":"00000000-0000-4000-8000-000000000002","processes_at":null}
        """)
        let transport = RecordingTransport(status: .ok, body: result)
        let made = try await Self.client(transport).makeMove(id: Fixture.league, move: Self.move, confirm: "tok-1")
        #expect(made.outcome.value1 == .refused)
        #expect(made.hostWords == "Alexander Mattison is locked")
        let sent = await transport.sent
        #expect(sent.count == 1)
        #expect(sent.first?.path == "/leagues/attached/\(Fixture.league)/moves")
        let data = try #require(sent.first?.body)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["confirm"] as? String == "tok-1")
        #expect((body["move"] as? [String: Any])?["week"] as? Int == 6)
    }

    @Test func anOutcomeThisBuildDoesNotKnowStillReads() async throws {
        let result = Self.envelope("""
        {"outcome":"queued_for_review","sentence":"ESPN holds it for review.","host_words":null,\
        "host_url":"","move_id":null,"processes_at":null}
        """)
        let made = try await Self.client(.ok, result).makeMove(id: Fixture.league, move: Self.move, confirm: "t")
        #expect(made.outcome.value1 == nil)
        #expect(made.outcome.value2 == "queued_for_review")
    }

    @Test func aRefusalSaysTheFieldThatNamesIt() async {
        let spent = Self.problem("conflict", "Conflict.", fields: #"{"confirm":"This move was already made."}"#)
        await #expect(throws: APIError.envelope(code: "conflict", message: "This move was already made.")) {
            _ = try await Self.client(.conflict, spent).makeMove(id: Fixture.league, move: Self.move, confirm: "t")
        }
        let locked = Self.problem("invalid", "Invalid.", fields: #"{"move":"Aaron Rodgers has kicked off."}"#)
        await #expect(throws: APIError.envelope(code: "invalid", message: "Aaron Rodgers has kicked off.")) {
            _ = try await Self.client(.unprocessableContent, locked).planMove(id: Fixture.league, move: Self.move)
        }
        let plain = Self.problem("rate_limited", "Too many moves. Try again in a minute.")
        await #expect(throws: APIError.envelope(
            code: "rate_limited",
            message: "Too many moves. Try again in a minute."
        )) {
            _ = try await Self.client(.tooManyRequests, plain).planMove(id: Fixture.league, move: Self.move)
        }
    }

    @Test func aMoveWithNoAnswerThrowsTheFailureItself() async {
        await #expect(throws: URLError(.notConnectedToInternet)) {
            _ = try await Self.client(FailingTransport()).makeMove(id: Fixture.league, move: Self.move, confirm: "t")
        }
    }
}

/// Fails every request as a phone with no signal does.
struct FailingTransport: ClientTransport {
    func send(
        _: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        throw URLError(.notConnectedToInternet)
    }
}
