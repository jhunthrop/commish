import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Account screen's reads and writes through the generated client: the account (GET /me), the
/// leagues followed (GET /leagues/attached) with detach (DELETE) and restore (POST .../restore), the
/// paired devices (GET /devices) with unpair (DELETE /devices/{id}); each refusal the API's sentence.
struct AccountScreenAPITests {
    private static let base = URL(string: "http://localhost:8080")!
    private static let phone = "6f1d1c52-2626-4a26-9a26-0000000000d1"

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport
        ))
    }

    private static func client(_ status: HTTPResponse.Status, _ body: Data) -> APIClient {
        client(AnswerTransport(status: status, body: body))
    }

    private static let empty = Data(#"{"ok":true,"data":null,"error":null,"request_id":"r"}"#.utf8)

    private static func refused(_ code: String, _ message: String) -> Data {
        Data(#"{"ok":false,"data":null,"error":{"code":"\#(code)","message":"\#(message)"},"request_id":"r"}"#.utf8)
    }

    @Test func theAccountReadsFromTheSharedFixture() async throws {
        let account = try await Self.client(.ok, LineupAPITests.answered("me.json")).me()
        #expect(account.email == "fixture@example.com")
        #expect(account.handle == "fixture")
        #expect(account.membership == nil)
        #expect(account.createdAt == APIDecoding.parseDate("2026-09-01T12:00:00.000Z"))
    }

    @Test func theLeaguesFollowedReadNewestFirst() async throws {
        let leagues = try await Self.client(.ok, LineupAPITests.answered("leagues-attached.json")).attached()
        #expect(leagues.count == 12)
        #expect(leagues.first?.id == Fixture.league)
        #expect(leagues.first?.host.value1 == .ffpc)
    }

    @Test func theDevicesReadWithTheirKindAndLastUse() async throws {
        let devices = try await Self.client(.ok, LineupAPITests.answered("devices.json")).devices()
        #expect(devices.map(\.id) == [Self.phone, "6f1d1c52-2626-4a26-9a26-0000000000d2"])
        #expect(devices.first?.kind?.value1 == .ios)
        #expect(devices.last?.lastUsedAt == nil)
    }

    @Test func detachSendsTheLeaguesDelete() async throws {
        let transport = RecordingTransport(status: .ok, body: Self.empty)
        try await Self.client(transport).detach(id: Fixture.league)
        let sent = await transport.sent
        #expect(sent.first?.method == .delete)
        #expect(sent.first?.path == "/leagues/attached/\(Fixture.league)")
    }

    @Test func restorePostsToTheLeaguesRestore() async throws {
        let transport = RecordingTransport(status: .ok, body: Self.empty)
        try await Self.client(transport).restore(id: Fixture.league)
        let sent = await transport.sent
        #expect(sent.first?.method == .post)
        #expect(sent.first?.path == "/leagues/attached/\(Fixture.league)/restore")
    }

    @Test func aRestoreTheAccountCannotTakeThrowsTheAPIsSentence() async {
        let body = Self.refused("feature_required", "Following more than one league needs many_leagues.")
        await #expect(throws: APIError.envelope(
            code: "feature_required", message: "Following more than one league needs many_leagues."
        )) {
            try await Self.client(.forbidden, body).restore(id: Fixture.league)
        }
    }

    @Test func unpairSendsTheDevicesDelete() async throws {
        let transport = RecordingTransport(status: .ok, body: Self.empty)
        try await Self.client(transport).revokeDevice(id: Self.phone)
        let sent = await transport.sent
        #expect(sent.first?.method == .delete)
        #expect(sent.first?.path == "/devices/\(Self.phone)")
    }

    @Test func aRefusedTokenThrowsOnEveryRead() async {
        await #expect(throws: APIError.status(401)) {
            _ = try await Self.client(.unauthorized, Data()).devices()
        }
        await #expect(throws: APIError.status(401)) {
            _ = try await Self.client(.unauthorized, Data()).attached()
        }
        await #expect(throws: APIError.status(401)) {
            try await Self.client(.unauthorized, Data()).detach(id: Fixture.league)
        }
    }
}
