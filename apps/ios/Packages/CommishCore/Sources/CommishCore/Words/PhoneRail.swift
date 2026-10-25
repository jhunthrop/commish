import CommishAPI
import CommishDesign

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

    /// The League tab's key: the selected league's home.
    public static let leagueKey = "league"
    static let league = RailTab(key: leagueKey, label: AppWords.Tab.league)
    /// The Lineup tab's key: the selected league's Start screen.
    public static let lineupKey = "lineup"
    static let lineup = RailTab(key: lineupKey, label: AppWords.Tab.lineup)
    /// The Matchup tab's key: the selected league's week as a box score.
    public static let matchupKey = "matchup"
    static let matchup = RailTab(key: matchupKey, label: AppWords.Tab.matchup)
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

    /// The account's way in: the top bar's last cell (the rail's foot at a desk, nav.ts RAIL_FOOT).
    public static let account = RailTab(key: "account", label: Words.Shell.account)

    /// The five with no league followed, by the site's season (GET /season), as the web's railShown
    /// over railPhase(null, season): the draft's bar before the season (preseason reads as before the
    /// draft) and after it, the season's bar without a league in it. No season read (an API from
    /// before the route, or no signal) and a season this build does not know read as in season.
    public static func withoutLeague(season: SitePhase?) -> [RailTab] {
        switch season {
        case .preseason: tabs(phase: .preDraft, waiversOpen: false)
        case .offseason: tabs(phase: .offseason, waiversOpen: false)
        case .inSeason, .playoffs, nil: withoutLeague
        }
    }

    /// The season's five with no league followed (RAIL_WITHOUT_LEAGUE).
    public static let withoutLeague: [RailTab] = [
        league,
        RailTab(key: "rest_first", label: AppWords.Tab.restOfSeason),
        week,
        mock,
        RailTab(key: "record", label: AppWords.Tab.record),
    ]
}
