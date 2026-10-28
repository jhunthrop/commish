import CommishAPI
import CommishDesign
import Foundation

/// One side of the check's scoreboard (TradeBug.svelte over trades.ts bugFigures): this week's Proj and
/// the rest-of-season strength, each before and after with the change, "--" without a projection.
public struct TradeFigures: Equatable, Sendable {
    public let projBefore: String
    public let projAfter: String
    public let projChange: String
    public let projTone: Tone
    public let seasonBefore: String
    public let seasonAfter: String
    public let seasonChange: String
    public let seasonTone: Tone

    /// bugFigures: the totals, the side's gain and its change in this week's Proj as the API sends them,
    /// "--" before an answer.
    init(totals: TradeSideTotals?, gain: Double?, projChange: Double?) {
        projBefore = Self.word(totals?.projBefore)
        projAfter = Self.word(totals?.projAfter)
        self.projChange = TradesWords.week(projChange)
        projTone = TradesWords.tone(projChange)
        seasonBefore = Self.word(totals?.seasonBefore)
        seasonAfter = Self.word(totals?.seasonAfter)
        seasonChange = gain.map(TradesWords.gain) ?? Words.Box.none
        seasonTone = TradesWords.tone(gain)
    }

    /// A strength below replacement with the typographic minus, as every signed figure prints.
    static func word(_ value: Double?) -> String {
        guard let value else {
            return Words.Box.none
        }
        let shown = Formatting.fixed(abs(value), 1)
        return value < 0 && Double(shown) != 0 ? "\(TradesWords.minus)\(shown)" : shown
    }
}

/// A side's rest-of-season cell (trades.ts restFigure, Lane 277): its change over the weeks the check
/// covers, toned, and whether that side would not take the trade. Before an answer the none mark; on an
/// answer without the figure (an older API) empty, never a figure we did not read.
public struct TradeRest: Equatable, Sendable {
    public let text: String
    public let tone: Tone
    public let refuses: Bool

    static let none = TradeRest(text: Words.Box.none, tone: .even, refuses: false)

    static func of(_ check: TradeCheck?, mine: Bool) -> TradeRest {
        guard let check else {
            return none
        }
        let trade = check.trade.value1
        guard let rest = mine ? trade.myRestOfSeason : trade.theirRestOfSeason else {
            return TradeRest(text: "", tone: .even, refuses: false)
        }
        let acceptable = check.acceptable?.value1
        let takes = mine ? acceptable?.yours : acceptable?.theirs
        return TradeRest(text: TradesWords.gain(rest), tone: TradesWords.tone(rest), refuses: takes == false)
    }
}

/// One half of the scoreboard: You or With, the team, its figures and its room.
public struct TradeBugSide: Equatable, Sendable {
    public let label: String
    public let name: String
    public let initials: String
    public let mine: Bool
    public let figures: TradeFigures
    public let room: String
    /// Its rest of season (Lane 277).
    public let rest: TradeRest

    init(
        me: Bool, name: String, totals: TradeSideTotals?, gain: Double?, projChange: Double?, room: String,
        rest: TradeRest
    ) {
        self.rest = rest
        label = me ? Words.Trades.yourSide : Words.Trades.theirSide
        self.name = name
        initials = Initials.of(name)
        mine = me
        figures = TradeFigures(totals: totals, gain: gain, projChange: projChange)
        self.room = room
    }
}

/// The builder's scoreboard (TradeBug.svelte): each side's lineup before and after the trade.
public struct TradeBug: Equatable, Sendable {
    public let yours: TradeBugSide
    public let theirs: TradeBugSide
}

/// trades.ts heldCheck and checkRoom, and builder.ts checkWords.
enum TradeChecks {
    /// Every player the trade moves still to be played (trades.ts countsThisWeek).
    static func countsThisWeek(_ row: TradeRow, now: Date) -> Bool {
        let moved = row.give + row.get + (row.drop.map { [$0.value1] } ?? [])
        return !moved.contains { LineRead.game($0, now: now).locked }
    }

    /// trades.ts heldRow: no change this week once a player it moves has kicked off.
    static func held(_ row: TradeRow, now: Date) -> TradeRow {
        guard !countsThisWeek(row, now: now) else {
            return row
        }
        var kept = row
        kept.myProjChange = nil
        kept.theirProjChange = nil
        return kept
    }

    static func held(_ check: TradeCheck, now: Date) -> TradeCheck {
        guard !countsThisWeek(check.trade.value1, now: now) else {
            return check
        }
        var kept = check
        kept.trade = .init(value1: held(check.trade.value1, now: now))
        kept.totals.yours.projBefore = nil
        kept.totals.yours.projAfter = nil
        kept.totals.theirs.projBefore = nil
        kept.totals.theirs.projAfter = nil
        return kept
    }

