import CommishAPI
import CommishDesign
import Foundation

/// The Waivers screen at one clock (WaiverScreen.svelte at 390): the strip with a card for each pickup
/// worth making, the line under the heads, the players free to add (the rows that gain, then the rest
/// under one divider, then the Stash group with its line), the basis once, and what the one verb acts
/// on. Every rule is the API's: the pickup rule, the order, whom an add beats, whether the claim is made
/// from here. Nothing is computed but the words.
public struct WaiverModel: Equatable, Sendable {
    /// "Week 6": the week the page addresses.
    public let week: String
    public let title: String
    /// The strip in one sentence, its name for VoiceOver (waivers.ts stripDecision).
    public let decision: String
    public let sum: PickupSum?
    public let cards: [PickupCard]
    /// Whether Proj is drawn: not before the week's published projection is read.
    public let projected: Bool
    /// "Week 7 projections expected Thursday.", over the table while there is no Proj.
    public let arrives: String?
    /// The line under the heads, said once.
    public let heads: String
    public let gaining: [PoolRow]
    public let rest: [PoolRow]
    public let stash: [PoolRow]
    public let stashLine: [String]
    public let basis: String
    public let platform: String
    /// The platform's waiver page, nil when the API knows none.
    public let page: URL?
    /// The API's line under the verb: why it opens the platform, or its note.
    public let line: String
    /// The week a claim names: the platform's.
    let claimWeek: Int
    let advice: WaiverAdvice
    let zone: TimeZone
    let now: Date

    public init(advice: WaiverAdvice, host: Components.Schemas.LeagueHost, now: Date, zone: TimeZone) {
        let platform = ValueWords.platform(host)
        let cards = WaiverRows.cards(advice, platform: platform)
        let pool = WaiverRows.pool(advice, zone: zone, now: now)
        self.platform = platform
        self.cards = cards
        week = "\(Words.LeagueHome.week) \(advice.forWeek ?? advice.week)"
        title = WaiverWords.pickupsTitle(cards.count)
        decision = WaiverWords.decision(cards)
        sum = WaiverRows.sum(advice)
        projected = advice.projectionReadAt != nil
        arrives = WaiverWords.arrives(advice, zone: zone)
        heads = WaiverWords.heads(
            previousReadAt: advice.projectionPreviousReadAt, projected: projected, zone: zone
        )
        gaining = pool.filter(\.gains)
        rest = pool.filter { !$0.gains }
        stash = WaiverRows.stash(advice, zone: zone, now: now)
        stashLine = WaiverWords.stashLine(advice)
        basis = WaiverBasis.phone(advice, zone: zone, now: now)
        page = advice.hostWaiversUrl.isEmpty ? nil : URL(string: advice.hostWaiversUrl)
        line = advice.moves.reason ?? advice.hostNote ?? advice.moves.note ?? ""
        claimWeek = advice.week
        self.advice = advice
        self.zone = zone
        self.now = now
    }

    /// Every row the table draws, in its order.
    public var rows: [PoolRow] {
        gaining + rest + stash
    }

    /// The players an add could replace, the advice's drop first.
    public func drops(_ row: PoolRow) -> [DropRow] {
        WaiverRows.drops(row.source, roster: advice.roster, zone: zone, now: now)
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
        let names = WaiverRows.names(advice)
        return WaiverWords.move(
            add: WaiverWords.cardName(source.add.player.name, onScreen: names),
            drop: drop.map { WaiverWords.cardName($0.cells.row.name, onScreen: names) }
        )
    }

    /// A row's verb by the Waivers rule: "Add on ESPN" where the claim is made here, else "Open ESPN waivers".
    public func verb(_ source: WaiverRow) -> String {
        WaiverWords.addVerb(advice.moves, hostID: source.add.player.hostId, platform: platform)
    }

    /// Whether an add's claim is made from here.
    public func claimsHere(_ source: WaiverRow) -> Bool {
        WaiverWords.claimsAdd(advice.moves, hostID: source.add.player.hostId)
    }

    /// His name as a card says it, for the line once his name is copied.
    func shortName(_ source: WaiverRow) -> String {
        WaiverWords.cardName(source.add.player.name, onScreen: WaiverRows.names(advice))
    }

    /// move.ts claimMove: his add, the drop he displaces and the bid, for the platform's week.
    func claim(_ source: WaiverRow, bid: Int?) -> HostMoveInput {
        HostMoveInput(
            kind: .init(value1: .claim), week: claimWeek, changes: [],
            claim: .init(value1: .init(
                add: source.add.player.hostId, drop: source.drop?.value1.player.hostId, bid: bid
            ))
        )
    }
}
