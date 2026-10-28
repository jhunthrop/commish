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

    /// Every row it returns by board id, placed or not.
    public var rows: [String: OrderRow] {
        LiveOrder.rows(answer)
    }

    /// When it was read (live-board.ts answerReadAt): the league's read when it says one, else the
    /// screen's clock as it landed.
    public var readAt: Date {
        answer.readAt ?? landed
    }

    /// The capture its rows' statuses come from (live-order.ts liveCapture), nil when the answer names
    /// none or is older than the field (Lane 280, B257).
    public var capture: CaptureStamp? {
        answer.statusRead.map { CaptureStamp(asOf: $0.value1.asOf, checkedAt: $0.value1.checkedAt) }
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
/// the Rankings, the Board, the clubs index and a club or a pair opened together ask the API once for
/// each. A read is keyed by its route in any case ("CHI" and "chi" are one read), and an answer past its
/// window is dropped when the next answer is kept.
public actor OrderMemo {
    private var last: [String: OrderAtClock] = [:]
    private var flights: [String: Task<OrderAtClock, any Error>] = [:]

    public init() {}

    /// The answers kept, for the tests of the window.
    var kept: Int {
        last.count
    }

    /// The read `route`'s answer read within `window` of `now`, else its read in flight, else `read`
    /// made now.
    func shared(
        _ route: String, now: Date, window: TimeInterval, read: @escaping @Sendable () async throws -> OrderAtClock
    ) async throws -> OrderAtClock {
        let key = route.lowercased()
        if let kept = last[key], now.timeIntervalSince(kept.landed) < window {
            return kept
        }
        if let flight = flights[key] {
            return try await flight.value
        }
        let task = Task { try await read() }
        flights[key] = task
        defer { flights[key] = nil }
        let answer = try await task.value
        last = last.filter { now.timeIntervalSince($0.value.landed) < window }
        last[key] = answer
        return answer
    }
}

/// Our order read at a screen's clock (Lane 224), shared through the memo: the in-season pages' read with
/// no league (GET /order, the API's most rows, the byes in their places as the web's
/// live-order-read.ts reads it, so a bye club's players are within the rows and the number is the
/// web's), and the Rankings' own reads (`read(_:)`, the byes last as their page asks). The two never
/// share one answer: the Rankings number the byes last (`byes=last`, the week's byes section, Lane 163
/// D06) and read a hundred rows at a time, while the screens read the byes in their places and the
/// API's most rows, so neither query is a superset of the other and each keeps its own clock within the
/// window (Lane 243, B251, the Lane 226 review's L1). The order ranks
/// more players than one read gives, so a screen that draws a club's or a pair's players reads them by
/// their club or name (`search`), as the web's club page and Compare do; the API numbers every row
/// before the search, so a match keeps his place. The route answers with no ETag, so an answer is
/// reused for `window` and never kept past it: a saved order would be a third clock, so a screen with
/// no answer keeps the run's figures with the run's stamp.
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

    /// The in-season pages' read for `search` (letters of a name or a club), every player with none:
    /// every position, the API's most rows, the byes in their places.
    public static func query(search: String?) -> OrderQuery {
        OrderQuery(position: nil, search: search, limit: OrderQuery.maxLimit, byesLast: false)
    }

    public func read(search: String? = nil) async throws -> OrderAtClock {
        try await read(Self.query(search: search))
    }

    /// Any read of the order through the share: the Rankings' chips, searches and Show more.
    public func read(_ query: OrderQuery) async throws -> OrderAtClock {
        let (api, clock) = (api, clock)
        return try await memo.shared(query.route, now: clock.now, window: Self.window) {
            let answer = try await api.order(query)
            return OrderAtClock(answer: answer, landed: clock.now)
        }
    }
}
