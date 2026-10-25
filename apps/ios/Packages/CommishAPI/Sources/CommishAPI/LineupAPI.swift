import Foundation
import OpenAPIRuntime

public typealias LineupAdvice = Components.Schemas.LineupAdvice
public typealias PlayerLine = Components.Schemas.PlayerLine
public typealias LineupSlot = Components.Schemas.LineupSlot
public typealias HostMoveInput = Components.Schemas.HostMoveInput
public typealias HostMoveChange = Components.Schemas.HostMoveChange
public typealias HostMovePlan = Components.Schemas.HostMovePlan
public typealias HostMoveResult = Components.Schemas.HostMoveResult

/// The Start screen's reads and writes (web/src/lib/league/inseason/StartScreen.svelte): the week's
/// lineup, and the move that sets it on the platform, planned in words with a confirm token and then
/// made once with it (spec §10.2). The seam the view model's tests replace with a stub.
public protocol LineupAPI: Sendable {
    func lineup(id: String) async throws -> LineupAdvice
    /// Plans the move against a fresh read of the league: nothing is sent to the platform.
    func planMove(id: String, move: HostMoveInput) async throws -> HostMovePlan
    /// Makes the planned move once with its token: sent to the platform once, never retried.
    func makeMove(id: String, move: HostMoveInput, confirm: String) async throws -> HostMoveResult
}

extension APIClient: LineupAPI {
    public func lineup(id: String) async throws -> LineupAdvice {
        switch try await Self.unwrapped({ try await client.leagueLineup(path: .init(id: id)) }) {
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

    public func planMove(id: String, move: HostMoveInput) async throws -> HostMovePlan {
        let output = try await Self.unwrapped {
            try await client.planHostMove(path: .init(id: id), body: .json(move))
        }
        switch output {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .notFound(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .conflict(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .unprocessableContent(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .tooManyRequests(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func makeMove(id: String, move: HostMoveInput, confirm: String) async throws -> HostMoveResult {
        let output = try await Self.unwrapped {
            try await client.makeHostMove(path: .init(id: id), body: .json(.init(move: move, confirm: confirm)))
        }
        switch output {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .notFound(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .conflict(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .unprocessableContent(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .tooManyRequests(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.moveProblem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    /// A move's refusal in the API's own sentence (move.ts failedStep): the field that names what was
    /// refused (an expired or spent token says so in `confirm`, a move the fresh read refuses in
    /// `move`) before the envelope's message.
    static func moveProblem(_ envelope: Components.Schemas.Envelope) -> APIError {
        guard let error = envelope.error?.value1 else { return .emptyEnvelope }
        let fields = error.fields?.additionalProperties ?? [:]
        return .envelope(code: error.code, message: fields["confirm"] ?? fields["move"] ?? error.message)
    }
}
