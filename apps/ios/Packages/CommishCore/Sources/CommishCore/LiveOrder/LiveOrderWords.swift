import CommishAPI
import CommishDesign
import Foundation

/// The words a screen says about the clock its figures are on (Lane 224): the order's lead once its
/// rows stand, the run's stamp while they do not, and the every-format table's rank footnote. The
/// tables' function members ported (shared/words/live-strip.json and formats-rank.json name them), held
/// to shared/fixtures/parity/one-value.json.
public enum LiveOrderWords {
    /// live-board.ts liveLeadPart with no league: the order's first sentence, the board's shape and
    /// when it was read. "Our rest-of-season order from week 6's games left, by points over replacement
    /// for 12 teams, read 1:56 pm Central."
    public static func lead(_ answer: OrderAdvice, teams: Int, readAt: Date, zone: TimeZone) -> String {
        "\(orderLead(answer.basis)), by points over replacement for \(teams) teams, read "
            + "\(Formatting.timeOfDay(readAt, zone: zone)) \(Formatting.zoneWord(zone))."
    }

    /// The order's first sentence without its stop.
    static func orderLead(_ basis: String) -> String {
        let first = basis.range(of: ". ").map { String(basis[..<$0.lowerBound]) } ?? basis
        return first.hasSuffix(".") ? String(first.dropLast()) : first
    }

    /// live-board.ts inSeasonStamp and STRIP_WORDS.updated: the run's day and time on a screen in season
    /// that shows the run's rows, "Projected updated Thu Oct 15, 8:50 am Central."; nil before the
    /// season or on a run that says no refresh.
    public static func runStamp(_ format: RunFormat, zone: TimeZone) -> String? {
        guard format.rosFromWeek != nil, let refreshed = format.refreshedAt else {
            return nil
        }
        return "Projected updated \(Formatting.dayTimeStamp(refreshed, zone: zone))."
    }

    /// live-order.ts LIVE_ORDER_WORDS.reach: the Board's count when one read of the order reaches fewer
    /// of its players than it ranks, "The first 400 of the 627 players on our board, in our order."
    public static func reach(shown: Int, total: Int) -> String {
        "The first \(shown) of the \(total) players on our board, in our order."
    }

    /// live-order.ts LIVE_ORDER_WORDS.fromRunLine (Lane 280, B257): the run's players an uncut order
    /// omits, counted once, "2 players from the run, not in the live order."; nil with none.
    public static func fromRun(_ count: Int) -> String? {
        count > 0 ? "\(Formatting.plural(count, "player", "players")) \(Words.LiveOrder.fromRun)." : nil
    }

    /// formats-words.ts FORMATS_RANK.unranked: under the table when a format's rank cell reads "--".
    public static func unranked(_ labels: [String]) -> String {
        let one = labels.count == 1
        return "\(joined(labels)) \(one ? "shows" : "show") no position rank at this read, only "
            + "\(one ? "its" : "their") points."
    }

    /// "Half PPR", "Half PPR and Standard", "Half PPR, Standard and Superflex".
    static func joined(_ labels: [String]) -> String {
        guard let last = labels.last, labels.count > 1 else {
            return labels.joined()
        }
        return "\(labels.dropLast().joined(separator: ", ")) and \(last)"
    }
}
