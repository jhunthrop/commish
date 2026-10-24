import Foundation
import OpenAPIRuntime

public typealias LeagueSync = Components.Schemas.LeagueSync
public typealias Scoreboard = Components.Schemas.Scoreboard

/// The league reads a screen's view model asks for: the seam tests replace with a fixture or a
/// failing transport.
public protocol LeagueAPI: Sendable {
    func leagueSync(id: String) async throws -> LeagueSync
    func scoreboard(id: String) async throws -> Scoreboard
}

/// The generated client behind ``LeagueAPI``: each operation's documented answers unwrapped, an
/// error answer thrown as the API's own code and sentence.
public struct APIClient: LeagueAPI {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    public init(baseURL: URL, tokens: any TokenSource) {
        self.init(client: Transport.client(baseURL: baseURL, tokens: tokens))
    }

    public func leagueSync(id: String) async throws -> LeagueSync {
        switch try await Self.unwrapped({ try await client.leagueSync(path: .init(id: id)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func scoreboard(id: String) async throws -> Scoreboard {
        switch try await Self.unwrapped({ try await client.leagueScoreboard(path: .init(id: id)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            throw try Self.problem(answer.body.json)
        case let .unprocessableContent(answer):
            throw try Self.problem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    /// The generated client wraps a transport's failure (no network, a timeout) in its own error: the
    /// caller gets the failure itself, so the screen can say "no connection" in words.
    static func unwrapped<T>(_ call: () async throws -> T) async throws -> T {
        do {
            return try await call()
        } catch let error as ClientError {
            throw error.underlyingError
        }
    }

    static func payload<T>(_ data: T?) throws -> T {
        guard let data else { throw APIError.emptyEnvelope }
        return data
    }

    static func problem(_ envelope: Components.Schemas.Envelope) -> APIError {
        guard let error = envelope.error?.value1 else { return .emptyEnvelope }
        return .envelope(code: error.code, message: error.message)
    }
}
