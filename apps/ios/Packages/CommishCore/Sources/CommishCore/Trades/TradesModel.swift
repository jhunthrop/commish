import CommishAPI
import CommishDesign
import Foundation

/// One of our ideas above the rosters (builder.ts Preset, Lane 260): the finder's best trade with a team,
/// the picks it loads, and its card's lines, "Best +5.3 yours, +1.1 theirs", "With Max_Jensen10", then
/// "Rodgers for Waddle and Strong" with what it fills at that line's end, "Fills your WR" (Lane 290).
public struct TradePreset: Equatable, Sendable, Identifiable {
    /// The web's tradeKey, "8:96>7526+8116".
    public let id: String
    public let rosterId: Int
    public let team: String
    /// "With Max_Jensen10".
    public let with: String
    /// "Best" on our best trade where there is more than one idea.
    public let mark: String?
    /// "+5.3 yours, +1.1 theirs".
    public let gains: String
    /// "Rodgers for Waddle and Strong".
    public let deal: String
    /// builder.ts fillsWords: "Fills your WR", nil when it fills none of the member's slots or the answer
    /// does not say (an older API).
    public let fills: String?
    public let picks: TradePicks
    /// Our best trade (worthProposing's first): the screen opens on its team.
    public let lead: Bool
}

/// A team the finder lists no trade with (builder.ts noIdeasFrom, B271): its place says why, by the API's
/// empty_reason (Lane 290, B283), rather than leaving the team out.
public struct NoIdeaLine: Equatable, Sendable, Identifiable {
    public let id: Int
    public let team: String
    /// "With Carried by QJs", over its line.
    public let with: String
    /// "No idea they would take.", "They need what you need.", by the API's reason.
    public let note: String

    /// The teams with no trade, in the answer's order.
    static func of(_ teams: [TradeTeam]) -> [NoIdeaLine] {
        teams.filter(\.trades.isEmpty).map {
            NoIdeaLine(
                id: $0.rosterId, team: $0.name, with: "\(Words.Trades.with) \($0.name)", note: note($0.emptyReason)
            )
        }
    }

    /// builder.ts emptyNote: the line by the API's empty_reason; an answer without one (an older API), or
    /// a reason this app does not know, keeps the line every empty team had.
    static func note(_ reason: Components.Schemas.TradeTeam.EmptyReasonPayload?) -> String {
        switch reason?.value1 {
        case .dropped, nil: Words.Trades.noIdea
        case .sameNeed: Words.Trades.sameNeed
        case .noNeed: Words.Trades.noNeed
        case .nothing: Words.Trades.nothingFound
        }
    }
}

/// One place in the ideas row (builder.ts IdeaPlace): a host's offer, an idea to load, or a team's line
/// with none.
public enum IdeaPlace: Equatable, Sendable, Identifiable {
    case offer(OfferPreset)
    case idea(TradePreset)
    case none(NoIdeaLine)

    /// The web's keys: the offer's, the trade's, or "none:3".
    public var id: String {
        switch self {
        case let .offer(offer): offer.id
        case let .idea(preset): preset.id
        case let .none(line): "none:\(line.id)"
        }
    }

    /// The ticks a tap loads: an idea's, or an offer's the builder can hold; nil on the rest.
    public var picks: TradePicks? {
        switch self {
        case let .offer(offer): offer.picks
        case let .idea(preset): preset.picks
        case .none: nil
        }
    }

    /// builder.ts ideaPlaces (Lane 290 review M2): the host's newest offer heads the row, then our first
    /// idea (Best), then the host's other offers, then our other ideas, then each team with none, so the
    /// three in sight always hold the newest offer and Best.
    static func row(offers: [OfferPreset], presets: [TradePreset], none: [NoIdeaLine]) -> [IdeaPlace] {
        offers.prefix(1).map(IdeaPlace.offer) + presets.prefix(1).map(IdeaPlace.idea)
            + offers.dropFirst().map(IdeaPlace.offer) + presets.dropFirst().map(IdeaPlace.idea)
            + none.map(IdeaPlace.none)
    }
}

/// The ideas row (TradeBuilder's .ideas): its head, the host's offers and our ideas best first, then each
/// team with none; the best three shown and "N more" for the rest.
public struct TradeIdeas: Equatable, Sendable {
    /// builder.ts IDEAS_SHOWN.
    public static let shown = 3

    public let head: String
    public let places: [IdeaPlace]

    /// The places drawn: every one, or the best three.
    public func visible(all: Bool) -> [IdeaPlace] {
        all ? places : Array(places.prefix(Self.shown))
    }

    /// The row at `now`: an offer whose host expiry has passed goes (builder.ts offerPresets, review L2),
    /// so one lapsing while the screen is open leaves on the next draw.
    public func at(_ now: Date) -> TradeIdeas {
        TradeIdeas(head: head, places: places.filter { place in
            guard case let .offer(offer) = place, let ends = offer.endsAt else {
                return true
            }
            return ends > now
        })
    }

    /// builder.ts moreWords: "8 more", nil when every place is drawn.
    public func more(all: Bool) -> String? {
        let hidden = places.count - visible(all: all).count
        return hidden > 0 ? "\(hidden) more" : nil
    }
}

/// The Trades screen at one read (TradeScreen.svelte, builder-first since Lane 260): our ideas, the
/// picks it opens with, the verb and the platform's page, and the basis once under the builder.
public struct TradesModel: Equatable, Sendable {
    public let verb: String
    /// The platform's trade page the verb opens; nil when the API knows none, and the verb stands
    /// disabled with `reason` under it.
    public let page: URL?
    public let reason: String?
    public let platform: String
    public let ideas: TradeIdeas
    /// The builder's opening picks: our best trade's team, nothing ticked.
    public let opening: TradePicks
    /// The phone's basis paragraph, the record's link after it.
    public let basis: String

