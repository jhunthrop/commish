import CommishAPI
import CommishDesign
import Foundation

/// The words the Waivers screen builds from data, each the same-named function of the web's (waivers.ts,
/// move.ts, words.ts, next-week.ts), held to its output by shared/fixtures/parity/waivers.json.
public enum WaiverWords {
    static let numberWords = ["No", "One", "Two", "Three"]
    static let minus = "\u{2212}"

    // MARK: figures

    /// Whether a gain is one the page prints above zero.
    static func positive(_ gain: Double) -> Bool {
        (Double(Formatting.fixed(gain, 1)) ?? 0) > 0
    }

    /// waivers.ts gainWord: "+6.7", "−0.5", "0.0".
    public static func gain(_ gain: Double) -> String {
        let shown = Double(Formatting.fixed(gain, 1)) ?? 0
        if shown == 0 {
            return Formatting.fixed(0, 1)
        }
        let magnitude = Formatting.fixed(abs(shown), 1)
        return shown < 0 && Double(magnitude) != 0 ? "\(minus)\(magnitude)" : "+\(magnitude)"
    }

    /// waivers.ts beatsWord: "+0.3 Gain" on a row that gains, the bare "0.0" on one that does not, "--"
    /// on a row the rule cannot judge.
    static func beats(gain: Double?, gains: Bool) -> String {
        guard let gain else {
            return Words.Box.none
        }
        return gains ? "\(self.gain(gain)) \(Words.Season.gain)" : self.gain(gain)
    }

    /// waivers.ts beatsPlace: "Starter", "Starter, bye" or "Bench".
    static func beatsPlace(starter: Bool, bye: Bool) -> String {
        guard starter else {
            return Words.Waivers.bench
        }
        return bye ? "\(Words.Waivers.starter), \(Words.Waivers.onBye)" : Words.Waivers.starter
    }

    /// waivers.ts beatsWeekWord: "+4.8 Proj".
    static func beatsWeek(_ week: Double) -> String {
        "\(gain(week)) \(Words.Box.proj)"
    }

    /// waivers.ts cardGains: "+6.7 Proj this week, +1.2 Gain a week", the Gain alone once the week
    /// figure is gone.
    static func cardGains(week: Double?, gain: Double) -> String {
        let season = "\(self.gain(gain)) \(Words.Waivers.gain)"
        return week.map { "\(self.gain($0)) \(Words.Waivers.thisWeek), \(season)" } ?? season
    }

    // MARK: names

    /// waivers.ts shortName: the last name, a defense by its club.
    static func shortName(_ name: String) -> String {
        StartRows.lastName(StartRows.withoutDefense(name))
    }

    /// waivers.ts cardName: the last name, or the whole name where another on the screen shares it.
    static func cardName(_ name: String, onScreen: [String]) -> String {
        let short = shortName(name)
        let sharing = Set(onScreen.filter { shortName($0) == short })
        return sharing.count > 1 ? name : short
    }

    /// waivers.ts beatsName: the last name, or the first initial and the last name where another
    /// player on the screen shares it.
    static func beatsName(_ name: String, onScreen: [String]) -> String {
        cardName(name, onScreen: onScreen) == name
            ? StartRows.initialName(StartRows.withoutDefense(name)) : shortName(name)
    }

    // MARK: the strip

    /// waivers.ts pickupsTitle: "Two pickups", "One pickup", or the line for none.
    static func pickupsTitle(_ count: Int) -> String {
        if count == 0 {
            return Words.Waivers.noPickup
        }
        let word = count < numberWords.count ? numberWords[count] : String(count)
        return "\(word) \(count == 1 ? "pickup" : "pickups")"
    }

    /// waivers.ts moveWords: "Add Gainwell, drop Lemon", or "Add Gainwell" into an open spot.
    static func move(add: String, drop: String?) -> String {
        drop.map { "\(Words.InSeason.add) \(add), drop \($0)" } ?? "\(Words.InSeason.add) \(add)"
    }

