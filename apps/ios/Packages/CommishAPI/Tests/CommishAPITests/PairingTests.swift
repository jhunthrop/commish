@testable import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The pairing through the generated client against a stub transport: what goes out on the wire and
/// what comes back.
struct PairingTests {
    private let base = URL(string: "http://localhost:8080")!

    @Test func thePairCarriesKindAndVerifierAndYieldsTheToken() async throws {
        let stub = StubTransport(status: .created, body: #"""
        {"ok":true,"data":{"token":"secret","device":{"id":"d-1","name":"x","scopes":["session","league:write"],
        "created_at":"2026-10-24T00:00:00Z","last_used_at":null,"kind":"ios"}},"error":null,"request_id":"r"}
        """#)
        let pairing = PairingClient(client: Client(serverURL: base, transport: stub))
        let input = PairInput(code: "abc", name: "Justin's iPhone", kind: .ios, codeVerifier: "v-123")
        #expect(try await pairing.pair(input) == PairedDevice(token: "secret", deviceID: "d-1"))
        let sent = try #require(await stub.sent)
        #expect(sent.request.method == .post)
        #expect(sent.request.path == "/devices/pair")
        let json = try #require(JSONSerialization.jsonObject(with: sent.body) as? [String: String])
        #expect(json == ["code": "abc", "name": "Justin's iPhone", "kind": "ios", "code_verifier": "v-123"])
    }

    @Test func aRefusedPairThrowsTheAPIsWords() async {
        let stub = StubTransport(
            status: .badRequest,
            body: #"{"ok":false,"data":null,"error":{"code":"invalid","message":"That code has expired."},"#
                + #""request_id":"r"}"#
        )
        let pairing = PairingClient(client: Client(serverURL: base, transport: stub))
        let input = PairInput(code: "abc", name: "x", kind: .ios, codeVerifier: "v")
        await #expect(throws: APIError.envelope(code: "invalid", message: "That code has expired.")) {
            try await pairing.pair(input)
        }
    }
}

/// A transport that keeps the request it was sent and answers with one JSON body.
actor StubTransport: ClientTransport {
    struct Sent {
        let request: HTTPRequest
        let body: Data
    }

    private let status: HTTPResponse.Status
    private let body: String
    private(set) var sent: Sent?

    init(status: HTTPResponse.Status, body: String) {
        self.status = status
        self.body = body
    }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let data = if let body {
            try await Data(collecting: body, upTo: 1 << 20)
        } else {
            Data()
        }
        sent = Sent(request: request, body: data)
        let response = HTTPResponse(status: status, headerFields: [.contentType: "application/json"])
        return (response, HTTPBody(self.body))
    }
}
