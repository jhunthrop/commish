import CommishAPI
import CommishDesign
import Foundation

/// A row the advice moves: in to the lineup, or out of it to the bench (lineup.ts Move).
public enum Move: String, Equatable, Sendable {
    case into = "in"
    case out
}

/// One row of the lineup or the bench with what the advice does with it (lineup.ts LineupRow).
public struct LineupEntry: Equatable, Sendable, Identifiable {
    public let row: StartRow
    public let move: Move?
    /// The one evidence line a moved-in row opens to; nil off a swap.
    public let why: String?
    /// A spot no rostered player who can play this week fills: the member's player, left there.
    public let idle: Bool

    public var id: String {
        row.id
    }
}

/// One swap as the strip names it: "Mahomes in" at QB, "Rodgers out" (lineup.ts Swap).
public struct Swap: Equatable, Sendable, Identifiable {
    public let id: String
    public let slot: String
    public let into: String
    public let out: String?
}

/// The starters' sums (box.ts BoxTotals).
public struct LineupTotals: Equatable, Sendable {
    public let proj: Double?
    public let pts: Double?
    /// The projected final once a starter has kicked off (the API's projected_final).
    public let final: Double?
    /// A starter of the lineup as set has kicked off: Pts is the big figure.
    public let live: Bool
    /// Every starter with a game is final.
    public let allFinal: Bool
    /// Beside Team: the projection not in yet, or the starters with no Proj.
    public let note: String?
}

/// A spot an undone change leaves empty because its player's game has kicked off (lineup.ts HeldSpot).
public struct HeldSpot: Equatable, Sendable {
    public let slot: String
    public let name: String
}

/// The Lineup as one table (lineup.ts LineupBox): the lineup the advice sets, the bench, the
/// injured reserve, the swaps, the spots no one can play, the totals and the lineup as set.
public struct LineupBox: Equatable, Sendable {
    public let starters: [LineupEntry]
    public let bench: [LineupEntry]
    public let reserve: [StartRow]
    public let swaps: [Swap]
    public let idle: [String]
    public let empty: [String]
    public let totals: LineupTotals
    public let asSet: Double?
    public let gain: Double?
    public let playing: Bool
}

/// lineup.ts heldLineup and lineupBox, ported over the API's answer.
enum LineupBoxes {
    /// The advice with every change on a locked row undone (lineup.ts heldLineup): the platform's
    /// starter keeps the spot, the advised starter goes back to the bench, each player once however
    /// the changes chain; a change into an empty spot leaves it empty, held saying whose game started.
    static func held(_ advice: LineupAdvice, now: Date) -> (advice: LineupAdvice, held: [HeldSpot]) {
        let undone = undoneSlots(advice.slots, now: now)
        guard !undone.isEmpty else {
            return (advice, [])
        }
        let slots = advice.slots.enumerated().compactMap { index, slot -> LineupSlot? in
            guard undone.contains(index) else {
                return slot
            }
            guard let host = slot.host?.value1 else {
                return nil
            }
            var kept = slot
            kept.ours = host
            kept.changed = false
            kept.sentence = nil
            return kept
        }
        let placed = Set(slots.map(\.ours.player.hostId))
        var seen = Set<String>()
        let returned = undone.sorted().map { advice.slots[$0].ours }
        let bench = (advice.bench + returned).filter { line in
            let id = line.player.hostId
            guard !placed.contains(id), !seen.contains(id) else {
                return false
            }
            seen.insert(id)
            return true
        }
        var result = advice
        result.slots = slots
        result.bench = bench
        result.set = slots.allSatisfy { !$0.changed }
        let held = undone.sorted().compactMap { index -> HeldSpot? in
            let slot = advice.slots[index]
            return slot.host == nil
                ? HeldSpot(slot: slotWord(slot.slot), name: shortName(slot.ours.player.name)) : nil
        }
        return (result, held)
    }

