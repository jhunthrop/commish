import Foundation
import OpenAPIRuntime

public typealias TradeAdvice = Components.Schemas.TradeAdvice
public typealias TradeTeam = Components.Schemas.TradeTeam
public typealias TradeRow = Components.Schemas.TradeRow
public typealias TradeCheck = Components.Schemas.TradeCheck
public typealias TradeCheckInput = Components.Schemas.TradeCheckInput
public typealias TradeSideTotals = Components.Schemas.TradeSideTotals

/// The Trades screen's reads (web/src/lib/league/inseason/TradeScreen.svelte): the trade finder, and the
/// check of one trade with both lineups before and after it (the builder's `/trades/check`). The seam
/// the view model's tests replace with a stub.
public protocol TradesAPI: Sendable {
    /// The finder, or with `player` (a board id) the trades holding him on either side (the Trades
    /// holding picker).
    func trades(id: String, player: String?) async throws -> TradeAdvice
    /// The check of one trade, nil where the API has no check to give: an API older than the route
    /// answers its router's 404 (`not_found`), and the screen stands without the scoreboard. Any other
    /// 404 (the member's team not in the read) throws its sentence, as do a refused token, a refused
    /// trade and a failure.
    func checkTrade(id: String, trade: TradeCheckInput) async throws -> TradeCheck?
}

extension APIClient: TradesAPI {
    /// The router's code for a route it does not have (httpx.CodeNotFound): an API older than the check.
    static let routeNotFound = "not_found"

    public func trades(id: String, player: String?) async throws -> TradeAdvice {
        let output = try await Self.unwrapped {
            try await client.leagueTrades(path: .init(id: id), query: .init(player: player))
        }
        switch output {
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
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func checkTrade(id: String, trade: TradeCheckInput) async throws -> TradeCheck? {
        let output = try await Self.unwrapped {
            try await client.checkLeagueTrade(path: .init(id: id), body: .json(trade))
        }
        switch output {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer):
            let problem = try Self.problem(answer.body.json)
            if case .envelope(code: Self.routeNotFound, _) = problem {
                return nil
            }
            throw problem
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            throw try Self.problem(answer.body.json)
        case let .unsupportedMediaType(answer):
            throw try Self.problem(answer.body.json)
        case let .unprocessableContent(answer):
            throw try Self.problem(answer.body.json)
        case let .tooManyRequests(answer):
            throw try Self.problem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
