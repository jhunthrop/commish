import CommishDesign
import Foundation

/// The app's own words: what the web has no table for because the web has no such screen part (the
/// tab bar's screens not live yet, the sign-in sheet, a read that failed with no saved answer). Every
/// view reads its words from here or the generated web words (Words), never a literal.
public enum AppWords {
    /// The phone bar's tabs, the web's rail labels (web/src/lib/ui/nav.ts, run/week-names.ts); which
    /// five show is PhoneRail's, by the league's phase.
    public enum Tab {
        public static let league = "League"
        public static let lineup = "Lineup"
        public static let matchup = "Matchup"
        public static let waivers = "Waivers"
        public static let trades = "Trades"
        public static let board = "Board"
        public static let players = "Players"
        public static let mock = "Mock draft"
        public static let sheet = "Cheat sheet"
        public static let advisor = "Advisor"
        public static let rankings = "Rankings"
        public static let restOfSeason = "Rest of season"
        public static let record = "Our record"
    }

    /// A platform the API names with nothing readable (ValueWords.platform).
    public static let unknownPlatform = "your platform"

    /// web/src/lib/league/LeaguePage.svelte stampOf: a read whose latest try failed.
    public static let lastRead = Words.Attached.lastRead

    /// "Last read Sun 3:05 pm": the stamp a screen shows over a saved read.
    public static func lastRead(_ stamp: Date, zone: TimeZone) -> String {
        "\(lastRead) \(Formatting.weekdayTime(stamp, zone: zone))"
    }

    /// LineupSummary.svelte's line beside the head: "As set on FFPC".
    public static func asSetOn(_ platform: String) -> String {
        "As set on \(platform)"
    }

    public enum SignIn {
        public static let title = "Commish"
        public static let lead = "Your leagues on ESPN, Sleeper, Yahoo, MyFantasyLeague and FFPC, in one place."
        public static let verb = "Sign in"
        public static let working = "Signing in"
    }

    /// Said in place of a screen when nothing can be shown: the API's own sentence where it sent one,
    /// else one of these. Never an error code.
    public enum Failure {
        public static let offline =
            "No connection, and nothing saved on this phone yet. Try again once you have signal."
        public static let signedOut = "Sign in again to see your league."
        public static let unknown = "We could not read your league just now. Try again in a minute."
        public static let signInFailed = "Signing in did not finish. Try again."
        public static let tryAgain = "Try again"
    }

    /// The Start screen's own words, where the web has no such state.
    public enum Start {
        /// Under the verb, disabled, while the lineup shown is a saved read: a lineup set from it may
        /// not be the platform's now, so the phone reads it again first.
        public static func stale(_ stamp: String) -> String {
            "\(stamp). Pull down to read your lineup again before you set it."
        }
    }

    /// The Waivers screen's own words, where the web has no such state.
    public enum Waivers {
        /// Under the verb, disabled, while the waivers shown are a saved read: a player on it may have
        /// been claimed since, so the phone reads them again first.
        public static func stale(_ stamp: String) -> String {
            "\(stamp). Pull down to read waivers again before you claim."
        }
    }

    /// The mock room's own words, where the web has no such state: the phone's room is full screen,
    /// so leaving it asks first (the web's page is left by its own back).
    public enum Mock {
        public static let close = "Leave the room"
        public static let leaveTitle = "Leave this mock?"
        public static let leaveMessage =
            "It stays where you left it, under Your mock drafts on your account at trycommish.app."
        public static let leave = "Leave"
        public static let stay = "Keep drafting"
    }

    /// The lobby room full screen: its close keeps the seat (the queue drafts it until the member comes
    /// back, as a closed tab on the web), so it does not ask; Leave asks the web's question.
    public enum Lobby {
        public static let close = "Close the room"
        public static let title = "Mock draft"
    }

    /// The league the app opens until the Leagues screen lets the member pick one.
    public enum LeagueList {
        public static let none = "Follow a league on trycommish.app and it shows here."
    }
}
