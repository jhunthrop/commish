import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The shell's reads through the generated client: the followed leagues as the league switch names
/// them, and the site's own season, which sets the bar with no league followed.
struct AccountAPITests {
    private static let base = URL(string: "http://localhost:8080")!

    private static func client(_ status: HTTPResponse.Status, _ body: Data) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()),
            transport: AnswerTransport(status: status, body: body)
        ))
    }

    private static func season(_ phase: String) -> Data {
        let data = #"{"phase":"\#(phase)","week":7,"basis":"Week 7 kicked off."}"#
        return Data(#"{"ok":true,"data":\#(data),"error":null,"request_id":"r"}"#.utf8)
    }

    /// A fixture file as the API sends it over the wire, its request id beside the envelope.
    private static func answered(_ file: Data) throws -> Data {
        var envelope = try #require(JSONSerialization.jsonObject(with: file) as? [String: Any])
        envelope["request_id"] = "r"
        return try JSONSerialization.data(withJSONObject: envelope)
    }

    @Test func theFollowedLeaguesCarryWhatTheSwitchNames() async throws {
        let answer = try Self.answered(Fixture.data("leagues-attached.json"))
        let leagues = try await Self.client(.ok, answer).followedLeagues()
        #expect(leagues.count == 12)
        let first = try #require(leagues.first)
        #expect(first.id == Fixture.league)
        #expect(first.name == "S.U.C.K. - Severely Underrated Carolina Keepers")
        #expect(first.host.value1 == .ffpc)
        #expect(first.phase == .inSeason)
        #expect(first.draftAt == nil)
        let drafting = try #require(leagues.first { $0.id.hasSuffix("040") })
        #expect(drafting.phase == .preDraft)
        #expect(drafting.draftAt == APIDecoding.parseDate("2026-10-21T17:00:00Z"))
    }

    @Test(arguments: [
        ("preseason", SitePhase.preseason), ("in_season", .inSeason), ("playoffs", .playoffs),
        ("offseason", .offseason),
    ])
    func theSitesSeasonReadsItsPhase(word: String, phase: SitePhase) async throws {
        #expect(try await Self.client(.ok, Self.season(word)).siteSeason() == phase)
    }

    @Test func aSeasonThisBuildDoesNotKnowReadsAsNone() async throws {
        #expect(try await Self.client(.ok, Self.season("super_bowl_week")).siteSeason() == nil)
    }

    /// An API from before GET /season answers 404 there: no season read, which the bar reads as in
    /// season.
    @Test func anAPIWithNoSeasonRouteReadsAsNone() async throws {
        #expect(try await Self.client(.notFound, Data("404 page not found".utf8)).siteSeason() == nil)
    }

    @Test func aFailedSeasonReadThrows() async {
        await #expect(throws: APIError.status(500)) {
            _ = try await Self.client(.internalServerError, Data()).siteSeason()
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
