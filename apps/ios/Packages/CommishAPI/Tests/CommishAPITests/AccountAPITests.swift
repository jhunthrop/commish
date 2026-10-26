import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The shell's account reads and writes through the generated client: GET /me's leagues (with their
/// scoring, for the switch's line), the selected league and the site's season; PUT /me/league as a
/// write that never fails the choice except on a refused token.
struct AccountAPITests {
    private static let base = URL(string: "http://localhost:8080")!

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport
        ))
    }

    private static func client(_ status: HTTPResponse.Status, _ body: Data) -> APIClient {
        client(AnswerTransport(status: status, body: body))
    }

    /// A ContextLeague as GET /me sends it.
    static func league(
        _ id: String, name: String, host: String = "sleeper", scoring: String = "ppr", format: String = "ppr",
        phase: String = "in_season", draftAt: String? = nil, team: String = "", standing: String = "null"
    ) -> String {
        let draft = draftAt.map { "\"\($0)\"" } ?? "null"
        return """
        {"id":"\(id)","name":"\(name)","host":"\(host)","team_name":"\(team)","standing":\(standing),\
        "scoring":"\(scoring)",\
        "format":"\(format)","settings_league_id":null,"phase":"\(phase)","phase_basis":"Read.",\
        "draft_at":\(draft),"playoff_start_week":null,"waivers_open":true}
        """
    }

    /// GET /me's envelope with the leagues, the selected one and the site's season.
    static func me(leagues: [String], selected: String?, season: String = "in_season") -> Data {
        let list = leagues.joined(separator: ",")
        let account = """
        {"id":"a","email":"m@example.invalid","first_name":null,"last_name":null,"handle":null,"features":[],\
        "draft_pass":null,"membership":null,"league":\(selected ?? "null"),"leagues":[\(list)],\
        "format":"ppr","season":{"phase":"\(season)","week":7,"basis":"Week 7."},"created_at":"2026-09-01T00:00:00Z"}
        """
        return Data(#"{"ok":true,"data":\#(account),"error":null,"request_id":"r"}"#.utf8)
    }

    @Test func theAccountCarriesTheLeaguesTheSelectionAndTheSeason() async throws {
        let first = Self.league(
            "l-1", name: "Office Pool", scoring: "half_ppr", format: "superflex", team: "McConkey Kong Country",
            standing: #"{"wins":5,"losses":1,"ties":0,"place":2,"teams":12}"#
        )
        let second = Self.league(
            "l-2", name: "", host: "ffpc", scoring: "te_premium", phase: "pre_draft", draftAt: "2026-10-21T17:00:00Z"
        )
        let context = try await Self.client(
            .ok,
            Self.me(leagues: [first, second], selected: second, season: "preseason")
        )
        .account()
        #expect(context.leagues.map(\.id) == ["l-1", "l-2"])
        #expect(context.selected == "l-2")
        #expect(context.season == .preseason)
        #expect(context.leagues[0].scoring == .halfPpr)
        #expect(context.leagues[0].format == .superflex)
        #expect(context.leagues[0].teamName == "McConkey Kong Country")
        #expect(context.leagues[0].standing?.place == 2)
        #expect(context.leagues[1].standing == nil)
        #expect(context.leagues[1].host.value1 == .ffpc)
        #expect(context.leagues[1].phase == .preDraft)
        #expect(context.leagues[1].draftAt == APIDecoding.parseDate("2026-10-21T17:00:00Z"))
    }

    @Test func noLeagueAndASeasonThisBuildDoesNotKnowReadAsNone() async throws {
        let context = try await Self.client(.ok, Self.me(leagues: [], selected: nil, season: "super_bowl_week"))
            .account()
        #expect(context.leagues.isEmpty)
        #expect(context.selected == nil)
        #expect(context.season == nil)
    }

    @Test func aScoringThisBuildDoesNotKnowStillReadsTheLeague() async throws {
        let odd = Self.league("l-1", name: "Odd", scoring: "six_point_passing", format: "dynasty_plus")
        let context = try await Self.client(.ok, Self.me(leagues: [odd], selected: nil)).account()
        #expect(context.leagues.first?.scoring == nil)
        #expect(context.leagues.first?.format == nil)
    }

    @Test func aRefusedTokenSignsOut() async {
        let refused = Data(
            #"{"ok":false,"data":null,"error":{"code":"unauthorized","message":"Sign in."},"request_id":"r"}"#
                .utf8
        )
        await #expect(throws: APIError.envelope(code: "unauthorized", message: "Sign in.")) {
            _ = try await Self.client(.unauthorized, refused).account()
        }
    }

    @Test func selectingALeagueSendsItsID() async throws {
        let transport = RecordingTransport(status: .ok, body: Self.me(leagues: [], selected: nil))
        #expect(try await Self.client(transport).selectLeague(id: "l-2"))
        let sent = await transport.sent
        #expect(sent.count == 1)
        #expect(sent.first?.path == "/me/league")
        #expect(sent.first?.method == .put)
        let body = try #require(sent.first?.body)
        let choice = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(choice["league_id"] as? String == "l-2")
    }

    @Test(arguments: [HTTPResponse.Status.notFound, .internalServerError, .badGateway])
    func aSelectionTheAPICannotTakeIsNotTaken(status: HTTPResponse.Status) async throws {
        let problem = Data(#"{"ok":false,"data":null,"error":{"code":"not_found","message":"No."},"request_id":"r"}"#
            .utf8)
        #expect(try await !Self.client(status, problem).selectLeague(id: "gone"))
    }

    @Test func aSelectionWithARefusedTokenThrows() async {
        await #expect(throws: APIError.status(401)) {
            try await Self.client(.unauthorized, Data()).selectLeague(id: "l-1")
        }
    }
}

/// Answers every request with the status and the body, as JSON.
struct AnswerTransport: ClientTransport {
    let status: HTTPResponse.Status
    let body: Data

    func send(
        _: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        (HTTPResponse(status: status, headerFields: [.contentType: "application/json"]), HTTPBody(body))
    }
}

/// Answers as AnswerTransport, keeping each request's method, path and body.
actor RecordingTransport: ClientTransport {
    struct Sent: Sendable {
        let method: HTTPRequest.Method
        let path: String?
        let body: Data?
    }

    let status: HTTPResponse.Status
    let answer: Data
    private(set) var sent: [Sent] = []

    init(status: HTTPResponse.Status, body: Data) {
        self.status = status
        answer = body
    }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let data: Data? = if let body {
            try await Data(collecting: body, upTo: 1 << 20)
        } else {
            nil
        }
        sent.append(Sent(method: request.method, path: request.path, body: data))
        return (HTTPResponse(status: status, headerFields: [.contentType: "application/json"]), HTTPBody(answer))
    }
}
