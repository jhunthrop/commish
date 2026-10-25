import CommishAPI
import CommishDesign
import Foundation

/// The words the Matchup builds from data, each the same-named function of the web's (matchup.ts,
/// model.ts, connection-words.ts), held to its output by shared/fixtures/parity/matchup.json.
public enum MatchupWords {
    /// model.ts teamName: the platform's name for the team, "Team 7" where it has none.
    static func teamName(_ sync: LeagueSync, _ rosterID: Int) -> String {
        let name = sync.teams.first { $0.rosterId == rosterID }?.name ?? ""
        return name.isEmpty ? LeagueNames.unnamedTeam(rosterID) : name
    }

    /// matchup.ts yoursOnlyWords: "FFPC shows us your lineup only."
    static func yoursOnly(_ platform: String) -> String {
        "\(platform) \(Words.Matchup.yoursOnly)"
    }

    /// matchup.ts allPlayWords.
    static func allPlay(_ platform: String) -> String {
        "\(Words.Matchup.allPlayOn) \(platform): \(Words.Matchup.allPlaySet)"
    }

    /// model.ts matchupGap: a league with no current week has no games; a week we hold no game for is a
    /// read we could not make, never a claim about the team.
    static func gap(_ sync: LeagueSync, now: Date) -> String {
        if sync.week == 0 {
            return "Your league has no games this week."
        }
        return "We could not read this week's game from \(ValueWords.platform(sync.host)). \(readLine(sync, now: now))"
    }

    /// model.ts scoreGap: the drafter's score for the week could not be read.
    static func scoreGap(_ sync: LeagueSync, now: Date) -> String {
        "We could not read your score for this week from \(ValueWords.platform(sync.host)). \(readLine(sync, now: now))"
    }

    /// model.ts readLine: when the platform was last read, and when the last read failed, why.
    static func readLine(_ sync: LeagueSync, now: Date) -> String {
        let age = max(0, now.timeIntervalSince(sync.readAt))
        let platform = ValueWords.platform(sync.host)
        let read = "Read from \(platform) \(agoWords(age))."
        let last = "This is our last read, \(agoWords(age))."
        if sync.hostSignedOut {
            return "\(keepReadingVerb(sync.host)) to keep this league in sync. \(last)"
        }
        if sync.hostFailed {
            return "\(platform) is not answering. \(last)"
        }
        return sync.hostStaleSeconds > 0 ? "\(read) Reading again." : read
    }

    /// model.ts agoWords: "just now", "4 minutes ago", "2 hours ago".
    static func agoWords(_ seconds: TimeInterval) -> String {
        if seconds < 60 {
            return "just now"
        }
        if seconds < 3600 {
            return "\(Formatting.plural(Int(seconds / 60), "minute")) ago"
        }
        return "\(Formatting.plural(Int(seconds / 3600), "hour")) ago"
    }

    /// connection-words.ts keepReadingVerb: "Sign in to FFPC", "Connect Yahoo".
    static func keepReadingVerb(_ host: Components.Schemas.LeagueHost) -> String {
        host.value1 == .ffpc ? "Sign in to FFPC" : "Connect \(ValueWords.platform(host))"
    }
}
