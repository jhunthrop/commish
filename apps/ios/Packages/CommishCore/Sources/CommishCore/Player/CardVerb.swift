import CommishAPI
import CommishDesign
import Foundation

/// The one verb the league's screens give him, as his page pins it (web/src/lib/player/week-words.ts
/// CardVerb): its words, where it goes, and the line under it.
public struct CardVerb: Equatable, Sendable {
    /// Where the verb goes: one of the app's league screens, or the platform's own page.
    public enum Target: Equatable, Sendable {
        case lineup
        case trades
        case waivers
        /// The platform's waiver page: his name is put on the clipboard first, so its search takes it.
        case platform(URL)
    }

    public let label: String
    public let target: Target
    public let note: String?
}

/// week-words.ts verbOf, heldVerb and verbFits, held to the parity's verbs.
enum CardVerbs {
    typealias Kind = Components.Schemas.PlayerVerb.KindPayload.Value1Payload

    /// verbOf: the verb in the platform's name; nil for a kind this build does not know.
    static func of(_ verb: PlayerVerb, host: Components.Schemas.LeagueHost) -> CardVerb? {
        let platform = ValueWords.platform(host)
        switch verb.kind.value1 {
        case .start: return CardVerb(label: Words.Card.startHim, target: .lineup, note: nil)
        case .lineup: return CardVerb(label: Words.Card.openLineup, target: .lineup, note: nil)
        case .trade: return CardVerb(label: "Trade for him", target: .trades, note: nil)
        case .claim: return CardVerb(label: "Add on \(platform)", target: .waivers, note: verb.note)
        case .waivers:
            guard let address = verb.hostUrl, let url = URL(string: address), url.scheme == "https" else {
                return CardVerb(label: Words.Card.findOnWaivers, target: .waivers, note: verb.note)
            }
            let note = verb.note ?? "Claims are not sent to \(platform) from here, so this copies his name and opens "
                + "\(platform)'s waiver page."
            return CardVerb(label: "Open \(platform) waivers", target: .platform(url), note: note)
        case nil: return nil
        }
    }

    /// heldVerb: Start him becomes the way to the lineup once his game has kicked off.
    static func held(_ verb: PlayerVerb, line: PlayerLine, now: Date) -> PlayerVerb {
        guard verb.kind.value1 == .start, LineRead.started(line, now: now) else {
            return verb
        }
        return PlayerVerb(kind: .init(value1: .lineup), holder: verb.holder, hostUrl: verb.hostUrl, note: verb.note)
    }

    /// verbFits: his lineup's verbs only while the week's lineup can still be set, by its last kickoff
    /// on the run's schedule (a week the schedule does not hold keeps them); the others always.
    static func fits(_ verb: PlayerVerb, lastKickoff: Date?, now: Date) -> Bool {
        let lineup = verb.kind.value1 == .start || verb.kind.value1 == .lineup
        return !lineup || (lastKickoff.map { $0 > now } ?? true)
    }

    /// The page's verb from his week in the league at the page's clock: none with no league, a verb that
    /// no longer fits the week, or a kind this build does not know.
    static func pinned(
        _ week: PlayerWeek, host: Components.Schemas.LeagueHost, lastKickoff: Date?, now: Date
    ) -> CardVerb? {
        guard let verb = week.verb?.value1, fits(verb, lastKickoff: lastKickoff, now: now) else {
            return nil
        }
        return of(held(verb, line: week.line, now: now), host: host)
    }
}