    /// waivers.ts dropWhyWords: "(IR, on your bench)".
    static func dropWhy(_ why: String?) -> String? {
        why.map { "(\($0))" }
    }

    /// waivers.ts stripDecision: the strip's sentence for VoiceOver.
    static func decision(_ cards: [PickupCard]) -> String {
        let said = cards.map { card in card.why.map { "\(card.move) \($0)" } ?? card.move }
        return ([pickupsTitle(cards.count)] + said).joined(separator: ". ") + "."
    }

    // MARK: the drop panel

    /// waivers.ts dropTitle: "Drop one for Kenny Gainwell".
    static func dropTitle(_ name: String) -> String {
        "Drop one for \(name)"
    }

    /// waivers.ts dropLead: "+6.7 Proj this week with any of them. The one you lose least by comes first."
    static func dropLead(_ week: Double?) -> String {
        let first = "The one you lose least by comes first."
        return week.map { "\(gain($0)) \(Words.Waivers.thisWeek) with any of them. \(first)" } ?? first
    }

    // MARK: the verbs

    /// waivers.ts openWaiversWords: "Open ESPN waivers", the platform's own page by its words (Lane 310).
    static func openWaivers(_ place: HostWords) -> String {
        "Open \(place.own("waivers"))"
    }

    /// waivers.ts addOnWords: "Add on ESPN", the platform placed by its own words (Lane 310).
    static func addOn(_ place: HostWords) -> String {
        "\(Words.InSeason.add) \(place.placed)"
    }

    /// The shape of a host id the claim route takes (move.ts HOST_ID).
    static let hostID = #"^-?[0-9]{1,12}$"#

    /// move.ts claimsAdd: the API opens claims for the league and names him by an id the route takes.
    static func claimsAdd(_ moves: Components.Schemas.WaiverMoves, hostID: String) -> Bool {
        moves.claim.value1 == .available && hostID.range(of: Self.hostID, options: .regularExpression) != nil
    }

    /// waivers.ts addVerbWords: "Add on ESPN" where the claim is made from here, else "Open ESPN waivers".
    static func addVerb(_ moves: Components.Schemas.WaiverMoves, hostID: String, host: HostWords) -> String {
        claimsAdd(moves, hostID: hostID) ? addOn(host) : openWaivers(host)
    }

    /// waivers.ts copiedWords: "Copied Gainwell. Add him on" and "ESPN's waiver page".
    static func copied(_ platform: String, name: String, didCopy: Bool) -> (said: String, page: String) {
        (
            didCopy ? "\(Words.Waivers.copied) \(name). Add him on" : "\(Words.Waivers.copyFailed) Add him on",
            "\(platform)'s waiver page"
        )
    }

