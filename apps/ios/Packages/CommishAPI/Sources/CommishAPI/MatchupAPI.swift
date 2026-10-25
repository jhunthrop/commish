import Foundation
import OpenAPIRuntime

public typealias MatchupBox = Components.Schemas.MatchupBox
public typealias MatchupBoxSide = Components.Schemas.MatchupBoxSide

/// The Matchup screen's reads (web/src/lib/league/MatchupScreen.svelte): the league read, whose matchup
/// keeps the score and the teams, the week's matchup as a box score, and for another team's game the
/// scoreboard its score is read from (the League home's reads, Lane 206). The seam the view model's
/// tests replace with a stub.
public protocol MatchupAPI: LeagueAPI {
    /// The box score of the member's game (`roster` nil) or of the game `roster` plays in (Lane 204's
    /// `?roster=`, a scoreboard side's roster); nil where the API has none (MatchupScreen's
    /// STANDS_WITHOUT: 404, 409 and 422, no saved scoring, no current week, a team missing from the
    /// read), which the screen stands without; a refused token and a failure throw, as the league's
    /// read does.
    func matchup(id: String, roster: Int?) async throws -> MatchupBox?
}

extension APIClient: MatchupAPI {
    public func matchup(id: String, roster: Int?) async throws -> MatchupBox? {
        switch try await Self.unwrapped({
            try await client.leagueMatchup(path: .init(id: id), query: .init(roster: roster))
        }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case .notFound, .conflict, .unprocessableContent:
            return nil
        case let .badRequest(answer):
            // Only a roster that is no roster id is refused so (Lane 204): a scoreboard's never is.
            throw try Self.problem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
