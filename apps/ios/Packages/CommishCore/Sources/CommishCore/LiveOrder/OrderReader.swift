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

    /// The lead a screen's basis says in place of the run's board sentence, for a board of `teams`.
    public func lead(teams: Int, zone: TimeZone) -> String {
        LiveOrderWords.lead(answer, teams: teams, readAt: readAt, zone: zone)
    }
}

/// The one order the app's screens share: the answer last read, and the read in flight, so the Board,
/// a club, the clubs index and Compare opened together ask the API once.
public actor OrderMemo {
    private var last: OrderAtClock?
    private var flight: Task<OrderAtClock, any Error>?

    public init() {}

    /// The answer read within `window` of `now`, else the read in flight, else `read` made now.
    func shared(
        now: Date, window: TimeInterval, read: @escaping @Sendable () async throws -> OrderAtClock
    ) async throws -> OrderAtClock {
        if let last, now.timeIntervalSince(last.landed) < window {
            return last
        }
        if let flight {
            return try await flight.value
        }
        let task = Task { try await read() }
        flight = task
        defer { flight = nil }
        let answer = try await task.value
        last = answer
        return answer
    }
}

/// The in-season screens' read of our order at their clock (Lane 224): the Rankings' own read with no
/// league (GET /order, byes last, the API's numbers as the Rankings print them), its every row the API
/// gives at once, shared through the memo. The route answers with no ETag, so an answer is reused for
/// `window` and never kept past it: a saved order would be a third clock, so a screen with no answer
/// keeps the run's figures with the run's stamp.
public struct OrderReader: Sendable {
    /// The read: every position, no search, the API's most rows, byes last as the Rankings ask.
    public static let query = OrderQuery(position: nil, search: nil, limit: OrderQuery.maxLimit)
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

    public func read() async throws -> OrderAtClock {
        let (api, clock) = (api, clock)
        return try await memo.shared(now: clock.now, window: Self.window) {
            let answer = try await api.order(Self.query)
            return OrderAtClock(answer: answer, landed: clock.now)
        }
    }
}
