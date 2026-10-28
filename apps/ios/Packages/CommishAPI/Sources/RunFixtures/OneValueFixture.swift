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

    /// The moment the status is read, after the nightly and before the Sunday clock.
    static let statusRead = APIDecoding.parseDate("2026-10-18T18:00:00Z") ?? .distantPast

    /// The answer with one player put on injured reserve after the nightly, as the API answers him
    /// (api inseason/order.go): his points and value kept, no place at his position, the list's status
    /// the run's capture does not hold, and his row moved after every available player, the rows
    /// numbered again (Lane 243 fix round 1, M2).
    public static func listing(_ id: String, in answer: OrderAdvice) -> OrderAdvice {
        guard let him = answer.rows.first(where: { $0.line.player.boardId == id }) else {
            return answer
        }
        var others = answer.rows.filter { $0.line.player.boardId != id }
        let after = others.firstIndex { $0.line.facts.designation?.value1.seasonLong == true } ?? others.count
        others.insert(designated(him, status: .injuredReserve), at: after)
        var answer = answer
        answer.rows = others.enumerated().map { index, row in
            var row = row
            row.rank = index + 1
            row.overallRank = index + 1
            return row
        }
        return answer
    }

    /// The answer, still uncut, that no longer returns one player the run holds, its statuses read from
    /// the hourly capture checked at `statusRead`, after the run's (Lane 280, B257): the Board draws him
    /// from the run, counts him once, and dates its status column by the order's capture.
    public static func omitting(_ id: String, in answer: OrderAdvice) -> OrderAdvice {
        var answer = answer
        answer.rows = answer.rows.filter { $0.line.player.boardId != id }
        answer.total = answer.rows.count
        answer.statusRead = .init(value1: .init(
            asOf: statusRead.addingTimeInterval(-3 * 3600), checkedAt: statusRead, source: "fixture"
        ))
        return answer
    }

    /// The answer with one player's row holding no figure (a player with no projection), with the
    /// week's or the list's `status`, or none.
    public static func unvalued(
        _ id: String, status: Components.Schemas.DesignationStatusKnown?, in answer: OrderAdvice
    ) -> OrderAdvice {
        var answer = answer
        answer.rows = answer.rows.map { row in
            guard row.line.player.boardId == id else {
                return row
            }
            var row = designated(row, status: status)
            row.restOfSeasonPoints = nil
            row.pointsOverReplacement = nil
            row.line.positionRank = nil
            return row
        }
        return answer
    }

    /// His row under `status` (none for nil); a season-long status takes his place at his position.
    static func designated(_ row: OrderRow, status: Components.Schemas.DesignationStatusKnown?) -> OrderRow {
        var row = row
        let listed = status.map { [.injuredReserve, .pup, .nfi, .suspended].contains($0) } ?? false
        row.line.facts.designation = status.map {
            .init(value1: .init(status: .init(value1: $0), asOf: statusRead, seasonLong: listed ? true : nil))
        }
        if listed {
            row.line.positionRank = nil
        }
        return row
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
/// `listing` names a player the whole read answers put on injured reserve after the nightly, as the
/// API answers him (OneValueFixture.listing); `omitting` a player the whole read no longer returns, its
/// statuses from a newer capture (OneValueFixture.omitting).
public struct StubOrderSearch: RankingsAPI {
    public let clock: String
    public let offline: Bool
    public let listing: String?
    public let omitting: String?

    public init(
        clock: String = OneValueFixture.clock, offline: Bool = false, listing: String? = nil, omitting: String? = nil
    ) {
        self.clock = clock
        self.offline = offline
        self.listing = listing
        self.omitting = omitting
    }

    public func order(_ query: OrderQuery) async throws -> OrderAdvice {
        guard !offline else {
            throw URLError(.notConnectedToInternet)
        }
        var answer = try RankingsFixture.order(query.byesLast ? "" : "-all", at: clock)
        if let listing, !query.byesLast {
            answer = OneValueFixture.listing(listing, in: answer)
        }
        if let omitting, !query.byesLast {
            answer = OneValueFixture.omitting(omitting, in: answer)
        }
        if let search = query.search.map(Self.folded) {
            answer.rows = answer.rows.filter { row in
                Self.folded(row.line.player.name).contains(search) || Self.folded(row.line.player.team).contains(search)
            }
            answer.total = answer.rows.count
        }
        answer.rows = Array(answer.rows.dropFirst(query.offset).prefix(query.limit))
        return answer
    }

    public func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
        try await StubRankings(clock: clock, offline: offline).weekOrder(position: position)
    }

    static func folded(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US"))
    }
}
