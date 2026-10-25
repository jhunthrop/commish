import CommishAPI
import CommishDesign
import Foundation

/// One league in the switch's list: its name, its platform and scoring on the line under it, its phase
/// word where the account's leagues differ, and whether it is the one the app shows.
public struct LeagueSwitchRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let line: String
    public let phase: String?
    public let selected: Bool
}

/// The top bar's league switch (web/src/lib/context/LeagueSwitch.svelte and LeagueMenu.svelte): its
/// face names the league the app shows, and opened it lists every followed league newest first as
/// GET /me lists them, the selected one marked in place. Choosing one opens its home (B149: the way to
/// the League home from a bar with no League tab). With none followed the face says how to follow one
/// and the list says where.
public struct LeagueSwitchModel: Equatable, Sendable {
    public let face: String
    public let title: String
    public let rows: [LeagueSwitchRow]
    /// Said in place of the list with no league followed.
    public let none: String?

    public init(leagues: [FollowedLeague], selected: String?, now: Date, zone: TimeZone) {
        let phases = PhaseWords.phaseWords(leagues, now: now, zone: zone)
        rows = leagues.map { league in
            LeagueSwitchRow(
                id: league.id,
                name: LeagueNames.followedName(league),
                line: LeagueNames.leagueLine(league),
                phase: phases[league.id],
                selected: league.id == selected
            )
        }
        face = rows.first { $0.selected }?.name ?? Words.LeagueSwitch.followFirst
        title = Words.Shell.yourLeagues
        none = leagues.isEmpty ? AppWords.LeagueList.none : nil
    }
}

/// Where the shell sends the member: a screen pushed on the tab in view, or a tab of the bar.
public enum ShellRoute: Hashable, Sendable {
    /// The Players screen with what was typed in the bar's search.
    case players(query: String)
    /// The account's way in.
    case account
    /// A league's home, pushed where the bar has no League tab.
    case leagueHome(id: String)
    /// A player's page, reached by his site link (the sheet's Full page, or a link from elsewhere).
    case player(slug: String)
    /// ADP in a format as the run names it ("ppr-12"), nil for the run's default.
    case adp(format: String?)
    /// Compare with its sides by their pages' slugs.
    case compare(first: String?, second: String?)
    /// Every club.
    case clubs
    /// A club's page by its abbreviation.
    case club(abbr: String)
    /// The strength of schedule.
    case schedule
    /// A game of the league's week (Lane 206): another team's by its first side's roster, pushed from
    /// its score bug; the member's own (roster nil) where the bar has no Matchup tab.
    case game(league: String, roster: Int?)

    public enum Destination: Equatable, Sendable {
        case tab(String)
        case push(ShellRoute)
    }

    /// Where choosing a league in the switch opens its home: the League tab where the bar has one
    /// (the tab shows the selected league), else the home pushed on the tab in view.
    public static func home(of league: String, in tabs: [RailTab]) -> Destination {
        tabs.contains { $0.key == PhoneRail.leagueKey } ? .tab(PhoneRail.leagueKey) : .push(.leagueHome(id: league))
    }

    /// Where a score bug opens its game: the member's on the Matchup tab where the bar has one, else
    /// pushed on the tab in view, as every other team's game is.
    public static func game(of roster: Int?, league: String, in tabs: [RailTab]) -> Destination {
        roster == nil && tabs.contains { $0.key == PhoneRail.matchupKey }
            ? .tab(PhoneRail.matchupKey) : .push(.game(league: league, roster: roster))
    }

    /// The Players screen for what was typed, nil when nothing was.
    public static func search(_ typed: String) -> ShellRoute? {
        let query = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty ? nil : .players(query: query)
    }
}
