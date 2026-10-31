import CommishAPI
import CommishDesign
import Foundation

/// A position the page's adds hold (WaiverScreen.svelte POSITIONS): the route's position and its word, a
/// count card's where the answer carries no panel.
public struct PositionChip: Equatable, Sendable, Identifiable {
    public let position: WaiverPosition
    public let word: String

    public var id: String {
        position.rawValue
    }
}

/// The table's rows in a sort and a search: the rows that gain, the rest under the divider, the Stash
/// group.
public struct WaiverTable: Equatable, Sendable {
    public let gaining: [PoolRow]
    public let rest: [PoolRow]
    public let stash: [PoolRow]

    /// Every row the table draws, in its order.
    public var rows: [PoolRow] {
        gaining + rest + stash
    }
}

/// The Waivers screen at one clock (WaiverScreen.svelte at 390): the strip with a card for each pickup
/// worth making, the position cards, the line under the heads, the players free to add (the rows that
/// gain, then the rest under one divider, then the Stash group with its line) in any sort and search,
/// the basis once, and what the one verb acts on. The page's answer carries the strip and the cards; the
/// answer shown (the page's, or a position's own read) carries the table, drawn at its read's instant.
/// Every rule is the API's: the pickup rule, the order, whom an add beats, whether the claim is made from
/// here. Nothing is computed but the words and the sort.
public struct WaiverModel: Equatable, Sendable {
    /// "Week 6": the week the page addresses.
    public let week: String
    public let title: String
    /// The strip in one sentence, its name for VoiceOver (waivers.ts stripDecision).
    public let decision: String
    public let sum: PickupSum?
    public let cards: [PickupCard]
    /// The positions among the page's adds, in the board's order, each a read of its own.
    public let positions: [PositionChip]
    /// Whether Proj is drawn: not before the week's published projection is read.
    public let projected: Bool
    /// "Week 7 projections expected Thursday.", over the table while there is no Proj.
    public let arrives: String?
    /// The line under the heads, said once.
    public let heads: String
    public let stashLine: [String]
    public let basis: String
    public let platform: String
    /// The platform's words: the league's own, or the store graphics' neutral one (Lane 310).
    let hostWords: HostWords
    /// The platform's waiver page, nil when the API knows none.
    public let page: URL?
    /// The API's line under the verb: why it opens the platform, or its note.
    public let line: String
    let pool: [PoolRow]
    let stashPool: [PoolRow]
    let advice: WaiverAdvice
    let shown: WaiverAdvice
    let zone: TimeZone
    let now: Date
    /// The page's clock, which the cards and the member's players are drawn at (WaiverScreen's pageNow).
    let pageNow: Date

    /// The positions the route narrows to, in the board's order (WaiverScreen.svelte POSITIONS).
    static let order: [WaiverPosition] = [.qb, .rb, .wr, .te, .k, .def]

    public init(
        advice: WaiverAdvice, shown: WaiverAdvice? = nil, host: Components.Schemas.LeagueHost, now: Date,
        zone: TimeZone, pageNow: Date? = nil, words: HostWords? = nil
    ) {
        let hostWords = words ?? .of(host)
        let platform = hostWords.name
        let shown = shown ?? advice
        var named = shown
        named.pickups = advice.pickups
        let cards = WaiverRows.cards(advice, host: hostWords, moves: shown.moves)
        self.platform = platform
        self.hostWords = hostWords
        self.cards = cards
        week = "\(Words.LeagueHome.week) \(advice.forWeek ?? advice.week)"
        title = WaiverWords.pickupsTitle(cards.count)
        decision = WaiverWords.decision(cards)
        sum = WaiverRows.sum(advice)
        positions = Self.order.filter { position in
            advice.rows.contains { $0.add.player.position == position.rawValue }
        }.map { PositionChip(position: $0, word: StartRows.positionWord($0.rawValue)) }
        projected = shown.projectionReadAt != nil
        arrives = WaiverWords.arrives(shown, zone: zone)
        heads = WaiverWords.heads(
            previousReadAt: shown.projectionPreviousReadAt, projected: projected, zone: zone
        )
        pool = WaiverRows.pool(shown, pickups: advice.pickups, zone: zone, now: now)
        stashPool = WaiverRows.stash(named, zone: zone, now: now)
        stashLine = WaiverWords.stashLine(shown)
        basis = WaiverBasis.phone(shown, zone: zone, now: now)
        page = shown.hostWaiversUrl.isEmpty ? nil : URL(string: shown.hostWaiversUrl)
        line = shown.moves.reason ?? shown.hostNote ?? shown.moves.note ?? ""
        self.advice = advice
        self.shown = shown
        self.zone = zone
        self.now = now
        self.pageNow = pageNow ?? now
    }

    /// The table in a sort and a search (waivers.ts sortRows, findRows, gainGroups), the Stash group the
    /// same way.
    public func table(_ sort: WaiverSort = .initial, query: String = "") -> WaiverTable {
        let rows = WaiverRows.found(WaiverRows.sorted(pool, by: sort), query)
        return WaiverTable(
            gaining: rows.filter(\.gains), rest: rows.filter { !$0.gains },
            stash: WaiverRows.found(WaiverRows.sorted(stashPool, by: sort), query)
        )
    }

