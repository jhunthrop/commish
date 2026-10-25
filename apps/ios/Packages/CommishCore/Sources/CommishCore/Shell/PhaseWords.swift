import CommishAPI
import Foundation

/// A league's place in its season in a word, beside its name in the league switch: a port of
/// web/src/lib/league/phase-words.ts phaseWord and web/src/lib/context/menu-words.ts phaseWords, held
/// to the web by shared/fixtures/parity/shell.json. Every instant on the member's own clock.
public enum PhaseWords {
    typealias Phase = Components.Schemas.LeaguePhaseKnown

    private static let day: TimeInterval = 86400
    /// A draft this far off is named by its weekday, further off by its date.
    private static let weekAhead: TimeInterval = 6 * day

    /// "Draft Mon 7:00 pm", "Draft today 7:00 pm", "Drafting", "Drafted", "Playoffs", "Season over".
    /// A phase this build does not know reads as in season, the app's hub.
    public static func phaseWord(
        _ phase: Components.Schemas.LeaguePhaseKnown?, draftAt: Date?, now: Date, zone: TimeZone
    ) -> String {
        switch phase {
        case .inSeason, nil: "Drafted"
        case .playoffs: "Playoffs"
        case .offseason: "Season over"
        case .preDraft, .draftDay: draftWord(phase, draftAt: draftAt, now: now, zone: zone)
        }
    }

    /// Each league's phase word by its id, only when the leagues are not all in one phase; empty when
    /// they agree.
    public static func phaseWords(_ leagues: [FollowedLeague], now: Date, zone: TimeZone) -> [String: String] {
        let phases = Set(leagues.map { $0.phase ?? .inSeason })
        guard phases.count >= 2 else {
            return [:]
        }
        return Dictionary(
            leagues.map { ($0.id, phaseWord($0.phase, draftAt: $0.draftAt, now: now, zone: zone)) },
            uniquingKeysWith: { first, _ in first }
        )
    }

    private static func draftWord(_ phase: Phase?, draftAt: Date?, now: Date, zone: TimeZone) -> String {
        guard let draftAt else {
            return phase == .draftDay ? "Drafting" : "Not drafted"
        }
        let ahead = draftAt.timeIntervalSince(now)
        if ahead <= 0 {
            return "Drafting"
        }
        if let near = nearDay(draftAt, now: now, zone: zone) {
            return "Draft \(near) \(Formatting.timeOfDay(draftAt, zone: zone))"
        }
        return ahead <= weekAhead
            ? "Draft \(Formatting.weekdayTime(draftAt, zone: zone))"
            : "Draft \(Formatting.shortDay(draftAt, zone: zone))"
    }

    /// "today" or "tomorrow" for an instant on those days of the member's clock, else nil.
    private static func nearDay(_ date: Date, now: Date, zone: TimeZone) -> String? {
        if Formatting.sameDay(date, now, zone: zone) {
            return "today"
        }
        return Formatting.sameDay(date, now.addingTimeInterval(day), zone: zone) ? "tomorrow" : nil
    }
}

/// A followed league's names in words (web/src/lib/league/names.ts).
public enum LeagueNames {
    /// The league's own name, or its platform's when its read has none yet ("Your Yahoo league").
    public static func followedName(_ league: FollowedLeague) -> String {
        league.name.isEmpty ? "Your \(ValueWords.platform(league.host)) league" : league.name
    }
}
