import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// This phone's push registration through the generated client (Lane 288 over Lane 262's routes): the
/// APNs token PUT on its own device as `{platform: apns, token}`, the DELETE that takes it off, a refusal
/// in the API's sentence; and the switches written whole through PATCH /me `notifications`.
struct PushAPITests {
    private static let base = URL(string: "http://localhost:8080")!
    private static let phone = "6f1d1c52-2626-4a26-9a26-0000000000d1"
    private static let token = "deadbeef00010203deadbeef00010203"

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport
        ))
    }

    private static let registered = Data(
        #"{"ok":true,"data":{"platform":"apns","registered_at":"2026-10-28T12:00:00Z"},"error":null,"request_id":"r"}"#
            .utf8
    )
    private static let empty = Data(#"{"ok":true,"data":null,"error":null,"request_id":"r"}"#.utf8)

    @Test func theTokenIsPutOnThisPhonesDeviceAsAnAPNsToken() async throws {
        let transport = RecordingTransport(status: .ok, body: Self.registered)
        try await Self.client(transport).registerPush(device: Self.phone, token: Self.token)
        let sent = try #require(await transport.sent.first)
        #expect(sent.method == .put)
        #expect(sent.path == "/devices/\(Self.phone)/push")
        let body = try #require(sent.body.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: String] })
        #expect(body == ["platform": "apns", "token": Self.token])
    }

    @Test func removeSendsTheDelete() async throws {
        let transport = RecordingTransport(status: .ok, body: Self.empty)
        try await Self.client(transport).removePush(device: Self.phone)
        let sent = await transport.sent
        #expect(sent.first?.method == .delete)
        #expect(sent.first?.path == "/devices/\(Self.phone)/push")
    }

    @Test func aTokenAnotherMembersPhoneHoldsIsTheAPIsSentence() async {
        let error = #"{"code":"conflict","message":"That token is another account's."}"#
        let body = Data(#"{"ok":false,"data":null,"error":\#(error),"request_id":"r"}"#.utf8)
        await #expect(throws: APIError.envelope(code: "conflict", message: "That token is another account's.")) {
            try await Self.client(RecordingTransport(status: .conflict, body: body))
                .registerPush(device: Self.phone, token: Self.token)
        }
    }

    @Test func theSwitchesArePatchedWholeAndTheAccountReadBack() async throws {
        let transport = try RecordingTransport(status: .ok, body: LineupAPITests.answered("me.json"))
        let change = NotificationSettingsChange(
            timeZone: "America/Chicago", quietStart: "22:00", quietEnd: "07:30",
            kinds: .init(starterStatus: false, weekReads: true, waiverClaims: true)
        )
        let account = try await Self.client(transport).updateNotifications(change)
        #expect(account.email == "fixture@example.com")
        let sent = try #require(await transport.sent.first)
        #expect(sent.method == .patch)
        #expect(sent.path == "/me")
        let body = try #require(sent.body.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        let notifications = try #require(body["notifications"] as? [String: Any])
        #expect(body["handle"] == nil)
        #expect(notifications["time_zone"] as? String == "America/Chicago")
        #expect(notifications["quiet_start"] as? String == "22:00")
        #expect((notifications["kinds"] as? [String: Bool]) == [
            "starter_status": false, "week_reads": true, "waiver_claims": true,
        ])
    }
}
