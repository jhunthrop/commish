import CommishAPI
import Foundation

/// The order as a screen read it: the API's answer and when it landed, the clock its lead says.
public struct OrderAtClock: Equatable, Sendable {
    public let answer: OrderAdvice
    public let landed: Date

    public init(answer: OrderAdvice, landed: Date) {
        self.answer = answer
        self.landed = landed
    }

    /// Each player it places with both figures, by board id.
    public var places: [String: LivePlace] {
        LiveOrder.places(answer)
    }

    /// When it was read (live-board.ts answerReadAt): the league's read when it says one, else the
    /// screen's clock as it landed.
    public var readAt: Date {
        answer.readAt ?? landed
    }

    /// Several reads as one answer, the last one's with every read's rows (each player once): a pair
    /// read by its two names; nil for none.
    public static func merged(_ reads: [OrderAtClock]) -> OrderAtClock? {
        guard var answer = reads.last?.answer, let landed = reads.last?.landed else {
            return nil
        }
        var seen = Set<String>()
        answer.rows = reads.flatMap(\.answer.rows).filter { row in
            seen.insert(row.line.player.boardId ?? row.line.player.name).inserted
        }
        return OrderAtClock(answer: answer, landed: landed)
    }

    /// The lead a screen's basis says in place of the run's board sentence, for a board of `teams`.
    public func lead(teams: Int, zone: TimeZone) -> String {
        LiveOrderWords.lead(answer, teams: teams, readAt: readAt, zone: zone)
    }
}

/// The orders the app's screens share, by read: each one's answer last read and its read in flight, so
/// the Board, the clubs index and a club or a pair opened together ask the API once for each.
public actor OrderMemo {
    private var last: [String: OrderAtClock] = [:]
    private var flights: [String: Task<OrderAtClock, any Error>] = [:]

    public init() {}

    /// The read `route`'s answer read within `window` of `now`, else its read in flight, else `read`
    /// made now.
    func shared(
        _ route: String, now: Date, window: TimeInterval, read: @escaping @Sendable () async throws -> OrderAtClock
    ) async throws -> OrderAtClock {
        if let kept = last[route], now.timeIntervalSince(kept.landed) < window {
            return kept
        }
        if let flight = flights[route] {
            return try await flight.value
        }
        let task = Task { try await read() }
        flights[route] = task
        defer { flights[route] = nil }
        let answer = try await task.value
        last[route] = answer
        return answer
    }
}

/// The in-season screens' read of our order at their clock (Lane 224): the Rankings' own read with no
/// league (GET /order, byes last, the API's numbers as the Rankings print them), the API's most rows,
/// shared through the memo. The order ranks more players than one read gives, so a screen that draws a
/// club's or a pair's players reads them by their club or name (`search`), as the web's club page and
/// Compare do; the API numbers every row before the search, so a match keeps his place. The route
/// answers with no ETag, so an answer is reused for `window` and never kept past it: a saved order
/// would be a third clock, so a screen with no answer keeps the run's figures with the run's stamp.
public struct OrderReader: Sendable {
    /// How long an answer stands for another screen opened after it.
    public static let window: TimeInterval = 60

    let api: any RankingsAPI
    let clock: any Clock
    let memo: OrderMemo

    public init(api: any RankingsAPI, clock: any Clock, memo: OrderMemo) {
        self.api = api
        self.clock = clock
        self.memo = memo
    }

    /// The read for `search` (letters of a name or a club), every player with none: every position,
    /// the API's most rows, byes last as the Rankings ask.
    public static func query(search: String?) -> OrderQuery {
        OrderQuery(position: nil, search: search, limit: OrderQuery.maxLimit)
    }

    public func read(search: String? = nil) async throws -> OrderAtClock {
        let (api, clock) = (api, clock)
        let query = Self.query(search: search)
        return try await memo.shared(query.route, now: clock.now, window: Self.window) {
            let answer = try await api.order(query)
            return OrderAtClock(answer: answer, landed: clock.now)
        }
    }
}