    /// The changes held undoes: each on a locked row, then each that moves a player an undone change
    /// hands back to his own spot, until none is left.
    static func undoneSlots(_ slots: [LineupSlot], now: Date) -> Set<Int> {
        var undone = Set(slots.indices.filter { index in
            let slot = slots[index]
            let host = slot.host?.value1
            return slot.changed
                &&
                (LineRead.game(slot.ours, now: now).locked || host
                    .map { LineRead.game($0, now: now).locked } == true)
        })
        var grew = true
        while grew {
            grew = false
            let returned = Set(undone.compactMap { slots[$0].host?.value1.player.hostId })
            for index in slots.indices where slots[index].changed && !undone.contains(index)
                && returned.contains(slots[index].ours.player.hostId) {
                undone.insert(index)
                grew = true
            }
        }
        return undone
    }

    // swiftlint:disable:next function_body_length
    static func box(_ advice: LineupAdvice, held: [HeldSpot], zone: TimeZone, now: Date) -> LineupBox {
        let sat = Set(advice.slots.compactMap { $0.changed ? $0.host?.value1.player.hostId : nil })
        let placed = advice.slots.map { slot in
            (slot: slot, row: StartRows.row(slot.ours, slot: slotWord(slot.slot), zone: zone, now: now))
        }
        let ours = placed.map(\.row)
        let counted = placed.filter { !$0.slot.noOneCanPlay }.map(\.row)
        let satRows = Dictionary(
            advice.slots.compactMap { slot -> (String, StartRow)? in
                guard slot.changed, let host = slot.host?.value1 else {
                    return nil
                }
                return (host.player.hostId, StartRows.row(host, slot: Words.Lineup.sit, zone: zone, now: now))
            },
            uniquingKeysWith: { first, _ in first }
        )
        let starters = placed.map { slot, row -> LineupEntry in
            guard slot.changed else {
                return LineupEntry(row: row, move: nil, why: nil, idle: slot.noOneCanPlay)
            }
            let out = slot.host.flatMap { satRows[$0.value1.player.hostId] }
            return LineupEntry(row: row, move: .into, why: whyLine(row, out: out, slot: row.slot), idle: false)
        }
        let bench = advice.bench.map { line -> LineupEntry in
            let out = sat.contains(line.player.hostId)
            let row = StartRows.row(line, slot: out ? Words.Lineup.sit : "", zone: zone, now: now)
            return LineupEntry(row: row, move: out ? .out : nil, why: nil, idle: false)
        }
        let swaps = placed.compactMap { slot, row -> Swap? in
            guard slot.changed else {
                return nil
            }
            return Swap(
                id: slot.ours.player.hostId, slot: row.slot, into: shortName(slot.ours.player.name),
                out: slot.host.map { shortName($0.value1.player.name) }
            )
        }
        let setRows = placed.compactMap { slot, row -> StartRow? in
            guard !slot.noOneCanPlay else {
                return nil
            }
            guard slot.changed else {
                return row
            }
            return slot.host.flatMap { satRows[$0.value1.player.hostId] }
        }
        let empty = advice.emptySlots.map { slotWord($0) }
        let proj = printedSum(counted.map(\.proj))
        let asSet = printedSum(setRows.map(\.proj))
        let setLines = placed.map { $0.slot.host?.value1 ?? $0.slot.ours }
        let read = LineRead.setState(setLines, now: now)
        let idleSlots = placed.filter(\.slot.noOneCanPlay).map(\.row.slot) + empty
        return LineupBox(
            starters: starters,
            bench: bench,
            reserve: advice.reserve.map { StartRows.row($0, slot: "", zone: zone, now: now) },
            swaps: swaps,
            idle: idleSlots.map(StartWords.idle) + held.map(StartWords.held),
            empty: empty + held.map(\.slot),
            totals: LineupTotals(
                proj: proj,
                pts: advice.playerPoints ? printedSum(ours.map(\.pts)) : advice.teamPoints,
                final: advice.projectedFinal,
                live: setLines.contains { LineRead.started($0, now: now) },
                allFinal: read == .final,
                note: totalsNote(counted, landed: advice.projectionReadAt != nil, week: advice.week)
            ),
            asSet: asSet,
            gain: proj.flatMap { proj in asSet.map { tenth(proj - $0) } },
            playing: read == .kickedOff
        )
    }

    /// box.ts slotWord: the platform's own short words, a defense as "D/ST".
    static func slotWord(_ slot: LineupSlot.SlotPayload) -> String {
        slotWord(slot.value1?.rawValue ?? slot.value2 ?? "")
    }

