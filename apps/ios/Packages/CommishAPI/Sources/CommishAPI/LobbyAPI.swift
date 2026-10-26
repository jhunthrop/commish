import Foundation
import OpenAPIRuntime

public typealias LobbyRoom = Components.Schemas.LobbyRoom
public typealias LobbyFilling = Components.Schemas.LobbyFilling
public typealias LobbySeat = Components.Schemas.LobbySeat
public typealias LobbyFormat = Components.Schemas.LobbyFormat
public typealias LobbySeatView = Components.Schemas.LobbySeatView

/// A join the API refused because the account has no handle yet (409 with `fields.handle`): strangers
/// see each other's handles, so the member picks one first. The API's own sentence for the field.
public struct LobbyHandleNeeded: Error, Equatable, Sendable {
    public let message: String

    public init(message: String) {
        self.message = message
    }
}

/// The lobby's calls (web/src/lib/room/api.ts `rooms`): the formats and how full each filling room is,
/// a seat in one, the room with its board, leaving it, the turn's call, the report, and the handle a
/// join needs. Picks and the queue go over the room's socket, never through these. The seam the view
/// models' tests replace with a stub.
public protocol LobbyAPI: Sendable {
    /// GET /lobbies: each format and how full its filling room is, in the setup page's order.
    func lobbies() async throws -> [LobbyFilling]
    /// POST /lobbies/join: a seat in the format's filling room; `LobbyHandleNeeded` without a handle.
    func join(_ format: LobbyFormat) async throws -> LobbySeat
    /// GET /lobbies/{id}: the room's settings, seats, board and socket, for a drafter seated in it.
    func lobby(id: String) async throws -> LobbyRoom
    /// POST /lobbies/{id}/leave: the seat given up (a filling room frees it, a drafting room hands it to
    /// its stand-in).
    func leave(id: String) async throws
    /// GET /lobbies/{id}/card: our call at the turn on the clock, as in the solo room.
    func lobbyCard(id: String) async throws -> RoomCard
    /// GET /lobbies/{id}/report: the finished lobby's report for the caller's seat.
    func lobbyReport(id: String) async throws -> MockReport
    /// PATCH /me: the handle the room shows the other drafters; the API's sentence when it refuses one.
    func setHandle(_ handle: String) async throws
}

extension APIClient: LobbyAPI {
    public func lobbies() async throws -> [LobbyFilling] {
        switch try await Self.unwrapped({ try await client.listLobbies() }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func join(_ format: LobbyFormat) async throws -> LobbySeat {
        let body = Components.Schemas.LobbyJoin(format: format)
        switch try await Self.unwrapped({ try await client.joinLobby(body: .json(body)) }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer): throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            let envelope = try answer.body.json
            if let handle = envelope.error?.value1.fields?.additionalProperties["handle"] {
                throw LobbyHandleNeeded(message: handle)
            }
            throw Self.problem(envelope)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func lobby(id: String) async throws -> LobbyRoom {
        switch try await Self.unwrapped({ try await client.getLobby(path: .init(id: id)) }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .forbidden(answer): throw try Self.problem(answer.body.json)
        case let .notFound(answer): throw try Self.problem(answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func leave(id: String) async throws {
        switch try await Self.unwrapped({ try await client.leaveLobby(path: .init(id: id)) }) {
        case .ok: return
        case let .forbidden(answer): throw try Self.problem(answer.body.json)
        case let .notFound(answer): throw try Self.problem(answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func lobbyCard(id: String) async throws -> RoomCard {
        switch try await Self.unwrapped({ try await client.lobbyCard(path: .init(id: id)) }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .forbidden(answer): throw try Self.problem(answer.body.json)
        case let .notFound(answer): throw try Self.problem(answer.body.json)
        case let .conflict(answer): throw try Self.problem(answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func lobbyReport(id: String) async throws -> MockReport {
        switch try await Self.unwrapped({ try await client.lobbyReport(path: .init(id: id)) }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .forbidden(answer): throw try Self.problem(answer.body.json)
        case let .notFound(answer): throw try Self.problem(answer.body.json)
        case let .conflict(answer): throw try Self.problem(answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func setHandle(_ handle: String) async throws {
        let body = Components.Schemas.AccountUpdate(handle: handle)
        switch try await Self.unwrapped({ try await client.updateMe(body: .json(body)) }) {
        case .ok: return
        case let .badRequest(answer): throw try Self.fieldProblem(answer.body.json, field: "handle")
        case let .conflict(answer): throw try Self.fieldProblem(answer.body.json, field: "handle")
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    /// A refusal in the words of the field it names when it names one (web: `e.fields.handle ??
    /// e.message`), else the envelope's sentence.
    static func fieldProblem(_ envelope: Components.Schemas.Envelope, field: String) -> APIError {
        guard let error = envelope.error?.value1 else {
            return .emptyEnvelope
        }
        return .envelope(code: error.code, message: error.fields?.additionalProperties[field] ?? error.message)
    }
}
