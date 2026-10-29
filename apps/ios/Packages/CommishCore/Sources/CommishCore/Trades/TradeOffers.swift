import CommishAPI
import CommishDesign
import Foundation

/// A trade offered to the member on the platform (builder.ts OfferPreset, Lanes 279, 290), a preset at
/// the head of the ideas row: its label, the team, give for get, when it lapses, and the ticks one tap
/// loads. An offer the builder cannot hold loads nothing and says where to answer it. We never answer an
/// offer: the member accepts it on the platform.
public struct OfferPreset: Equatable, Sendable, Identifiable {
    /// The web's key, "offer:fixture-offer-1".
    public let id: String
    public let rosterId: Int
    public let team: String
    /// "Offered to you", the API's own words.
    public let label: String
    /// "With Muttdogs".
    public let with: String
    /// "Mahomes for Kittle and Burrow", with the platform's drop when it names one: ", drop Dart".
    public let deal: String
    /// "Ends Mon 11:56 am"; nil where the platform states none.
    public let expires: String?
    /// When the platform lets it lapse: the row drops it from then (TradeIdeas.at).
    public let endsAt: Date?
    /// The ticks it loads; nil on one the builder cannot hold.
    public let picks: TradePicks?
    /// "Answer it on ESPN." on one the builder cannot hold, else nil.
    public let note: String?

    /// The fact at the deal line's end: where to answer it, else when it lapses.
    public var fact: String? {
        note ?? expires
    }

    /// The same card with its expiry's words.
    func dated(_ words: String?) -> OfferPreset {
        OfferPreset(
            id: id, rosterId: rosterId, team: team, label: label, with: with, deal: deal, expires: words,
            endsAt: endsAt, picks: picks, note: note
        )
    }
}

/// builder.ts offerPresets: the platform's pending offers as presets.
enum TradeOffers {
    /// The most days ahead an expiry names by its weekday; one further names its date.
    static let weekdayDays = 6.0
    static let day = 24.0 * 60 * 60

    /// The offers, newest first as the API sends them, each one whose expiry is still to come at `now`;
    /// only an offer whose team the answer does not hold is left out.
    static func presets(_ advice: TradeAdvice, platform: String, now: Date, zone: TimeZone) -> [OfferPreset] {
        (advice.offers ?? []).compactMap { offer in
            guard let team = advice.teams.first(where: { $0.rosterId == offer.rosterId }) else {
                return nil
            }
            if let ends = offer.expiresAt, ends <= now {
                return nil
            }
            let card = preset(offer, team: team, roster: advice.roster, platform: platform)
            return card.dated(offer.expiresAt.map { expiry($0, now: now, zone: zone) })
        }
    }

    /// One offer's card, its expiry's words still to set.
    static func preset(
        _ offer: Components.Schemas.TradeOffer, team: TradeTeam, roster: [PlayerLine], platform: String
    ) -> OfferPreset {
        let find = { (lines: [PlayerLine], ids: [String]) in
            ids.flatMap { id in lines.filter { $0.player.hostId == id } }
        }
        let give = find(roster, offer.give)
        let get = find(team.roster, offer.get)
        let drop = find(roster, offer.drop)
        let drawn = give.count == offer.give.count && get.count == offer.get.count && drop.count == offer.drop.count
        let holds = { (side: [PlayerLine]) in
            !side.isEmpty && side.count <= TradeBuilder.maxASide && side.allSatisfy(TradeBuilder.pickable)
        }
        let loadable = drawn && offer.drop.isEmpty && holds(give) && holds(get)
        let dropped = drop.isEmpty ? "" : ", \(Words.Trades.sideDrop.lowercased()) \(TradesWords.shortSide(drop))"
        return OfferPreset(
            id: "offer:\(offer.hostOfferId)", rosterId: team.rosterId, team: team.name, label: offer.label,
            with: "\(Words.Trades.with) \(team.name)",
            deal: drawn
                ? "\(side(give)) \(TradesWords.forWord) \(side(get, first: false))\(dropped)"
                : Words.Trades.offRoster,
            expires: nil,
            endsAt: offer.expiresAt,
            picks: loadable ? TradePicks(team: team.rosterId, give: offer.give, get: offer.get) : nil,
            note: loadable ? nil : "\(Words.Trades.answerOn) \(platform)."
        )
    }

    /// When an offer lapses on the member's clock: "Ends Fri 3:00 pm", "Ends Nov 8" a week or more out.
    static func expiry(_ ends: Date, now: Date, zone: TimeZone) -> String {
        let near = ends.timeIntervalSince(now) < weekdayDays * day
        let when = near ? Formatting.weekdayTime(ends, zone: zone) : Formatting.shortDay(ends, zone: zone)
        return "\(Words.Trades.expires) \(when)"
    }

    /// An offer's side by last names, "Nothing" (or "nothing" after "for") for a side naming no player.
    static func side(_ lines: [PlayerLine], first: Bool = true) -> String {
        if !lines.isEmpty {
            return TradesWords.shortSide(lines)
        }
        return first ? Words.Trades.noPlayer : Words.Trades.noPlayer.lowercased()
    }
}