    /// The answer drawn at `now`.
    /// `words` is the platform's words, the league's own unless a store graphic passes the neutral one
    /// (Lane 310).
    public init(
        advice answer: TradeAdvice, host: Components.Schemas.LeagueHost, now: Date, zone: TimeZone,
        words: HostWords? = nil
    ) {
        let advice = TradeFinder.held(answer, now: now)
        let hostWords = words ?? .of(host)
        let platform = hostWords.name
        let presets = TradeFinder.presets(advice.teams)
        self.platform = platform
        verb = TradesWords.verb(advice.moves, host: hostWords)
        page = advice.hostTradesUrl.isEmpty ? nil : URL(string: advice.hostTradesUrl)
        reason = advice.hostTradesUrl.isEmpty ? advice.hostNote : nil
        let offers = TradeOffers.presets(advice, platform: platform, now: now, zone: zone)
        ideas = TradeIdeas(
            head: Words.Analyzer.ideas,
            places: IdeaPlace.row(offers: offers, presets: presets, none: NoIdeaLine.of(advice.teams))
        )
        opening = TradePicks(team: presets.first(where: \.lead)?.rosterId, give: [], get: [])
        let lines = advice.roster + advice.teams.flatMap { $0.roster + $0.trades.flatMap { $0.give + $0.get } }
        basis = TradesBasis.phone(.init(advice: advice, host: host, lines: lines, zone: zone, now: now))
    }
}

/// trades.ts's finder as the builder's ideas read it: its rows, the strip's pick, the held week.
enum TradeFinder {
    struct Entry {
        let key: String
        let team: TradeTeam
        let row: TradeRow
    }

    /// state.ts tradeKey: "8:96>12481+8116".
    static func key(team: Int, row: TradeRow) -> String {
        let ids = { (side: [PlayerLine]) in side.map(\.player.hostId).sorted().joined(separator: "+") }
        return "\(team):\(ids(row.give))>\(ids(row.get))"
    }

    /// trades.ts tradeRank, the finder's one team order on the API's own keys (Lane 290 review M3): a
    /// trade that is not a close call for them first, then one that fills a slot of the member's, then
    /// the member's gain on the printed tenth. Ties keep the answer's order, the standings'.
    static func rank(_ lhs: Entry, _ rhs: Entry) -> Bool {
        if lhs.row.closeForThem != rhs.row.closeForThem {
            return !lhs.row.closeForThem
        }
        if fills(lhs.row) != fills(rhs.row) {
            return fills(lhs.row)
        }
        return TradesWords.shown(lhs.row.myGain) > TradesWords.shown(rhs.row.myGain)
    }

    /// Whether the answer says the trade fills a slot of the member's (Lane 287's fills set).
    static func fills(_ row: TradeRow) -> Bool {
        row.fills?.value1 != nil || row.fills?.value2 != nil
    }

    /// trades.ts finderRows with each team's best: its first trade (the API's order within a team kept),
    /// the teams by tradeRank (a stable sort, as JavaScript's).
    static func best(_ teams: [TradeTeam]) -> [Entry] {
        let entries = teams.flatMap { team in
            team.trades.prefix(1).map { Entry(key: key(team: team.rosterId, row: $0), team: team, row: $0) }
        }
        return stable(entries, by: rank)
    }

    /// trades.ts worthProposing: each team's best the other team gains from, at most two.
    static func worthProposing(_ teams: [TradeTeam]) -> [Entry] {
        Array(best(teams).filter { !$0.row.closeForThem && $0.row.myGain > 0 }.prefix(2))
    }

    /// builder.ts presetsFrom: each team's best whose players can all be ticked, in the finder's order;
    /// the lead is our best trade, marked Best where there is more than one idea (strip.ts stripMark).
    static func presets(_ teams: [TradeTeam]) -> [TradePreset] {
        let proposed = worthProposing(teams).first?.key
        let loadable = best(teams).compactMap { entry in
            TradeBuilder.built(team: entry.team.rosterId, row: entry.row).map { (entry, $0) }
        }
        return loadable.enumerated().map { index, item in
            let (entry, picks) = item
            let row = entry.row
            let lead = entry.key == proposed
            return TradePreset(
                id: entry.key, rosterId: entry.team.rosterId, team: entry.team.name,
                with: "\(Words.Trades.with) \(entry.team.name)",
                mark: lead && index == 0 && loadable.count > 1 ? Words.Strip.best : nil,
                gains: "\(TradesWords.gain(row.myGain)) \(Words.Analyzer.yours), "
                    + "\(TradesWords.gain(row.theirGain)) \(Words.Analyzer.theirs)",
                deal: "\(TradesWords.shortSide(row.give)) \(TradesWords.forWord) \(TradesWords.shortSide(row.get))",
                fills: TradesWords.fills(row.fills), picks: picks, lead: lead
            )
        }
    }

    /// trades.ts heldTrades: every trade's week change held once a player it moves has kicked off.
    static func held(_ advice: TradeAdvice, now: Date) -> TradeAdvice {
        var held = advice
        held.teams = advice.teams.map { team in
            var team = team
            team.trades = team.trades.map { TradeChecks.held($0, now: now) }
            return team
        }
        return held
    }

    /// A sort that keeps equal elements in their order, as Array.prototype.sort does.
    static func stable(_ entries: [Entry], by before: (Entry, Entry) -> Bool) -> [Entry] {
        entries.enumerated().sorted { lhs, rhs in
            if before(lhs.element, rhs.element) {
                return true
            }
            if before(rhs.element, lhs.element) {
                return false
            }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }
}
