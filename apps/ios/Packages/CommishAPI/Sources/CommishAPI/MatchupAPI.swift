import Foundation
import OpenAPIRuntime

public typealias MatchupBox = Components.Schemas.MatchupBox
public typealias MatchupBoxSide = Components.Schemas.MatchupBoxSide

/// The Matchup screen's reads (web/src/lib/league/MatchupScreen.svelte): the league read, whose matchup
/// keeps the score and the teams, and the week's matchup as a box score. The seam the view model's tests
/// replace with a stub.
public protocol MatchupAPI: Sendable {
    func leagueSync(id: String) async throws -> LeagueSync
    /// The box score, nil where the API has none for the league (MatchupScreen's STANDS_WITHOUT: 404,
    /// 409 and 422, no saved scoring, no current week, a team missing from the read), which the screen
    /// stands without; a refused token and a failure throw, as the league's read does.
    func matchup(id: String) async throws -> MatchupBox?
}

extension APIClient: MatchupAPI {
    public func matchup(id: String) async throws -> MatchupBox? {
        switch try await Self.unwrapped({ try await client.leagueMatchup(path: .init(id: id)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case .notFound, .conflict, .unprocessableContent:
            return nil
        case let .badRequest(answer):
            // Only a roster asked (Lane 204) is refused so; this read asks none until B178.
            throw try Self.problem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
