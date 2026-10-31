import CommishAPI
import CommishDesign
import Foundation

/// The strip's figure (lineup.ts StripSum): "98.9" over "Proj with them, 74.7 as set on FFPC" and
/// its gain, or once every starter has kicked off the points so far with the projected final beside.
public struct StripSum: Equatable, Sendable {
    public let figure: String
    public let words: String
    public let gain: String?
    public let final: String?
}

/// The words the Start screen builds from data, each the same-named function of the web's
/// (lineup.ts, move.ts, words.ts), held to its output by shared/fixtures/parity/lineup.json.
public enum StartWords {
    static let numberWords = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]

    /// box.ts boxNumber: one decimal as the API rounded it, "--" when not held.
    public static func number(_ value: Double?) -> String {
        guard let value else {
            return Words.Box.none
        }
        let text = Formatting.number(value)
        return text.contains(".") ? text : "\(text).0"
    }

    /// box.ts deltaWord: "+0.4", "−0.3", "0.0", "--".
    public static func delta(_ value: Double?) -> String {
        guard let value else {
            return Words.Box.none
        }
        if value == 0 {
            return Formatting.fixed(0, 1)
        }
        let magnitude = Formatting.fixed(abs(value), 1)
        return value < 0 && Double(magnitude) != 0 ? "\u{2212}\(magnitude)" : "+\(magnitude)"
    }

    /// lineup.ts changesTitle: "Three changes", "One change", "Your lineup is set"; "Locked" while the
    /// matchup still plays once every starter has kicked off, "Final" once it is.
    public static func changesTitle(_ count: Int, done: String?, state: Components.Schemas.WeekDoneState?) -> String {
        if done != nil {
            return state?.value1 == .locked ? Words.Box.locked : Words.Box.final
        }
        if count == 0 {
            return Words.Lineup.set
        }
        return changeCount(count)
    }

    /// words.ts changeCount: "Three changes", "One change", "12 changes".
    static func changeCount(_ count: Int) -> String {
        let word = count < numberWords.count ? numberWords[count] : String(count)
        return "\(word) \(count == 1 ? "change" : "changes")"
    }

    /// lineup.ts asSetWords: "as set on ESPN", the platform placed by its own words (Lane 310).
    static func asSet(_ place: HostWords) -> String {
        "as set \(place.placed)"
    }

    /// lineup.ts lineupSum: the strip's figure with the platform named.
    static func lineupSum(_ box: LineupBox, host: HostWords, done: String?) -> StripSum? {
        guard done != nil else {
            guard let proj = box.totals.proj else {
                return nil
            }
            let words = asSet(host)
            if box.swaps.isEmpty {
                return StripSum(figure: number(proj), words: "\(Words.Box.proj) \(words)", gain: nil, final: nil)
            }
            let set = box.asSet.map { ", \(number($0)) \(words)" } ?? ""
            let gain = box.gain.flatMap { $0 > 0 ? "+\(Formatting.fixed($0, 1))" : nil }
            return StripSum(figure: number(proj), words: "\(Words.Box.proj) with them\(set)", gain: gain, final: nil)
        }
        guard let pts = box.totals.pts else {
            return nil
        }
        let final = box.playing ? box.totals.final.map { "\(Words.Box.projFinal) \(number($0))" } : nil
        return StripSum(figure: number(pts), words: "\(Words.Box.pts) \(asSet(host))", gain: nil, final: final)
    }

    /// lineup.ts swapWords: "QB, Mahomes in, Rodgers out".
    public static func swap(_ swap: Swap) -> String {
        let into = "\(swap.slot), \(swap.into) \(Words.Lineup.swapIn)"
        return swap.out.map { "\(into), \($0) \(Words.Lineup.swapOut)" } ?? into
    }

    /// lineup.ts idleWords: "TE: no one on your roster can play this week".
    static func idle(_ slot: String) -> String {
        "\(slot): \(Words.Lineup.noOneCanPlay)"
    }

    /// lineup.ts heldWords: "QB: Dart has kicked off, the spot stays empty".
    static func held(_ spot: HeldSpot) -> String {
        "\(LineupBoxes.slotWord(spot.slot)): \(spot.name) \(Words.Lineup.heldEmpty)"
    }

    /// lineup.ts lineupText: the week, then a slot and a name a line.
    static func lineupText(_ box: LineupBox, week: Int) -> String {
        (["Week \(week) lineup"] + box.starters.map { "\($0.row.slot) \($0.row.name)" }).joined(separator: "\n")
    }

    /// lineup.ts lineupPageWords: "FFPC's lineup page".
    static func lineupPage(_ platform: String) -> String {
        "\(platform)'s lineup page"
    }

    /// lineup.ts setOnWords: "Lineup set on ESPN".
    static func setOn(_ platform: String) -> String {
        "Lineup set on \(platform)"
    }

    /// box.ts teamSmallFigure: nothing before kickoff, then the projected final, then the final total.
    static func teamSmall(_ totals: LineupTotals) -> (caption: String, figure: Double?)? {
        guard totals.live else {
            return nil
        }
        return totals.allFinal ? (Words.Box.final, totals.pts) : (Words.Box.projFinal, totals.final)
    }

    // MARK: the move (move.ts, words.ts)

    /// words.ts verbWords('start'): "Set it on ESPN".
    static func setItOn(_ platform: String) -> String {
        "Set it on \(platform)"
    }

    /// move.ts readingWords: "Reading your lineup on ESPN".
    static func reading(_ platform: String) -> String {
        "Reading your lineup on \(platform)"
    }

    /// move.ts settingWords: "Setting it on ESPN".
    static func setting(_ platform: String) -> String {
        "Setting it on \(platform)"
    }

    /// move.ts openHostWords: "Open ESPN".
    static func open(_ platform: String) -> String {
        "Open \(platform)"
    }

    /// move.ts lostWords for a lineup: the move may have left, so check the platform.
    static func lost(_ platform: String) -> String {
        "We did not hear back, so the move may have been made. "
            + "Check your lineup on \(platform) before you set it again."
    }

    /// move.ts hostSaid: "ESPN said: Lineup transaction could not be completed."
    static func hostSaid(_ platform: String, _ words: String) -> String {
        let said = words.trimmingCharacters(in: .whitespacesAndNewlines)
        let stop = said.last.map { ".!?".contains($0) } == true ? "" : "."
        return "\(platform) said: \(said)\(stop)"
    }
}
