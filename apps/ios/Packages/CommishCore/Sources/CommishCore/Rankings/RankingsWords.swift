import CommishAPI
import CommishDesign
import Foundation

/// The Rankings' sentences the web builds with a function (order/words.ts, order/week.ts,
/// week-head.ts, run/week-names.ts, format/pool-words.ts), ported over the generated words and held to
/// the web's output by shared/fixtures/parity/rankings.json.
public enum RankingsWords {
    /// box.ts EXPECTED_SCORE: the expected score's label (Lane 139, C07).
    static let expectedScore = "Expected score"

    /// week-names.ts: "Rankings" in season, "Players" before and after it.
    public static func name(inSeason: Bool) -> String {
        inSeason ? Words.PageName.rankings : Words.PageName.players
    }

    /// words.ts playersLead: before the season the page's purpose; in season on our order's chips,
    /// whose order it is with the week's game beside each player; on the K and D/ST chips none.
    public static func lead(inSeason: Bool, onWeekChip: Bool, week: Int?) -> String? {
        guard inSeason else {
            return Words.PagePurpose.players
        }
        guard !onWeekChip, let week else {
            return nil
        }
        return "Our rest-of-season order, with week \(week)'s game beside each player"
    }

    /// pool-words.ts hitsWords: "121 on NFL rosters today" with no filter, "12 matches" with one.
    public static func hits(total: Int, filtered: Bool, onClub: Int?) -> String {
        filtered
            ? Formatting.plural(total, "match", "matches")
            : "\(Formatting.grouped(onClub ?? total)) \(Words.Pool.rosters)"
    }

    /// figure-words.ts weekHead: "Wk 6".
    public static func weekHead(_ week: Int) -> String {
        "\(Words.Figure.week) \(week)"
    }

    /// words.ts byeHead: "Bye in week 6".
    static func byeHead(_ week: Int) -> String {
        "\(Words.OrderWeek.byeIn) \(week)"
    }

    /// The kickers' or defenses' plural: "kickers".
    static func many(_ position: WeekOrderPosition) -> String {
        position == .k ? Words.WeekMany.K : Words.WeekMany.DEF
    }

    /// week.ts WEEK_NOUNS' one: "kicker", "defense".
    static func one(_ position: WeekOrderPosition) -> String {
        position == .k ? "kicker" : "defense"
    }

    /// week-head.ts weekHeading: "Week 6 kickers".
    public static func weekHeading(_ position: WeekOrderPosition, week: Int?) -> String {
        week.map { "Week \($0) \(many(position))" } ?? "This week's \(many(position))"
    }

    /// week.ts weekNone: "No defense matches."
    static func weekNone(_ position: WeekOrderPosition) -> String {
        "No \(one(position)) matches."
    }

    /// week.ts weekStatus: before the week's projection is in, the line said in the table's place.
    static func weekStatus(_ advice: WeekOrderAdvice, position: WeekOrderPosition) -> (lead: String, rest: String)? {
        guard !landed(advice) else {
            return nil
        }
        let many = many(position)
        return (
            "Week \(advice.week)'s projection for \(many) is not in yet.",
            "Until it is, there is no \(Words.Box.proj), and the \(many) below are in order of \(Words.Box.avg)."
        )
    }

    /// week.ts landed: a row carries a Proj.
    static func landed(_ advice: WeekOrderAdvice) -> Bool {
        advice.rows.contains { $0.line.weekProjection != nil }
    }
}
