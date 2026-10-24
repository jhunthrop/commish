@testable import CommishAPI
import Foundation
import HTTPTypes
import Testing

struct TransportTests {
    @Test func aSignedRequestCarriesTheBearerAndTheRequestID() {
        let request = HTTPRequest(method: .get, scheme: "https", authority: "api.example", path: "/leagues/attached")
        let signed = DeviceAuthMiddleware.signed(request, token: "tok-1", requestID: "req-1")
        #expect(signed.headerFields[.authorization] == "Bearer tok-1")
        #expect(signed.headerFields[DeviceAuthMiddleware.requestIDHeader] == "req-1")
        #expect(request.headerFields[.authorization] == nil)
    }

    @Test func signedOutSendsNoAuthorization() {
        let request = HTTPRequest(method: .get, scheme: "https", authority: "api.example", path: "/x")
        let signed = DeviceAuthMiddleware.signed(request, token: nil, requestID: "req-2")
        #expect(signed.headerFields[.authorization] == nil)
        #expect(signed.headerFields[DeviceAuthMiddleware.requestIDHeader] == "req-2")
    }

    @Test func datesReadWithAndWithoutAFraction() throws {
        let transcoder = APIDateTranscoder()
        let whole = try transcoder.decode("2026-10-17T16:56:00Z")
        let fraction = try transcoder.decode("2026-10-17T16:56:00.000Z")
        #expect(whole == fraction)
        #expect(throws: DecodingError.self) { try transcoder.decode("Saturday") }
    }

    @Test func thePairRequestCarriesKindAndVerifier() throws {
        let input = PairInput(code: "abc", name: "Justin's iPhone", kind: .ios, codeVerifier: "v-123")
        let request = try PairingClient.request(input, baseURL: #require(URL(string: "http://localhost:8080")))
        #expect(request.url?.absoluteString == "http://localhost:8080/devices/pair")
        #expect(request.httpMethod == "POST")
        let body = try #require(request.httpBody)
        let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(json == ["code": "abc", "name": "Justin's iPhone", "kind": "ios", "code_verifier": "v-123"])
    }

    @Test func aPairAnswerYieldsTheTokenAndTheDevice() throws {
        let body = Data(#"""
        {"ok":true,"data":{"token":"secret","device":{"id":"d-1","name":"x","scopes":["session"],
        "created_at":"2026-10-24T00:00:00Z","last_used_at":null,"kind":"ios"}},"error":null,"request_id":"r"}
        """#.utf8)
        #expect(try PairingClient.answer(body, status: 201) == PairedDevice(token: "secret", deviceID: "d-1"))
    }

    @Test func aRefusedPairThrowsTheAPIsWords() {
        let body = Data(
            #"{"ok":false,"data":null,"error":{"code":"invalid","message":"That code has expired."},"request_id":"r"}"#
                .utf8
        )
        #expect(throws: APIError.envelope(code: "invalid", message: "That code has expired.")) {
            try PairingClient.answer(body, status: 400)
        }
    }
}
