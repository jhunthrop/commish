import CommishAPI
import CommishDesign
import Foundation

/// Whom an add beats, as the Beats cell prints it (waivers.ts BeatsCell): the player his move replaces
/// with his place, or the open spot he fills; the season Gain, loud on a row that gains; and on the
/// strip's own move its week figure under it.
public struct BeatsCell: Equatable, Sendable {
    public struct Who: Equatable, Sendable {
        public let name: String
        public let place: String
    }

    public let who: Who?
    /// "+1.8 Gain", "0.0", "--"; nil on a Stash row, which names no Gain.
    public let figure: String?
    public let loud: Bool
    /// "+4.8 Proj" under the Gain on the strip's move, else nil.
    public let week: String?
}

/// A Stash row's own cells (waivers.ts StashCell): Stash where an open IR slot takes him, else Add; and
/// whether he names a drop, so either verb opens the drop panel.
public struct StashCell: Equatable, Sendable {
    public let back: String
    public let slotTakesHim: Bool
    public let drops: Bool
}

/// One player free to add, as the phone's table draws him (WaiverTable.svelte at 390): his box row's
/// cells, the evidence line with A game after it, the day a claim clears, the Beats cell and his button.
public struct PoolRow: Equatable, Sendable, Identifiable {
    /// waivers.ts addKey: his platform id, else his board id.
    public let key: String
    public let cells: RowCells
    /// "Opp 2nd, Avg 8.9, Last 10.5, A game 6.4".
    public let evidence: String
    /// "Clears Wed", where the platform says it.
    public let clears: String?
    /// A Stash row's "Back week 9", said in place of his game.
    public let away: String?
    /// The strip names him: his row is tinted.
    public let named: Bool
    /// He is offered as a pickup: drawn over the divider, his Gain loud.
    public let gains: Bool
    public let beats: BeatsCell
    public let stash: StashCell?
    /// The default sort's figure: the season Gain, or a stash's rate from his return.
    let order: Double
    /// His rest-of-season points a game (a stash's from his return), the A game column's figure.
    let rest: Double?
    public let source: WaiverRow

    public var id: String {
        key
    }

    /// The row's own button: Stash where an open IR slot takes him, else Add.
    public var button: String {
        stash?.slotTakesHim == true ? Words.Stash.verb : Words.InSeason.add
    }

    /// A stash an open IR slot takes with no drop opens the platform's page with his name; every other
    /// row's button opens the players he could replace.
    public var opensPage: Bool {
        stash.map { $0.slotTakesHim && !$0.drops } ?? false
    }

    /// The player his name opens in the sheet, keyed by the row's own key (a free agent has no
    /// platform id): nil where the site has no page for him.
    public var sheetPlayer: SheetPlayer? {
        let row = cells.row
        return row.slug.map { slug in
            SheetPlayer(
                id: key, slug: slug, name: row.name, position: row.position,
                rank: row.rank.map(String.init) ?? row.status?.rank, club: row.club, boardID: row.boardID
            )
        }
    }
}

/// One card of the strip (PickupStrip.svelte): his slot, Best over the first of more than one, the
/// move, why its drop is the one named, the gains and the card's verb.
public struct PickupCard: Equatable, Sendable, Identifiable {
    public let key: String
    public let slot: String
    public let mark: String?
    public let move: String
    public let why: String?
    public let gains: String
    public let verb: String
    public let source: WaiverRow

    public var id: String {
        key
    }
}

/// The strip's sum (waivers.ts PickupSum): "105.4" over "Proj with both, 98.9 without" and its gain.
public struct PickupSum: Equatable, Sendable {
    public let figure: String
    public let words: String
    public let gain: String
}

/// One player of the member's an add could replace, as the drop panel draws him.
public struct DropRow: Equatable, Sendable, Identifiable {
    public let key: String
    public let cells: RowCells
    public let evidence: String
    /// The season Gain with him dropped.
    public let gain: String
    /// "+6.7 Proj" where the drops' week gains differ, else nil (the lead says it once).
    public let week: String?
    /// "Starter" where this week's lineup starts him.
    public let starter: String?
    let line: PlayerLine
    let weekGain: Double?
    let seasonGain: Double

    public var id: String {
        key
    }
}

