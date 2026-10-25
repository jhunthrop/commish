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
    func trades(id: String) async throws -> TradeAdvice
    /// The check of one trade, nil where the API has no check to give: an API older than the route
    /// answers 404, and the screen stands without the scoreboard. A refused token, a refused trade and a
    /// failure throw.
    func checkTrade(id: String, trade: TradeCheckInput) async throws -> TradeCheck?
}

extension APIClient: TradesAPI {
    public func trades(id: String) async throws -> TradeAdvice {
        switch try await Self.unwrapped({ try await client.leagueTrades(path: .init(id: id)) }) {
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
        case .notFound:
            return nil
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