    /// trades.ts checkRoom: "Drop Dart", "Has room", "No one to drop".
    static func room(_ check: TradeCheck) -> (yours: String, theirs: String) {
        let fills = check.fills
        let yours = !fills.yoursRoom
            ? Words.Trades.noOneToDrop
            : check.trade.value1.drop.map { "\(Words.Trades.sideDrop) \(StartRows.lastName($0.value1.player.name))" }
            ?? Words.Trades.hasRoom
        return (yours, fills.theirsRoom ? Words.Trades.hasRoom : Words.Trades.noOneToDrop)
    }

    static let perWeek = "points over replacement a week"

    /// builder.ts slotPlace: "RB2", "the flex", "every slot".
    static func slotPlace(_ label: String?) -> String {
        guard let label else {
            return "every slot"
        }
        guard label.range(of: "flex", options: .caseInsensitive) != nil else {
            return label
        }
        return "the \(label.replacingOccurrences(of: #" \d+$"#, with: "", options: .regularExpression).lowercased())"
    }

    enum Direction {
        case gains
        case loses
        case none
    }

    static func direction(_ gain: Double) -> Direction {
        if Formatting.fixed(abs(gain), 1) == Formatting.fixed(0, 1) {
            return .none
        }
        return gain > 0 ? .gains : .loses
    }

    static func amount(_ gain: Double) -> String {
        gain > 0 ? TradesWords.gainAmount(gain) : Formatting.fixed(abs(gain), 1)
    }

    /// builder.ts changeWords: the two lineups' change in one sentence.
    static func change(_ row: TradeRow) -> String {
        let mine = direction(row.myGain)
        let theirs = direction(row.theirGain)
        let verb = { (direction: Direction) in direction == .gains ? "gains" : "loses" }
        switch (mine, theirs) {
        case (.none, .none):
            return "Neither lineup changes on our order."
        case (.gains, .gains):
            return "Both lineups gain: yours \(amount(row.myGain)) \(perWeek), theirs \(amount(row.theirGain))."
        case (.none, _):
            return "Your lineup does not change, theirs \(verb(theirs)) \(amount(row.theirGain)) \(perWeek)."
        case (_, .none):
            return "Your lineup \(verb(mine)) \(amount(row.myGain)) \(perWeek), theirs does not change."
        default:
            return "Your lineup \(verb(mine)) \(amount(row.myGain)) \(perWeek), "
                + "theirs \(verb(theirs)) \(amount(row.theirGain))."
        }
    }

    /// builder.ts figuredName: "Kyren Williams (14.2 a game)".
    static func figuredName(_ line: PlayerLine) -> String {
        guard let perGame = line.restOfSeasonPerGame else {
            return line.player.name
        }
        return "\(line.player.name) (\(Formatting.fixed(perGame, 1)) \(Words.InSeason.aGame))"
    }

    /// builder.ts playersWords: " You give ... for ....", "" when no player has the figure.
    static func players(_ row: TradeRow) -> String {
        let all = row.give + row.get
        guard all.contains(where: { $0.restOfSeasonPerGame != nil }) else {
            return ""
        }
        let side = { (lines: [PlayerLine]) in TradesWords.list(lines.map(figuredName)) }
        return " You give \(side(row.give)) for \(side(row.get))."
    }

    /// trades.ts refusalWords (Lane 277): the answer line's lead when a side would not take the trade on
    /// its rest of season, nil when both would or the answer does not say (an older API).
    static func refusal(_ check: TradeCheck) -> String? {
        guard let acceptable = check.acceptable?.value1 else {
            return nil
        }
        if !acceptable.yours, !acceptable.theirs {
            return Words.Trades.bothGiveUp
        }
        if !acceptable.theirs {
            return Words.Trades.theyGiveUp
        }
        return acceptable.yours ? nil : Words.Trades.youGiveUp
    }

    /// builder.ts fillsBoth: a trade both rosters can make.
    static func fillsBoth(_ check: TradeCheck) -> Bool {
        let fills = check.fills
        return fills.yours && fills.theirs && fills.yoursRoom && fills.theirsRoom
    }

    /// builder.ts checkWords: a roster the trade leaves short, a roster with no one to drop, then a side
    /// that would not take it in place of the lineups' change, else each lineup's change; the players
    /// with their points a game, and the drop.
    static func words(_ check: TradeCheck) -> String {
        let fills = check.fills
        let trade = check.trade.value1
        if !fills.yours {
            return "Your roster would not fill \(slotPlace(fills.yoursOpen))."
        }
        if !fills.theirs {
            return "Their roster would not fill \(slotPlace(fills.theirsOpen))."
        }
        if !fills.yoursRoom {
            return "Your roster has no one to drop to make room."
        }
        if !fills.theirsRoom {
            return "Their roster has no one to drop to make room."
        }
        let reason = trade.dropReason.map { " \($0)" } ?? ""
        let drop = trade.drop.map { " You drop \($0.value1.player.name) to make room.\(reason)" } ?? ""
        return "\(refusal(check) ?? change(trade))\(players(trade))\(drop)"
    }
}