/// waivers.ts's rows over the API's answer: the table's, the Stash group's, the strip's cards and the
/// drop panel's. Nothing is inferred or re-ordered here but the table's default sort.
enum WaiverRows {
    /// move.ts addKey.
    static func key(_ row: WaiverRow) -> String {
        let player = row.add.player
        return player.hostId.isEmpty ? "board:\(player.boardId ?? player.name)" : player.hostId
    }

    /// waivers.ts namesOnScreen: the adds, the stashes and the member's roster.
    static func names(_ advice: WaiverAdvice) -> [String] {
        (advice.rows + advice.pickups + (advice.stash ?? [])).map(\.add.player.name)
            + advice.roster.map(\.player.name)
    }

    static func cells(_ line: PlayerLine, reserve: ReserveRow?, zone: TimeZone, now: Date) -> RowCells {
        RowCells(nil, row: StartRows.row(line, slot: "", zone: zone, now: now, ranked: false), reserve: reserve)
    }

    static func evidence(_ cells: RowCells, rest: Double?) -> String {
        "\(cells.evidence), \(Words.Waivers.rest) \(StartWords.number(rest))"
    }

    /// waivers.ts poolRows over the shown answer's rows and roster, the page answer's pickups tinting the
    /// strip's own, in the answer's order.
    static func pool(_ shown: WaiverAdvice, pickups: [WaiverRow], zone: TimeZone, now: Date) -> [PoolRow] {
        let cards = Dictionary(pickups.map { (key($0), $0) }, uniquingKeysWith: { first, _ in first })
        var named = shown
        named.pickups = pickups
        named.stash = nil
        let names = names(named)
        return shown.rows.map { source in
            let card = cards[key(source)]
            let gains = card != nil || (WaiverWords.positive(source.gain) && source.beats != nil)
            let cells = cells(source.add, reserve: nil, zone: zone, now: now)
            return PoolRow(
                key: key(source), cells: cells, evidence: evidence(cells, rest: source.add.restOfSeasonPerGame),
                clears: WaiverWords.clears(source.clears), away: nil, named: card != nil, gains: gains,
                beats: beats(source, gains: gains, card: card, names: names), stash: nil, order: source.gain,
                rest: source.add.restOfSeasonPerGame, source: source
            )
        }
    }

    /// waivers.ts stashRows, in the answer's order.
    static func stash(_ advice: WaiverAdvice, zone: TimeZone, now: Date) -> [PoolRow] {
        let names = names(advice)
        let addressed = advice.forWeek ?? advice.week
        return (advice.stash ?? []).compactMap { source in
            guard let stash = source.stash?.value1 else {
                return nil
            }
            let cells = cells(source.add, reserve: .slot, zone: zone, now: now)
            let who: BeatsCell.Who? = if let drop = source.drop?.value1 {
                .init(name: WaiverWords.beatsName(drop.player.name, onScreen: names), place: Words.Stash.drop)
            } else if stash.irSlot {
                .init(name: Words.Stash.slot, place: Words.Stash.open)
            } else {
                nil
            }
            return PoolRow(
                key: key(source), cells: cells, evidence: evidence(cells, rest: stash.perGame),
                clears: WaiverWords.clears(source.clears), away: WaiverWords.back(stash.backWeek, addressed: addressed),
                named: false, gains: false, beats: BeatsCell(who: who, figure: nil, loud: false, week: nil),
                stash: StashCell(
                    back: WaiverWords.back(stash.backWeek, addressed: addressed), slotTakesHim: stash.irSlot,
                    drops: source.drop != nil
                ),
                order: stash.perGame ?? -.infinity, rest: stash.perGame, source: source
            )
        }
    }

    /// waivers.ts beatsOf: whom the API names, with the row's season Gain; a row that gains nothing names
    /// no one, and a Gain with no one named is no Gain the page can stand behind.
    static func beats(_ source: WaiverRow, gains: Bool, card: WaiverRow?, names: [String]) -> BeatsCell {
        let named = source.beats?.value1
        let who = named.flatMap { beats -> BeatsCell.Who? in
            guard gains else {
                return nil
            }
            let name = beats.openSpot ? Words.Waivers.openSpot : WaiverWords.beatsName(beats.name, onScreen: names)
            return .init(name: name, place: WaiverWords.beatsPlace(starter: beats.starter, bye: beats.bye == true))
        }
        let judged = named != nil || !WaiverWords.positive(source.gain)
        let gain = judged ? source.gain : nil
        return BeatsCell(
            who: who, figure: WaiverWords.beats(gain: gain, gains: gains), loud: gains && (gain ?? 0) > 0,
            week: card?.weekGain.map(WaiverWords.beatsWeek)
        )
    }

