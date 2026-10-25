import CommishAPI
import CommishDesign
import Foundation

/// The League home's word on draft day (SeasonPanel.svelte, phase draft_day): when the draft is on the
/// member's clock, that the site turns to the season after it with the zone once, and the one verb,
/// the Advisor, which opens the live-draft companion. Held to the web by the companion's parity
/// (shared/fixtures/parity/companion.json draftDay). Every instant on the member's own clock.
public struct DraftDayEntry: Equatable, Sendable {
    public let lead: String
    public let line: String
    public let verb: String

    /// The entry for a league on draft day; nil in every other phase, where the web draws another
    /// panel or none.
    public init?(phase: Components.Schemas.LeaguePhaseKnown?, draftAt: Date?, now: Date, zone: TimeZone) {
        guard phase == .draftDay else {
            return nil
        }
        lead = Self.draftLine(draftAt, now: now, zone: zone)
        line = [Words.DraftDay.turnsAfterDraft, Self.zoneLine(zone)].compactMap(\.self).joined(separator: " ")
        verb = Words.DraftDay.advisorVerb
    }

    /// phase-words.ts draftLine: "Your draft is today at 7:00 pm.", "... tomorrow at ...", "Your draft
    /// is Wednesday, September 9 at 7:00 pm.", "Your draft is on now.", or that it has no time.
    public static func draftLine(_ draftAt: Date?, now: Date, zone: TimeZone) -> String {
        guard let draftAt else {
            return "Your league has not set its draft time."
        }
        if draftAt <= now {
            return "Your draft is on now."
        }
        let time = Formatting.timeOfDay(draftAt, zone: zone)
        if Formatting.sameDay(draftAt, now, zone: zone) {
            return "Your draft is today at \(time)."
        }
        if Formatting.sameDay(draftAt, now.addingTimeInterval(86400), zone: zone) {
            return "Your draft is tomorrow at \(time)."
        }
        let day = "\(Formatting.weekdayName(draftAt, zone: zone)), \(Formatting.monthDay(draftAt, zone: zone))"
        return "Your draft is \(day) at \(time)."
    }

    /// clock.ts zoneLine: the member's zone said once, "Times are in Central Time.", nil on the Eastern
    /// clock.
    public static func zoneLine(_ zone: TimeZone) -> String? {
        let name = zone.localizedName(for: .generic, locale: Locale(identifier: "en_US")) ?? zone.identifier
        return name == "Eastern Time" ? nil : "Times are in \(name)."
    }
}