    /// The rows that gain in the table's default order.
    public var gaining: [PoolRow] {
        table().gaining
    }

    /// The rows with no gain in the default order.
    public var rest: [PoolRow] {
        table().rest
    }

    /// The Stash group in the default order.
    public var stash: [PoolRow] {
        table().stash
    }

    /// Every row the table can draw, in the default order.
    public var rows: [PoolRow] {
        table().rows
    }

    /// The players an add could replace, the advice's drop first.
    public func drops(_ row: PoolRow) -> [DropRow] {
        drops(row.source)
    }

    func drops(_ source: WaiverRow) -> [DropRow] {
        WaiverRows.drops(source, roster: shown.roster, zone: zone, now: now)
    }

    // MARK: the position cards (Lane 305 on the web)

    /// The cards in the mode (position-nav.ts navCards over the page's answer): the All card counts every
    /// free agent of the page's answer, a count card a position where the answer carries no panel.
    public func nav(_ mode: PanelMode) -> [NavCard] {
        let all = WaiverRows.pool(advice, pickups: advice.pickups, zone: zone, now: pageNow)
        let byPosition = positions.map { chip in
            (
                chip.position.rawValue,
                WaiverNav.counts(all.filter { $0.source.add.player.position == chip.position.rawValue })
            )
        }
        return WaiverNav.cards(advice, mode: mode, counts: WaiverNav.counts(all), byPosition: byPosition)
    }

    /// The card the screen opens on: the weakest Need, else All.
    public var opening: String {
        WaiverNav.opening(advice)
    }

    /// Whether the toggle is drawn: a card reads this week.
    public var navHasWeek: Bool {
        (advice.positions ?? []).contains { $0.week != nil }
    }

    /// The line over the comparison for the chosen card.
    public func lead(_ key: String, mode: PanelMode) -> NavLead {
        WaiverNav.lead(advice, key: key, mode: mode)
    }

    /// The member's players at the chosen position, starters first in the mode's lineup.
    public func yours(_ key: String, mode: PanelMode) -> [YoursRow] {
        WaiverNav.yours(advice, key: key, mode: mode, zone: zone, now: pageNow)
    }

    /// The drop panel's head and lead: "Drop one for Mason Taylor", "+4.8 Proj this week with any of them.
    /// The one you lose least by comes first."
    public func dropHead(_ row: PoolRow) -> (title: String, lead: String) {
        let drops = drops(row)
        return (
            WaiverWords.dropTitle(row.cells.row.name),
            WaiverWords.dropLead(WaiverRows.sameWeek(drops.map(\.weekGain)))
        )
    }

    /// The pair the drop panel's verb makes: "Add Taylor, drop Dart".
    public func pairWords(_ source: WaiverRow, drop: DropRow?) -> String {
        let names = WaiverRows.names(shown)
        return WaiverWords.move(
            add: WaiverWords.cardName(source.add.player.name, onScreen: names),
            drop: drop.map { WaiverWords.cardName($0.cells.row.name, onScreen: names) }
        )
    }

    /// A row's verb by the Waivers rule: "Add on ESPN" where the claim is made here, else "Open ESPN waivers".
    public func verb(_ source: WaiverRow) -> String {
        WaiverWords.addVerb(shown.moves, hostID: source.add.player.hostId, host: hostWords)
    }

    /// The sheet's verb on his row (WaiverScreen.svelte shelfOffer): a stash an open IR slot takes with
    /// no drop, the stash verb with his week under it; else the claim in the screen's words with the pair
    /// and its gain (a stash's week in place of a gain) under it, the advice's drop first.
    public func sheetOffer(_ row: PoolRow) -> (label: String, line: String) {
        if let stash = row.stash, stash.slotTakesHim, !stash.drops {
            return (Words.Stash.verb, stash.back)
        }
        let advised = drops(row).first
        let paired = WaiverRows.with(row.source, drop: advised)
        let tail = row.stash.map(\.back) ?? WaiverWords.cardGains(week: paired.weekGain, gain: paired.gain)
        return (verb(paired), "\(pairWords(row.source, drop: advised)), \(tail)")
    }

    /// Whether an add's claim is made from here.
    public func claimsHere(_ source: WaiverRow) -> Bool {
        WaiverWords.claimsAdd(shown.moves, hostID: source.add.player.hostId)
    }

    /// His name as a card says it, for the line once his name is copied.
    func shortName(_ source: WaiverRow) -> String {
        WaiverWords.cardName(source.add.player.name, onScreen: WaiverRows.names(shown))
    }

    /// move.ts claimMove: his add, the drop he displaces and the bid, for the platform's week.
    func claim(_ source: WaiverRow, bid: Int?) -> HostMoveInput {
        HostMoveInput(
            kind: .init(value1: .claim), week: shown.week, changes: [],
            claim: .init(value1: .init(
                add: source.add.player.hostId, drop: source.drop?.value1.player.hostId, bid: bid
            ))
        )
    }
}
