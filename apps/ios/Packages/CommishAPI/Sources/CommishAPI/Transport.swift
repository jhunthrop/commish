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

/// The If-None-Match a run route's read names, sent as the API gave the ETag. The generator writes a
/// header's value URI-encoded (the quotes and the slash escaped), and the API compares an ETag byte for
/// byte, so the kept ETag would never match; this middleware puts the header back as it was given.
public struct ETagMiddleware: ClientMiddleware {
    public static let ifNoneMatch = HTTPField.Name("If-None-Match")!

    public init() {}

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID _: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        try await next(Self.asGiven(request), body, baseURL)
    }

    /// The request with its If-None-Match decoded: a copy, the caller's left as it was.
    public static func asGiven(_ request: HTTPRequest) -> HTTPRequest {
        guard let sent = request.headerFields[ifNoneMatch], let given = sent.removingPercentEncoding else {
            return request
        }
        var decoded = request
        decoded.headerFields[ifNoneMatch] = given
        return decoded
    }
}

/// The API's dates: Go writes RFC 3339 with the fraction trimmed (none on a whole second), the
/// fixtures with milliseconds, so both read; a date is written back to the microsecond it was read at.
public struct APIDateTranscoder: DateTranscoder {
    public init() {}

    public func encode(_ date: Date) throws -> String {
        APIDecoding.text(date)
    }

    public func decode(_ text: String) throws -> Date {
        guard let date = APIDecoding.parseDate(text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Not an ISO 8601 date: \(text)"))
        }
        return date
    }
}

/// The generated client over URLSession with the device middleware and the ETag's.
public enum Transport {
    /// The app's session: no URL cache. The app keeps every answer itself (AnswerCache) and a run
    /// route's ETag with it, so a read always reaches the API and a 304 comes back as a 304; URLSession's
    /// own cache would answer a run route from its copy for the route's max-age, and turn a 304 into
    /// that copy's 200 after it.
    public static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    public static func client(baseURL: URL, tokens: any TokenSource, session: URLSession = session) -> Client {
        Client(
            serverURL: baseURL,
            configuration: Configuration(dateTranscoder: APIDateTranscoder()),
            transport: URLSessionTransport(configuration: .init(session: session)),
            middlewares: [DeviceAuthMiddleware(tokens: tokens), ETagMiddleware()]
        )
    }
}