    /// waivers.ts clearsWords: "Clears Wed" from the platform's calendar day; nil without one.
    static func clears(_ day: String?) -> String? {
        guard let day, let noon = APIDecoding.parseDate("\(day)T12:00:00Z") else {
            return nil
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEE"
        return "\(Words.Waivers.clears) \(formatter.string(from: noon))"
    }

    // MARK: the heads and the Stash group

    /// waivers.ts backWords: "Back this week" in the week the page addresses, else "Back week 9".
    static func back(_ week: Int, addressed: Int) -> String {
        week == addressed ? Words.Stash.backNow : "Back week \(week)"
    }

    /// waivers.ts headBasis and headBasisText: "A game is our rest-of-season points a game, Avg his season
    /// average, Δ Proj his Proj's change since Thu 9:00 pm, Beats the player he would replace in your
    /// rest-of-season lineup."
    static func heads(previousReadAt: Date?, projected: Bool, zone: TimeZone) -> String {
        let delta = projected ? previousReadAt.map {
            "\(Words.Box.delta) his \(Words.Box.proj)'s change since \(Formatting.weekdayTime($0, zone: zone))"
        } : nil
        let parts = [
            "\(Words.Waivers.rest) \(Words.WaiverHeads.rest)",
            "\(Words.Box.avg) \(Words.WaiverHeads.avg)",
            delta,
            "\(Words.Waivers.beats) \(Words.WaiverHeads.beats)",
        ]
        return parts.compactMap(\.self).joined(separator: Words.WaiverHeads.separator) + "."
    }

    /// waivers.ts stashBasis: the Stash group's line, empty with nothing to say.
    static func stashLine(_ advice: WaiverAdvice) -> [String] {
        let rows = !(advice.stash ?? []).isEmpty
        let late = (advice.stashLate ?? 0) > 0
        let taken = advice.regularSeasonTaken
            .flatMap { rows || late ? "Regular season taken as weeks 1 to \($0)." : nil }
        return [
            rows ? Words.Stash.line : nil,
            (advice.stashUndated ?? 0) > 0 ? Words.Stash.undated : nil,
            late ? Words.Stash.late : nil,
            taken,
        ].compactMap(\.self)
    }

    /// next-week.ts arrivesPart: "Week 7 projections expected Thursday.", nil once read or with no time.
    static func arrives(_ advice: WaiverAdvice, zone: TimeZone) -> String? {
        guard advice.projectionReadAt == nil, let arrival = advice.projectionArrivesAt else {
            return nil
        }
        let day = Formatting.weekdayName(arrival, zone: zone)
        return "Week \(advice.forWeek ?? advice.week) projections expected \(day)."
    }

    // MARK: the claim (move.ts, words.ts)

    /// words.ts verbWords('waivers'): "Claim on ESPN".
    static func claimOn(_ platform: String) -> String {
        "Claim on \(platform)"
    }

    /// move.ts readingWords for a claim: "Reading your roster on ESPN".
    static func reading(_ platform: String) -> String {
        "Reading your roster on \(platform)"
    }

    /// move.ts settingWords for a claim: "Claiming on ESPN".
    static func claiming(_ platform: String) -> String {
        "Claiming on \(platform)"
    }

    /// move.ts lostWords for a claim.
    static func lost(_ platform: String) -> String {
        "We did not hear back, so the claim may have been made. "
            + "Check your claims on \(platform) before you claim again."
    }

    /// move.ts resultWords: the API's sentence, or for a claim the platform's queue holds with when it runs,
    /// that time on the member's clock.
    static func result(_ platform: String, _ result: HostMoveResult, zone: TimeZone) -> String {
        guard result.outcome.value1 == .pending, let runs = result.processesAt else {
            return result.sentence
        }
        return "Claim submitted. \(platform) processes it \(Formatting.weekdayTime(runs, zone: zone)), "
            + "and your lineup screen will show him once it goes through."
    }

    /// move.ts bidLabel: "Your bid in waiver dollars, $0 to $87, what your team has left".
    static func bidLabel(_ bid: HostBid) -> String {
        let basis = bid.leftKnown ? "what your team has left" : "the league's budget"
        return "Your bid in waiver dollars, $\(bid.min) to $\(bid.max), \(basis)"
    }

    /// move.ts bidProblem: a typed bid the league does not take, in the platform's terms; nil for a whole
    /// number in bounds.
    static func bidProblem(_ platform: String, typed: String, bid: HostBid) -> String? {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if let value = bidValue(trimmed), value >= bid.min, value <= bid.max {
            return nil
        }
        return "\(platform) takes bids from $\(bid.min) to $\(bid.max) in this league."
    }

    /// A typed bid as a whole number: digits with an optional sign; nil else. Stricter than JavaScript's
    /// Number, which also takes "1e1" or "0x0A" (review L3): the number pad types neither.
    static func bidValue(_ typed: String) -> Int? {
        guard !typed.isEmpty, typed.range(of: #"^[+-]?[0-9]+(\.0*)?$"#, options: .regularExpression) != nil
        else {
            return nil
        }
        return Double(typed).flatMap { Int(exactly: $0) }
    }
}
