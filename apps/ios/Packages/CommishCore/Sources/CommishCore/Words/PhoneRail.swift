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
    /// The Board tab's key, before the draft, on draft day and after the season.
    public static let boardKey = "board"
    /// The season's Rest of season item with no league followed (nav.ts rest_first): the board,
    /// ranking the rest of the season.
    public static let restKey = "rest_first"

    /// Whether a tab shows the board in season (the rest of it) or not: the web's rail reaches the
    /// board by its Board item and, in season with no league, by Rest of season; nil for any other tab.
    public static func boardInSeason(_ key: String) -> Bool? {
        switch key {
        case boardKey: false
        case restKey: true
        default: nil
        }
    }

    /// Whether a tab is the Advisor (nav.ts ADVISOR, drawn first on draft day as advisor_first), the
    /// web's way to the live-draft companion (COMPANION_START).
    public static func isAdvisor(_ key: String) -> Bool {
        key == advisor.key || key == advisorFirstKey
    }

    static let advisorFirstKey = "advisor_first"

    /// The Mock draft tab (before the draft, after the season, and with no league in season) and draft
    /// day's late one: the mock room's setup.
    public static func isMock(_ key: String) -> Bool {
        key == mock.key || key == mockLateKey
    }

    static let mockLateKey = "mock_late"
    static let lineup = RailTab(key: lineupKey, label: AppWords.Tab.lineup)
    /// The Matchup tab's key: the selected league's week as a box score.
    public static let matchupKey = "matchup"
    static let matchup = RailTab(key: matchupKey, label: AppWords.Tab.matchup)
    /// The Waivers tab's key: the selected league's players free to add.
    public static let waiversKey = "waivers"
    static let waivers = RailTab(key: waiversKey, label: AppWords.Tab.waivers)
    /// The Trades tab's key: the selected league's trade finder.
    public static let tradesKey = "trades"
    static let trades = RailTab(key: tradesKey, label: AppWords.Tab.trades)
    static let board = RailTab(key: boardKey, label: AppWords.Tab.board)
    static let players = RailTab(key: "players", label: AppWords.Tab.players)
    static let mock = RailTab(key: "mock", label: AppWords.Tab.mock)
    /// The Cheat sheet tab's key (before the draft and on draft day): the member's sheet.
    public static let sheetKey = "sheet"
    static let sheet = RailTab(key: sheetKey, label: AppWords.Tab.sheet)
    static let advisor = RailTab(key: "advisor", label: AppWords.Tab.advisor)
    /// The Rankings tab's key: our order with the week's game beside each player (the web's /players).
    public static let rankingsKey = "week"
    static let week = RailTab(key: rankingsKey, label: AppWords.Tab.rankings)
    /// Our record's key.
    public static let recordKey = "record"

    /// The bar the shell shows: the shown league's five by its phase; with no league followed, or a
    /// league whose phase this build does not know (B154), the five for the site's season, as Android's
    /// phoneBar and the web's railShown read it.
    public static func bar(league: FollowedLeague?, season: SitePhase?) -> [RailTab] {
        guard let league, let phase = league.phase else {
            return withoutLeague(season: season)
        }
        return tabs(phase: phase, waiversOpen: league.waiversOpen)
    }

    /// The five for a league in a phase this build knows.
    public static func tabs(phase: Components.Schemas.LeaguePhaseKnown, waiversOpen: Bool) -> [RailTab] {
        switch phase {
        case .preDraft, .offseason:
            [board, players, mock, sheet, advisor]
        case .draftDay:
            [
                RailTab(key: advisorFirstKey, label: AppWords.Tab.advisor), board, players, sheet,
                RailTab(key: mockLateKey, label: AppWords.Tab.mock),
            ]
        case .playoffs where !waiversOpen:
            [league, lineup, matchup, trades, week]
        case .inSeason, .playoffs:
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
        RailTab(key: restKey, label: AppWords.Tab.restOfSeason),
        week,
        mock,
        RailTab(key: recordKey, label: AppWords.Tab.record),
    ]
}
