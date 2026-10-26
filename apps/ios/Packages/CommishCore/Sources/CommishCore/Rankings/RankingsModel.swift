import CommishAPI
import CommishDesign
import Foundation

/// Our order as the Rankings screen draws it (the web's Players page in season over
/// OrderScreen.svelte and OrderTable.svelte at 390): the sentence under the page's name, the search's
/// hits, the heads, the rows in their sections with each place the API's own, whether Show more is
/// offered, the basis said once. Pure over the API's answer, the clock and the zone.
public struct RankingsModel: Equatable, Sendable {
    public let lead: String?
    public let hits: String
    public let heads: RankingsHeads
    public let sections: [RankingsSection<RankingsRow>]
    /// The API holds more rows than the read asked for.
    public let more: Bool
    public let basis: String
    /// "No player in our order matches." where a filter leaves none.
    public let none: String?
    public let week: Int

    public init(advice: OrderAdvice, chip: RankingsChip?, query: String, inSeason: Bool, zone: TimeZone, now: Date) {
        let rankBy = RankBy(advice.rankBy)
        let viewing = OrderViewing(rankBy: rankBy, week: advice.week, pillRank: chip == nil)
        let rows = advice.rows.map { RankingsRows.row($0, view: viewing, zone: zone, now: now) }
        let searched = query.trimmingCharacters(in: .whitespaces).count >= OrderQuery.minSearch
        lead = RankingsWords.lead(inSeason: inSeason, onWeekChip: false, week: advice.week)
        hits = RankingsWords.hits(total: advice.total, filtered: searched || chip != nil, onClub: advice.onClub)
        heads = RankingsHeads(
            rank: Words.Order.rank,
            week: RankingsWords.weekHead(advice.week),
            total: Words.Order.total
        )
        sections = RankingsRows.sections(rows, week: advice.week)
        more = advice.total > advice.rows.count
        basis = RankingsBasis.order(advice, zone: zone, now: now)
        none = advice.total == 0 ? Words.Order.none : nil
        week = advice.week
    }

    /// Every row in its order, for the player sheet's parent refresh.
    public var rows: [RankingsRow] {
        sections.flatMap(\.rows)
    }
}

/// The order's heads: the # head, the week's ("Wk 6", pinned by the parity; drawn as the strip's Wk
/// cell's head, not in the head row) and the big figure's (Projected).
public struct RankingsHeads: Equatable, Sendable {
    public let rank: String
    public let week: String
    public let total: String
}

/// The kickers' or defenses' week as the Rankings' K and D/ST chips draw it (WeekScreen.svelte and
/// WeekTable.svelte at 390, the basis line over the rows as the Players page says it): the status line
/// before the week's projection is in, the rows in their sections in the published projection's order,
/// the line when a search matches none, the basis with the rules our stats lack.
public struct WeekRankingsModel: Equatable, Sendable {
    public let heading: String
    public let status: String?
    /// The Proj column: drawn once a row has one.
    public let proj: Bool
    public let sections: [RankingsSection<WeekRankingsRow>]
    public let none: String?
    public let basis: String
    public let rules: String?
    public let week: Int

    public init(
        advice: WeekOrderAdvice, position: WeekOrderPosition, query: String, boardScoring: String, zone: TimeZone,
        now: Date
    ) {
        let rows = advice.rows.map { (row: $0, shown: RankingsRows.weekRow($0, zone: zone, now: now)) }
        let shown = rows.filter { RankingsRows.matches($0.row, shown: $0.shown, query: query) }
        heading = RankingsWords.weekHeading(position, week: advice.week)
        status = RankingsWords.weekStatus(advice, position: position).map { "\($0.lead) \($0.rest)" }
        proj = RankingsWords.landed(advice)
        sections = RankingsRows.weekSections(shown, week: advice.week, zone: zone, now: now)
        none = shown.isEmpty && !rows.isEmpty ? RankingsWords.weekNone(position) : nil
        basis = RankingsBasis.week(advice, position: position, boardScoring: boardScoring, zone: zone, now: now)
        rules = RankingsBasis.rules(advice)
        week = advice.week
    }

    public var rows: [WeekRankingsRow] {
        sections.flatMap(\.rows)
    }
}
