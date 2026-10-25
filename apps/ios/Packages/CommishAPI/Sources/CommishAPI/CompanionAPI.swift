import Foundation
import OpenAPIRuntime

public typealias Companion = Components.Schemas.Companion
public typealias CompanionPick = Components.Schemas.CompanionPick
public typealias CompanionSummary = Components.Schemas.CompanionSummary
public typealias CompanionCreate = Components.Schemas.CompanionCreate
public typealias CompanionSeat = Components.Schemas.CompanionSeat
public typealias RoomCard = Components.Schemas.RoomCard
public typealias RoomBoard = Components.Schemas.RoomBoard
public typealias RoomBoardPlayer = Components.Schemas.BoardPlayer
public typealias RoomSettings = Components.Schemas.LeagueSettings
public typealias MockReport = Components.Schemas.MockReport

/// What the API said when it would not follow a draft (POST /companions answered 400, 403, 404, 422 or
/// 502): the sentence the start page shows, the field's own first (alphabetically, as the API's JSON
/// writes its fields and the web's `Object.values(fields)[0]` reads them), else the API's message.
public struct CompanionRefused: Error, Equatable, Sendable {
    public let sentence: String

    public init(sentence: String) {
        self.sentence = sentence
    }
}

/// The live-draft companion's reads (web/src/lib/companion/api.ts): the account's followed drafts,
/// following a draft on another platform from a seat, the followed draft since the pick count the
/// screen holds, and the report once the platform says the draft is over. The seam the view models'
/// tests replace with a stub.
public protocol CompanionAPI: Sendable {
    /// GET /companions: up to five, newest first.
    func recentCompanions() async throws -> [CompanionSummary]
    /// POST /companions: the followed draft, the board with it. A refusal throws ``CompanionRefused``.
    func followDraft(_ body: CompanionCreate) async throws -> Companion
    /// GET /companions/{id}?since=: every pick after `since`, the board only when `since` is 0.
    func companion(id: String, since: Int) async throws -> Companion
    /// GET /companions/{id}/report: the report on the finished draft.
    func companionReport(id: String) async throws -> MockReport
}

extension APIClient: CompanionAPI {
    public func recentCompanions() async throws -> [CompanionSummary] {
        switch try await Self.unwrapped({ try await client.listCompanions() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .forbidden(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func followDraft(_ body: CompanionCreate) async throws -> Companion {
        switch try await Self.unwrapped({ try await client.createCompanion(body: .json(body)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.refused(answer.body.json)
        case let .forbidden(answer):
            throw try Self.refused(answer.body.json)
        case let .notFound(answer):
            throw try Self.refused(answer.body.json)
        case let .unprocessableContent(answer):
            throw try Self.refused(answer.body.json)
        case let .badGateway(answer):
            throw try Self.refused(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func companion(id: String, since: Int) async throws -> Companion {
        let input = Operations.GetCompanion.Input(path: .init(id: id), query: .init(since: since))
        switch try await Self.unwrapped({ try await client.getCompanion(input) }) {
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

    public func companionReport(id: String) async throws -> MockReport {
        switch try await Self.unwrapped({ try await client.companionReport(path: .init(id: id)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    /// A refused follow in the start page's words; a refused token stays the envelope's, so it signs out.
    static func refused(_ envelope: Components.Schemas.Envelope) throws -> any Error {
        guard let error = envelope.error?.value1 else {
            return APIError.emptyEnvelope
        }
        if error.code == "unauthorized" {
            return APIError.envelope(code: error.code, message: error.message)
        }
        let field = error.fields?.additionalProperties.min { $0.key < $1.key }?.value
        return CompanionRefused(sentence: field ?? error.message)
    }
}
