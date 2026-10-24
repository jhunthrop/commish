import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

/// Where the app finds the signed-in device's token: the Keychain in the app, a fixed one in tests.
/// Nil while signed out, and a request then goes without the header (the API answers 401).
public protocol TokenSource: Sendable {
    func token() async -> String?
}

/// The one middleware every request passes through: the device token as `Authorization: Bearer`, and
/// a fresh `X-Request-Id` so a request is found in the API's logs by the id the app logged.
public struct DeviceAuthMiddleware: ClientMiddleware {
    public static let requestIDHeader = HTTPField.Name("X-Request-Id")!

    private let tokens: any TokenSource
    private let requestID: @Sendable () -> String

    public init(tokens: any TokenSource, requestID: @escaping @Sendable () -> String = { UUID().uuidString }) {
        self.tokens = tokens
        self.requestID = requestID
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID _: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        try await next(Self.signed(request, token: tokens.token(), requestID: requestID()), body, baseURL)
    }

    /// The request with the two headers set: a copy, the caller's left as it was.
    public static func signed(_ request: HTTPRequest, token: String?, requestID: String) -> HTTPRequest {
        var signed = request
        if let token, !token.isEmpty {
            signed.headerFields[.authorization] = "Bearer \(token)"
        }
        signed.headerFields[requestIDHeader] = requestID
        return signed
    }
}

/// The API's dates: Go writes RFC 3339 with the fraction trimmed (none on a whole second), the
/// fixtures with milliseconds, so both read.
public struct APIDateTranscoder: DateTranscoder {
    public init() {}

    public func encode(_ date: Date) throws -> String {
        date.formatted(APIDecoding.fractional)
    }

    public func decode(_ text: String) throws -> Date {
        guard let date = APIDecoding.parseDate(text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Not an ISO 8601 date: \(text)"))
        }
        return date
    }
}

/// The generated client over URLSession with the device middleware.
public enum Transport {
    public static func client(baseURL: URL, tokens: any TokenSource, session: URLSession = .shared) -> Client {
        Client(
            serverURL: baseURL,
            configuration: Configuration(dateTranscoder: APIDateTranscoder()),
            transport: URLSessionTransport(configuration: .init(session: session)),
            middlewares: [DeviceAuthMiddleware(tokens: tokens)]
        )
    }
}
