import CommishAPI
import CommishDesign
import Foundation

/// Which way a figure went, as its cell is inked: up a gain, down a loss, none even (trades.ts toneOf).
public enum Tone: String, Equatable, Sendable {
    case gain
    case loss
    case even
}

/// The Trades screen's words a function builds (web/src/lib/league/box/trades.ts, inseason/words.ts
/// and builder.ts), each a port held to the web's output by shared/fixtures/parity/trades.json.
public enum TradesWords {
    static let minus = "\u{2212}"
    static let countWords = ["No", "One", "Two"]
    /// TradeStrip's words between a card's parts: "with Max_Jensen10", "Rodgers for Skattebo".
    public static let with = "with"
    public static let forWord = "for"

    /// format/list.ts listWords: "Skattebo and Strong", "A, B and C".
    static func list(_ items: [String]) -> String {
        guard items.count > 1, let last = items.last else {
            return items.joined()
        }
        return "\(items.dropLast().joined(separator: ", ")) and \(last)"
    }

    /// number.ts signed: "+5.7", "−0.3", "+0.0".
    static func signed(_ value: Double) -> String {
        let magnitude = Formatting.fixed(abs(value), 1)
        return value < 0 && Double(magnitude) != 0 ? "\(minus)\(magnitude)" : "+\(magnitude)"
    }

    /// A figure to the tenth a cell prints: the number `Number(fixed(value, 1))` reads back.
    static func shown(_ value: Double) -> Double {
        Double(Formatting.fixed(value, 1)) ?? value
    }

    /// trades.ts gainWord: "+5.7", "−0.3".
    public static func gain(_ value: Double) -> String {
        signed(shown(value))
    }

    /// trades.ts weekWord: "+7.3", "−5.6", "0.0", "--" without one.
    public static func week(_ change: Double?) -> String {
        guard let change else {
            return Words.Box.none
        }
        let figure = shown(change)
        return figure == 0 ? Formatting.fixed(0, 1) : signed(figure)
    }

    /// trades.ts toneOf.
    public static func tone(_ value: Double?) -> Tone {
        guard let value else {
            return .even
        }
        let figure = shown(value)
        if figure == 0 {
            return .even
        }
        return figure > 0 ? .gain : .loss
    }

    /// trades.ts worthTitle: "Two trades worth proposing", "One trade worth proposing".
    static func worthTitle(_ count: Int) -> String {
        let number = count < countWords.count ? countWords[count] : String(count)
        return "\(number) \(count == 1 ? "trade" : "trades") worth proposing"
    }

    /// trades.ts shortSide: a side by last names, "Skattebo and Strong".
    static func shortSide(_ side: [PlayerLine]) -> String {
        list(side.map { StartRows.lastName($0.player.name) })
    }

    /// trades.ts weekLine: "+10.1 Proj this week for your lineup, +2.5 for theirs", nil without a
    /// projection read.
    static func weekLine(_ row: TradeRow) -> String? {
        guard let mine = row.myProjChange, let theirs = row.theirProjChange else {
            return nil
        }
        return "\(week(mine)) \(Words.Trades.projForYou), \(week(theirs)) \(Words.Trades.forTheirs)"
    }

    /// trades.ts dropName: "Dart", "Williams, a starter".
    static func dropName(_ row: TradeRow) -> String {
        let name = row.drop.map { StartRows.lastName($0.value1.player.name) } ?? ""
        return row.dropReason == nil ? name : "\(name), \(Words.Trades.aStarter)"
    }

    /// trades.ts roomWords' yours: "You drop Dart", else "You have room".
    static func yourRoom(_ row: TradeRow) -> String {
        row.drop == nil ? Words.Trades.youHaveRoom : "You drop \(dropName(row))"
    }

    /// trades.ts phoneWith: "with Max_Jensen10, you drop Dart".
    static func phoneWith(team: String, row: TradeRow) -> String {
        let drop = row.drop == nil ? "" : ", you drop \(dropName(row))"
        return "with \(team)\(drop)"
    }

    /// trades.ts offerName: "Aaron Rodgers (QB PIT)".
    static func offerName(_ line: PlayerLine) -> String {
        let club = line.player.team.isEmpty ? "" : " \(line.player.team)"
        return "\(line.player.name) (\(line.player.position)\(club))"
    }

    /// trades.ts offerText, the share text the verb copies: "Trade with Max_Jensen10: Aaron Rodgers
    /// (QB PIT) for Cam Skattebo (RB NYG) and Pierre Strong (RB GB)."
    public static func offer(team: String, row: TradeRow) -> String {
        "Trade with \(team): \(list(row.give.map(offerName))) for \(list(row.get.map(offerName)))."
    }

    /// trades.ts proposeVerb: "Propose on Sleeper" where the platform takes a proposal from here,
    /// else "Open FFPC trades", which copies the offer and opens its page.
    static func verb(_ moves: Components.Schemas.TradeMoves, platform: String) -> String {
        moves.propose.value1 == .available ? "Propose on \(platform)" : "Open \(platform) trades"
    }

    /// TradeCopied's line: "Copied. Propose it on FFPC's trade page.", the page its link.
    public static func copied(_ done: Bool, platform: String) -> CopiedLine {
        CopiedLine(said: done ? Words.Trades.copied : Words.Trades.copyFailed, page: "\(platform)'s trade page")
    }

    /// trades.ts fromWords: "From McConkey Kong Country, you", "From Max_Jensen10".
    static func from(_ team: String, mine: Bool) -> String {
        mine ? "From \(team), you" : "From \(team)"
    }

    /// trades.ts weekHeadFor: "This week, Proj", "Week 7, Proj" on a turned page.
    static func weekHead(week: Int, forWeek: Int?) -> String {
        guard let forWeek, forWeek > week else {
            return Words.Trades.weekHead
        }
        return "Week \(forWeek), \(Words.Box.proj)"
    }

    /// words.ts noTradeWith: "No trade we found includes Josh Downs."
    static func noTradeWith(_ name: String) -> String {
        "No trade we found includes \(name)."
    }

    /// words.ts gainAmount: "2.1", "under 0.1" for a gain under what a page shows.
    static func gainAmount(_ gain: Double) -> String {
        gain > 0 && gain < 0.05 ? "under \(Formatting.fixed(0.1, 1))" : Formatting.fixed(gain, 1)
    }

    /// words.ts tradeDecision: "Trade Aaron Rodgers to Max_Jensen10 for Cam Skattebo and Pierre Strong,
    /// and drop Jaxson Dart to make room. Your lineup gains 5.7 points over replacement a week, theirs
    /// 0.7.", or that no trade we found helps both lineups.
    static func decision(_ best: (row: TradeRow, team: String)?) -> String {
        guard let (row, team) = best else {
            return "No trade we found helps both lineups."
        }
        let names = { (side: [PlayerLine]) in list(side.map(\.player.name)) }
        let drop = row.drop.map { ", and drop \($0.value1.player.name) to make room" } ?? ""
        return "Trade \(names(row.give)) to \(team) for \(names(row.get))\(drop). "
            + "Your lineup gains \(gainAmount(row.myGain)) points over replacement a week, "
            + "theirs \(gainAmount(row.theirGain))."
    }
}

/// The line under a pressed verb (TradeCopied.svelte): what happened, then where to propose it, the
/// page its link.
public struct CopiedLine: Equatable, Sendable {
    public let said: String
    public let page: String

    /// "Copied. Propose it on FFPC's trade page."
    public var words: String {
        "\(said) \(Words.Trades.proposeItOn) \(page)."
    }
}
