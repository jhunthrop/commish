import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import RunFixtures
import Testing

/// The run routes through the generated client (Lane 185's /run/manifest, /run/boards/{format},
/// /run/adp and /run/designations), over the fixture runs as the API answers them: each answer read
/// with its ETag, the ETag kept sent back as If-None-Match exactly as the API gave it, a 304 read as
/// the kept copy standing, and a refusal in the API's words.
struct RunAPITests {
    private static let base = URL(string: "http://localhost:8080")!

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport,
            middlewares: [ETagMiddleware()]
        ))
    }

    @Test func theStandInsBoardReadsItsTiersAndItsKickersApartWithItsETag() async throws {
        let fixture = RunFixture.standIn
        let tag = try fixture.tag("boards/ppr-12.json")
        let transport = try TaggedTransport(status: .ok, tag: tag, body: fixture.boardAnswer(format: "ppr-12"))
        guard case let .fresh(board, sent) = try await Self.client(transport).board(format: "ppr-12", tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(sent == tag)
        #expect(board.format == "ppr-12")
        #expect(board.rows.count == 400)
        #expect(board.market.count == 48)
        #expect(board.rows.first?.tierDrop == 23.4)
        #expect(board.rows.first?.gap == 1.8)
        let requests = await transport.requests
        #expect(requests.map(\.path) == ["/run/boards/ppr-12"])
        #expect(requests.first?.ifNoneMatch == nil, "nothing kept, nothing named")
    }

    @Test func aKeptETagIsSentAsTheAPIGaveItAndA304KeepsTheCopy() async throws {
        let tag = #"W/"2026-10-21T12-ros/boards/ppr-12.json""#
        let transport = TaggedTransport(status: .notModified, tag: tag, body: Data())
        let read = try await Self.client(transport).board(format: "ppr-12", tag: tag)
        guard case let .unchanged(kept) = read else {
            Issue.record("a 304 is the kept copy")
            return
        }
        #expect(kept == tag)
        #expect(await transport.requests.first?.ifNoneMatch == tag)
    }

    @Test func theContractRunsManifestSaysItsRestOfSeason() async throws {
        let fixture = RunFixture.contract
        let transport = try TaggedTransport(
            status: .ok, tag: fixture.tag("manifest.json"), body: fixture.manifestAnswer()
        )
        guard case let .fresh(manifest, _) = try await Self.client(transport).manifest(tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(manifest.runId == "2026-10-21T12-ros")
        #expect(manifest.formats.first?.rosFromWeek == 7)
        #expect(manifest.formats.first?.rosFromWeekPartial == nil)
        #expect(await transport.requests.map(\.path) == ["/run/manifest"])
    }

    @Test func theADPsSourcesAndTheCaptureRead() async throws {
        let fixture = RunFixture.standIn
        let adp = try TaggedTransport(status: .ok, tag: "W/\"a\"", body: fixture.adpAnswer())
        guard case let .fresh(sources, _) = try await Self.client(adp).adpSources(tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(sources.map(\.drafts) == ["PPR drafts"])
        let capture = try TaggedTransport(status: .ok, tag: "W/\"d\"", body: fixture.designationsAnswer())
        guard case let .fresh(designations, _) = try await Self.client(capture).designations(tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(designations?.players.additionalProperties.isEmpty == false)
        let none = LineupAPITests.envelope(#"{"run_id":"r","designations":null}"#)
        guard case let .fresh(nothing, _) = try await Self.client(TaggedTransport(status: .ok, tag: nil, body: none))
            .designations(tag: nil)
        else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(nothing == nil, "a run with no capture shows no status")
    }

    @Test func aFormatTheRunLacksIsRefusedInTheAPIsWords() async throws {
        let refused = LineupAPITests.problem("not_found", "The run carries no such board.")
        await #expect(throws: APIError.envelope(code: "not_found", message: "The run carries no such board.")) {
            _ = try await Self.client(TaggedTransport(status: .notFound, tag: nil, body: refused))
                .board(format: "half-ppr-12", tag: nil)
        }
    }
}

/// Answers every request with the status, the ETag and the body, keeping each request's path and the
/// If-None-Match it named.
actor TaggedTransport: ClientTransport {
    struct Request: Sendable {
        let path: String?
        let ifNoneMatch: String?
    }

    static let ifNoneMatch = HTTPField.Name("If-None-Match")!
    static let eTag = HTTPField.Name("ETag")!

    let status: HTTPResponse.Status
    let tag: String?
    let body: Data
    private(set) var requests: [Request] = []

    init(status: HTTPResponse.Status, tag: String?, body: Data) {
        self.status = status
        self.tag = tag
        self.body = body
    }

    func send(
        _ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        requests.append(Request(path: request.path, ifNoneMatch: request.headerFields[Self.ifNoneMatch]))
        var fields: HTTPFields = [.contentType: "application/json"]
        if let tag {
            fields[Self.eTag] = tag
        }
        return (HTTPResponse(status: status, headerFields: fields), status == .notModified ? nil : HTTPBody(body))
    }
}
