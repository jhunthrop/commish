import CommishAPI
import CommishDesign
import Foundation

/// The Account's words as the web builds them, each held to shared/fixtures/parity/account.json:
/// account/words.ts displayName and whoLine, league/attached-rows.ts attachedRow and attachedCount,
/// hosts/platform-rows.ts readWords, hosts/device-words.ts deviceLine and deviceCount. A day is said on
/// the site's clock, US Eastern (format/date.ts dayLabel), as the web says it.
public enum AccountWords {
    /// format/date.ts ZONE: the clock the site's days are said on.
    static let siteZone = TimeZone(identifier: "America/New_York")!
    private static let day: TimeInterval = 86400

    /// The name the account is greeted by: its name, else its handle, else its email.
    public static func displayName(_ account: AccountAnswer) -> String {
        let full = [account.firstName, account.lastName].compactMap(\.self).filter { !$0.isEmpty }
            .joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return full.isEmpty ? account.handle ?? account.email : full
    }

    /// "m@example.com, with us since Oct 12".
    public static func whoLine(_ account: AccountAnswer) -> String {
        "\(account.email), \(Words.Account.withUsSince) \(dayLabel(account.createdAt))"
    }

    /// "Oct 12": a day on the site's clock.
    static func dayLabel(_ date: Date) -> String {
        Formatting.shortDay(date, zone: siteZone)
    }

    /// The leagues table's head: "3, newest first".
    public static func attachedCount(_ count: Int) -> String {
        "\(count), \(Words.Attached.newestFirst)"
    }

    /// The paired devices' head: "2 devices".
    public static func deviceCount(_ count: Int) -> String {
        Formatting.plural(count, "device")
    }

    /// A read's age: "4 minutes ago" within a day, its date after, "--" never read.
    public static func readWords(_ readAt: Date?, now: Date) -> String {
        guard let readAt else {
            return Words.Box.none
        }
        let age = max(0, now.timeIntervalSince(readAt))
        return age < day ? MatchupWords.agoWords(age) : dayLabel(readAt)
    }

    /// "Paired Oct 12, last used Oct 17", "Paired Oct 12, not used yet".
    public static func deviceLine(_ device: PairedDeviceRow) -> String {
        let used = device.lastUsedAt.map { "\(Words.Devices.lastUsed) \(dayLabel($0))" } ?? Words.Devices.notUsed
        return "\(Words.Devices.paired) \(dayLabel(device.createdAt)), \(used)"
    }

    /// attached-rows.ts attachedRow: the league's name, "McConkey Kong Country, on Sleeper", its record
    /// and place ("--" and nothing before a read), where it is in its season, and its last read.
    public static func leagueRow(
        _ league: AttachedLeague, now: Date, zone: TimeZone, detached: Bool
    ) -> AccountLeagueRow {
        let standing = league.standing?.value1
        let team = [league.teamName, "on \(ValueWords.platform(league.host))"].filter { !$0.isEmpty }
        return AccountLeagueRow(
            id: league.id,
            name: LeagueNames.followedName(league.name, host: league.host),
            team: team.joined(separator: ", "),
            record: standing.map(record) ?? Words.Box.none,
            place: standing.map { "\(Formatting.ordinal($0.place)) of \($0.teams)" } ?? "",
            season: season(league, now: now, zone: zone),
            read: readWords(league.lastReadAt, now: now),
            detached: detached
        )
    }

    /// model.ts recordWords: "5-1", "5-1-1".
    static func record(_ standing: Components.Schemas.LeagueStanding) -> String {
        let base = "\(standing.wins)-\(standing.losses)"
        return standing.ties > 0 ? "\(base)-\(standing.ties)" : base
    }

    /// "In season, playoffs from week 15", "In season", else the phase word ("Draft Wed 12:00 pm"). A
    /// phase this build does not know reads as in season, the app's hub.
    static func season(_ league: AttachedLeague, now: Date, zone: TimeZone) -> String {
        let phase = league.phase.value1
        guard phase == .inSeason || phase == nil else {
            return PhaseWords.phaseWord(phase, draftAt: league.draftAt, now: now, zone: zone)
        }
        return league.playoffStartWeek.map { "\(Words.Attached.inSeason), playoffs from week \($0)" }
            ?? Words.Attached.inSeason
    }

    /// Under the switches: where they are kept, then, while the phone may not show a push, what turning
    /// one on does (not asked yet) or where to allow it (refused).
    public static func pushFoot(_ permission: PushPermission) -> String {
        switch permission {
        case .allowed: Words.Push.kept
        case .notAsked: "\(Words.Push.kept) \(Words.Push.ask)"
        case .refused: "\(Words.Push.kept) \(Words.Push.blocked)"
        }
    }

    /// A time of day from minutes after midnight: "11:00 pm".
    public static func clockTime(_ minutes: Int) -> String {
        let utc = TimeZone(identifier: "UTC")!
        return Formatting.timeOfDay(Date(timeIntervalSince1970: TimeInterval(minutes * 60)), zone: utc)
    }
}
