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
}
