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
    /// The word between an idea's sides: "Rodgers for Waddle and Strong".
    static let forWord = "for"

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

    /// builder.ts fillsWords: the slot a trade fills (Lane 287) as its card names it, "Fills your WR",
    /// "Fills your flex"; nil for none, an older answer, or a slot this app does not know.
    static func fills(_ fills: Components.Schemas.TradeRow.FillsPayload?) -> String? {
        guard let slot = fills?.value1 else {
            return nil
        }
        let words = switch slot {
        case .flex: Words.Trades.flexSlot
        case .superflex: Words.Trades.superflexSlot
        case .qb, .rb, .wr, .te: slot.rawValue
        }
        return "\(Words.Trades.fillsYour) \(words)"
    }

    /// trades.ts shortSide: a side by last names, "Skattebo and Strong".
    static func shortSide(_ side: [PlayerLine]) -> String {
        list(side.map { StartRows.lastName($0.player.name) })
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

    /// words.ts gainAmount: "2.1", "under 0.1" for a gain under what a page shows.
    static func gainAmount(_ gain: Double) -> String {
        gain > 0 && gain < 0.05 ? "under \(Formatting.fixed(0.1, 1))" : Formatting.fixed(gain, 1)
    }

    /// builder.ts shareText, the trade as Share copies it in our words: the offer, then each lineup's
    /// change and the drop.
    static func share(team: String, row: TradeRow) -> String {
        let drop = row.drop.map { " You drop \($0.value1.player.name) to make room." } ?? ""
        return "\(offer(team: team, row: row)) \(TradeChecks.change(row))\(drop)"
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
