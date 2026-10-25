import Foundation
import OpenAPIRuntime

public typealias WaiverAdvice = Components.Schemas.WaiverAdvice
public typealias WaiverRow = Components.Schemas.WaiverRow
public typealias HostBid = Components.Schemas.HostBid

/// The Waivers screen's reads and writes (web/src/lib/league/inseason/WaiverScreen.svelte): the players
/// free to add with the API's pickup rule, and the claim planned in words with a confirm token (and the
/// bid where the league bids) then made once with it, through the same move routes the Start screen
/// uses (spec §10.2). The seam the view model's tests replace with a stub.
public protocol WaiversAPI: Sendable {
    func waivers(id: String) async throws -> WaiverAdvice
    /// Plans the claim against a fresh read of the league: nothing is sent to the platform.
    func planMove(id: String, move: HostMoveInput) async throws -> HostMovePlan
    /// Makes the planned claim once with its token: sent to the platform once, never retried.
    func makeMove(id: String, move: HostMoveInput, confirm: String) async throws -> HostMoveResult
}

extension APIClient: WaiversAPI {
    public func waivers(id: String) async throws -> WaiverAdvice {
        switch try await Self.unwrapped({ try await client.leagueWaivers(path: .init(id: id)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
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
}