    static func slotWord(_ slot: LineupAdvice.EmptySlotsPayloadPayload) -> String {
        slotWord(slot.value1?.rawValue ?? slot.value2 ?? "")
    }

    static func slotWord(_ raw: String) -> String {
        switch raw {
        case "FLEX": "Flex"
        case "SUPERFLEX": "SFlex"
        case "DEF": "D/ST"
        default: raw
        }
    }

    /// lineup.ts shortName: "Stroud", and a defense by its club ("Saints" from "Saints D/ST").
    static func shortName(_ name: String) -> String {
        StartRows.lastName(StartRows.withoutDefense(name))
    }

    /// The API's tenths summed and cleaned back to the tenth they are (box.ts printedSum).
    static func printedSum(_ values: [Double?]) -> Double? {
        let held = values.compactMap(\.self)
        return held.isEmpty ? nil : tenth(held.reduce(0, +))
    }

    /// Math.round(value * 10) / 10, half up as JavaScript rounds.
    static func tenth(_ value: Double) -> Double {
        ((value * 10) + 0.5).rounded(.down) / 10
    }

    /// box.ts totalsNote.
    static func totalsNote(_ rows: [StartRow], landed: Bool, week: Int) -> String? {
        guard landed else {
            return "No projection yet for week \(week)"
        }
        let lacking = rows.filter { $0.game != .bye && $0.proj == nil }
        guard !lacking.isEmpty else {
            return nil
        }
        let verb = lacking.contains(where: \.toCome) ? "has" : "had"
        let who = lacking.count > 2 ? "\(lacking.count) starters" : lacking.map(\.name).joined(separator: " and ")
        return "\(who) \(verb) no \(Words.Box.proj)"
    }

    /// lineup.ts whyLine: the one evidence line a swap opens to, from the row's own columns.
    static func whyLine(_ into: StartRow, out: StartRow?, slot: String) -> String {
        let name = shortName(into.name)
        guard let out else {
            return "Your \(slot) spot is empty, so \(name) starts."
        }
        let sat = shortName(out.name)
        let next = into.proj.map { "\(name) is the next \(slot) with a \(Words.Box.proj), \(StartWords.number($0))." }
            ?? "\(name) is next in our order, with no \(Words.Box.proj) this week."
        if out.game == .bye {
            return "\(sat) is on bye. \(next)"
        }
        if out.game == .noClub {
            return "\(sat) is \(Words.Figure.freeAgent). \(next)"
        }
        if let status = out.status, status.rank != nil {
            return "\(sat) is on a season-long list, \(status.mark). \(next)"
        }
        if let status = out.status, !status.question {
            return "\(sat) is listed \(status.mark.prefix(1).lowercased() + status.mark.dropFirst()). \(next)"
        }
        guard let inProj = into.proj, let outProj = out.proj else {
            return next
        }
        var parts = ["\(StartWords.number(inProj)) \(Words.Box.proj) against \(sat)'s \(StartWords.number(outProj))"]
        if let status = into.status {
            parts.append(status.mark)
        }
        if case let .game(place, _) = into.game {
            parts.append(place)
            if let rank = into.oppRank, let against = against(into.position) {
                parts.append(rankWords(rank, outOf: into.oppOf, against: against))
            }
        }
        return "\(parts.joined(separator: ", "))."
    }

    /// lineup.ts AGAINST: a defense has no rank, so no words.
    static func against(_ position: String) -> String? {
        switch position {
        case "QB": Words.Against.QB
        case "RB": Words.Against.RB
        case "WR": Words.Against.WR
        case "TE": Words.Against.TE
        case "K": Words.Against.K
        default: nil
        }
    }

    /// lineup.ts rankWords: "3rd toughest against quarterbacks", "31st, among the easiest for
    /// receivers", "12th of 32 against receivers".
    static func rankWords(_ rank: Int, outOf ranked: Int?, against: String) -> String {
        let ord = Formatting.ordinal(rank)
        switch StartRows.ease(rank, outOf: ranked) {
        case .hard: return "\(ord) toughest against \(against)"
        case .easy: return "\(ord), among the easiest for \(against)"
        case .even: return "\(ord) of \(ranked ?? StartRows.rankedClubs) against \(against)"
        }
    }
}