    /// waivers.ts dropWhy: "IR, on your bench" for a drop on injured reserve this week's lineup sits.
    static func dropWhy(_ source: WaiverRow) -> String? {
        guard let drop = source.drop?.value1, StartRows.onReserve(drop) else {
            return nil
        }
        let starts = source.drops.contains { $0.hostId == drop.player.hostId && $0.startsThisWeek }
        return starts ? nil : Words.Waivers.irBench
    }

    /// waivers.ts pickupCards with the card's verb, in the API's order.
    static func cards(_ advice: WaiverAdvice, host: HostWords, moves: Components.Schemas.WaiverMoves) -> [PickupCard] {
        let names = names(advice)
        return advice.pickups.enumerated().map { index, source in
            let add = WaiverWords.cardName(source.add.player.name, onScreen: names)
            let drop = source.drop.map { WaiverWords.cardName($0.value1.player.name, onScreen: names) }
            return PickupCard(
                key: key(source), slot: StartRows.positionWord(source.add.player.position),
                mark: index == 0 && advice.pickups.count > 1 ? Words.Strip.best : nil,
                move: WaiverWords.move(add: add, drop: drop), why: WaiverWords.dropWhy(dropWhy(source)),
                gains: WaiverWords.cardGains(week: source.weekGain, gain: source.gain),
                verb: WaiverWords.addVerb(moves, hostID: source.add.player.hostId, host: host),
                source: source
            )
        }
    }

    /// waivers.ts pickupSum: every figure the API's; nil without both Proj, without a card, or once a
    /// card's week figure is gone.
    static func sum(_ advice: WaiverAdvice) -> PickupSum? {
        guard let without = advice.lineupProj, let withAll = advice.pickupsProj, !advice.pickups.isEmpty,
              advice.pickups.allSatisfy({ $0.weekGain != nil })
        else {
            return nil
        }
        let count = advice.pickups.count
        let them = count == 1 ? "him" : count == 2 ? "both" : "all three"
        return PickupSum(
            figure: StartWords.number(withAll),
            words: "\(Words.Box.proj) with \(them), \(StartWords.number(without)) without",
            gain: WaiverWords.gain(withAll - without)
        )
    }

    /// waivers.ts dropRows: every player he could replace, the advice's drop first, from the roster.
    static func drops(_ source: WaiverRow, roster: [PlayerLine], zone: TimeZone, now: Date) -> [DropRow] {
        let lines = Dictionary(roster.map { ($0.player.hostId, $0) }, uniquingKeysWith: { first, _ in first })
        let rows = source.drops.compactMap { drop -> (Components.Schemas.WaiverDrop, PlayerLine)? in
            lines[drop.hostId].map { (drop, $0) }
        }
        let week = sameWeek(rows.map(\.0.weekGain))
        return rows.map { drop, line in
            let plain = cells(line, reserve: nil, zone: zone, now: now)
            let reserve: ReserveRow? = plain.row.reserve && !drop.startsThisWeek ? .bench : nil
            return DropRow(
                key: drop.hostId, cells: cells(line, reserve: reserve, zone: zone, now: now),
                evidence: evidence(plain, rest: line.restOfSeasonPerGame), gain: WaiverWords.gain(drop.gain),
                week: week == nil ? drop.weekGain.map { "\(WaiverWords.gain($0)) \(Words.Box.proj)" } : nil,
                starter: drop.startsThisWeek ? Words.Waivers.starter : nil, line: line, weekGain: drop.weekGain,
                seasonGain: drop.gain
            )
        }
    }

    /// waivers.ts sameWeekGain: the week's gain said once when every drop gives the same.
    static func sameWeek(_ gains: [Double?]) -> Double? {
        guard let first = gains.first, gains.allSatisfy({ $0 == first }) else {
            return nil
        }
        return first
    }

    /// waivers.ts withDrop: the row an add's claim names with the drop the member chose.
    static func with(_ source: WaiverRow, drop: DropRow?) -> WaiverRow {
        guard let drop else {
            return source
        }
        var paired = source
        paired.drop = .init(value1: drop.line)
        paired.gain = drop.seasonGain
        paired.weekGain = drop.weekGain
        return paired
    }
}
