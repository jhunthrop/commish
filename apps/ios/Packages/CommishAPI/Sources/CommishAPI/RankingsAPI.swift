import Foundation
import OpenAPIRuntime

public typealias OrderAdvice = Components.Schemas.OrderAdvice
public typealias OrderRow = Components.Schemas.OrderRow
public typealias WeekOrderAdvice = Components.Schemas.WeekOrderAdvice
public typealias WeekOrderRow = Components.Schemas.WeekOrderRow
/// A position the order narrows to (the route's `position` query): QB, RB, WR or TE.
public typealias OrderPosition = Operations.Order.Input.Query.PositionPayload
/// The kickers' or defenses' week (the route's `position` query): K or DEF.
public typealias WeekOrderPosition = Components.Parameters.WeekOrderPosition

/// One read of the order (web/src/lib/order/path.ts OrderQuery): a position or every one, the letters a
/// search holds, how many rows, and the byes last, as the Rankings page asks.
public struct OrderQuery: Equatable, Hashable, Sendable {
    public let position: OrderPosition?
    /// Sent only from the API's fewest letters (path.ts MIN_SEARCH), trimmed.
    public let search: String?
    public let limit: Int
    public let byesLast: Bool
    /// The view's rows skipped before this page's first (Lane 280), 0 for the top.
    public let offset: Int

    /// The fewest letters a search sends (the API's minimum).
    public static let minSearch = 2
    /// The most rows one read gives (the API's MaxOrderRows).
    public static let maxLimit = 400

    public init(position: OrderPosition?, search: String?, limit: Int, byesLast: Bool = true, offset: Int = 0) {
        self.position = position
        let trimmed = search?.trimmingCharacters(in: .whitespaces) ?? ""
        self.search = trimmed.count >= Self.minSearch ? trimmed : nil
        self.limit = limit
        self.byesLast = byesLast
        self.offset = offset
    }

    /// The read's route with its query, the cache key of its answer (path.ts orderPath with no league).
    public var route: String {
        var parts = ["limit=\(limit)"]
        if let position {
            parts.append("position=\(position.rawValue)")
        }
        if let search {
            parts.append("q=\(search.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? search)")
        }
        if byesLast {
            parts.append("byes=last")
        }
        if offset > 0 {
            parts.append("offset=\(offset)")
        }
        return "/order?\(parts.joined(separator: "&"))"
    }
}

/// The Rankings screen's reads with no league (web/src/lib/order/api.ts): our rest-of-season order with
/// each player's week, and the kickers' or defenses' week in the published projection's order. The
/// seam the view model's tests replace with a stub.
public protocol RankingsAPI: Sendable {
    func order(_ query: OrderQuery) async throws -> OrderAdvice
    func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice
}

extension APIClient: RankingsAPI {
    public func order(_ query: OrderQuery) async throws -> OrderAdvice {
        let input = Operations.Order.Input(query: .init(
            position: query.position, q: query.search, limit: query.limit, byes: query.byesLast ? .last : nil,
            offset: query.offset > 0 ? query.offset : nil
        ))
        switch try await Self.unwrapped({ try await client.order(input) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
        let input = Operations.WeekOrder.Input(query: .init(position: position))
        switch try await Self.unwrapped({ try await client.weekOrder(input) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
