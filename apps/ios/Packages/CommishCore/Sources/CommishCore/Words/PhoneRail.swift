import CommishAPI

/// One tab of the phone's bottom bar: the web's rail item key and its label.
public struct RailTab: Equatable, Sendable, Identifiable {
    public let key: String
    public let label: String

    public var id: String {
        key
    }
}

/// The phone's five by the followed league's phase, as the web's bar draws them (a port of
/// web/src/lib/ui/rail-order.ts railFor and RAIL_WITHOUT_LEAGUE, nav.ts labels, the week item named
/// Rankings once the season names a week), held to the web by shared/fixtures/parity/phone-rail.json.
public enum PhoneRail {
    typealias Phase = Components.Schemas.LeaguePhaseKnown

    static let league = RailTab(key: "league", label: AppWords.Tab.league)
    static let lineup = RailTab(key: "lineup", label: AppWords.Tab.lineup)
    static let matchup = RailTab(key: "matchup", label: AppWords.Tab.matchup)
    static let waivers = RailTab(key: "waivers", label: AppWords.Tab.waivers)
    static let trades = RailTab(key: "trades", label: AppWords.Tab.trades)
    static let board = RailTab(key: "board", label: AppWords.Tab.board)
    static let players = RailTab(key: "players", label: AppWords.Tab.players)
    static let mock = RailTab(key: "mock", label: AppWords.Tab.mock)
    static let sheet = RailTab(key: "sheet", label: AppWords.Tab.sheet)
    static let advisor = RailTab(key: "advisor", label: AppWords.Tab.advisor)
    static let week = RailTab(key: "week", label: AppWords.Tab.rankings)

    /// The five for a followed league; a phase this build does not know reads as in season, the app's
    /// hub.
    public static func tabs(phase: Components.Schemas.LeaguePhaseKnown?, waiversOpen: Bool) -> [RailTab] {
        switch phase {
        case .preDraft, .offseason:
            [board, players, mock, sheet, advisor]
        case .draftDay:
            [
                RailTab(key: "advisor_first", label: AppWords.Tab.advisor), board, players, sheet,
                RailTab(key: "mock_late", label: AppWords.Tab.mock),
            ]
        case .playoffs where !waiversOpen:
            [league, lineup, matchup, trades, week]
        case .inSeason, .playoffs, nil:
            [league, lineup, matchup, waivers, trades]
        }
    }

    /// The five with no league followed (RAIL_WITHOUT_LEAGUE).
    public static let withoutLeague: [RailTab] = [
        league,
        RailTab(key: "rest_first", label: AppWords.Tab.restOfSeason),
        week,
        mock,
        RailTab(key: "record", label: AppWords.Tab.record),
    ]
}
