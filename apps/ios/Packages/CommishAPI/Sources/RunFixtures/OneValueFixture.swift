import CommishAPI
import Foundation

public extension RunFixture {
    /// The one-value stand-in, shared/fixtures/one-value-run (Lane 224, one-value-parity.ts): in season,
    /// made Thursday before week 6, its PPR board the fixture order's players placed one lower than the
    /// order, its clubs, schedule and ADP the contract run's, and pages for the three players the parity
    /// names.
    static let oneValue = RunFixture(folder: "one-value-run")
}

/// The one-value stand-in's weeks and the parity its screens are held to (shared/fixtures/one-value-run,
/// shared/fixtures/parity/one-value.json): each of the three players' week with no league at the
/// order's Sunday clock, his line the Sunday order's.
public enum OneValueFixture {
    /// The clock every figure at the read is for, as the fixture files name it.
    public static let clock = RankingsFixture.sunday
    /// That clock as an instant: Sunday Oct 18 2026, 1:56 pm Central.
    public static let now = APIDecoding.parseDate("2026-10-18T18:56:00Z") ?? .distantPast

    /// His week with no league at the Sunday clock.
    public static func week(_ player: String) throws -> PlayerWeek {
        let file = RunFixture.fixtures.appendingPathComponent("one-value-run/weeks/player-\(player)-\(clock).json")
        return try APIDecoding.envelopeData(PlayerWeek.self, from: Data(contentsOf: file))
    }

    /// The parity file's bytes.
    public static func parity() throws -> Data {
        try Data(contentsOf: RunFixture.fixtures.appendingPathComponent("parity/one-value.json"))
    }
}

/// His week over the one-value stand-in, with no league as the public page reads it; the league's read
/// refused (the stand-in follows none), every read failing with no signal while `offline`.
public struct StubOneValueWeeks: PlayerWeekAPI {
    public let offline: Bool

    public init(offline: Bool = false) {
        self.offline = offline
    }

    public func leagueWeek(league _: String, player _: String) async throws -> PlayerWeek {
        throw APIError.envelope(code: "not_found", message: "The stand-in follows no league.")
    }

    public func publicWeek(player: String) async throws -> PlayerWeek {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        return try OneValueFixture.week(player)
    }
}

/// The order's route over the fixture's every-position answers at a clock, as the API answers them
/// (api inseason/order.go): with the byes last the Rankings' read (order-<clock>.json, its first hundred
/// rows), else the whole read with the byes in their places (order-all-<clock>.json); a search keeps the
/// rows whose name or club holds the letters, any case, accents aside, each keeping his place; then the
/// read's limit, `total` counting the rows before it; every read failing with no signal while `offline`.
public struct StubOrderSearch: RankingsAPI {
    public let clock: String
    public let offline: Bool

    public init(clock: String = OneValueFixture.clock, offline: Bool = false) {
        self.clock = clock
        self.offline = offline
    }

    public func order(_ query: OrderQuery) async throws -> OrderAdvice {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        var answer = try RankingsFixture.order(query.byesLast ? "" : "-all", at: clock)
        if let search = query.search.map(Self.folded) {
            answer.rows = answer.rows.filter { row in
                Self.folded(row.line.player.name).contains(search) || Self.folded(row.line.player.team).contains(search)
            }
            answer.total = answer.rows.count
        }
        answer.rows = Array(answer.rows.prefix(query.limit))
        return answer
    }

    public func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
        try await StubRankings(clock: clock, offline: offline).weekOrder(position: position)
    }

    static func folded(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US"))
    }
}
