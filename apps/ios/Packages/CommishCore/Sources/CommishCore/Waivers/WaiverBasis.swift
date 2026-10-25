import CommishAPI
import CommishDesign
import Foundation

/// The Waivers basis as a phone says it once under the table (waivers.ts waiverBasis, drawnText for the
/// phone): the API's pickup rule, its Gain sentence without the A game head the line under the heads
/// says, what Proj is (none before the week's projection is read), when Final and the stats land or
/// what free agents' Avg and Last are, Opp, and the rules our stats lack. A port, held to the web's
/// paragraph at every clock by the parity file.
enum WaiverBasis {
    static func phone(_ advice: WaiverAdvice, zone: TimeZone, now: Date) -> String {
        let lines = advice.rows.map(\.add) + advice.roster
        let arrives = WaiverWords.arrives(advice, zone: zone)
        let parts: [String?] = [
            advice.basis,
            seasonWords(advice.seasonBasis),
            arrives == nil ? proj(advice, lines: lines, zone: zone, now: now) : nil,
            finals(lines, now: now),
            Words.Basis.oppPhone,
            BasisParts.uncounted(note: advice.basisNote, list: advice.basisNoteList, lines: lines),
        ]
        return parts.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// waivers.ts seasonBasisWords: the API's season basis without its sentence for the A game head.
    static func seasonWords(_ basis: String) -> String {
        let head = "\(Words.Waivers.rest) is "
        let sentences = basis.replacingOccurrences(of: #"(?<=\.)\s+"#, with: "\n", options: .regularExpression)
            .split(separator: "\n").map(String.init)
        return sentences.filter { !$0.hasPrefix(head) }.joined(separator: " ")
    }

    /// basis.ts projPhonePart on a league's rows: "Proj is this week's published projection, PPR nearest
    /// your rules, read Fri 9:00 pm, as of kickoff once started.", "week 7's" on a page turned to week 7,
    /// with no platform named (waiverBasis names none), and the tight end's extra after it.
    static func proj(_ advice: WaiverAdvice, lines: [PlayerLine], zone: TimeZone, now: Date) -> String {
        let scoring = advice.projectionScoring
        let week = LineupBasis.weeksWord(advice.forWeek ?? advice.week, advice.week)
        let read = advice.projectionReadAt.map { "read \(Formatting.weekdayTime($0, zone: zone))" } ?? "not in yet"
        let asOf = LineRead.anyKicked(lines, now: now) ? ", \(Words.Basis.asOfKickoff)" : ""
        let said = "\(Words.Box.proj) is \(week) published projection"
            + "\(BasisParts.scoringWords(scoring, host: nil)), \(read)\(asOf)."
        return BasisParts.teBonusSentence(scoring.teBonus, host: nil).map { "\(said) \($0)" } ?? said
    }

    /// basis.ts waiverFinalsParts: once a row counts the platform's points, the free agents' own state;
    /// else when Final and the stats land.
    static func finals(_ lines: [PlayerLine], now: Date) -> String? {
        guard let game = lines.lazy.compactMap(LineupBasis.platformGame).first else {
            return LineupBasis.kickedOffPart(lines: lines, now: now)
        }
        return "Free agents' \(Words.Box.avg) and \(Words.Box.last) are our stats, "
            + "week \(game.week)'s \(Words.Basis.statsByWednesday)"
    }
}
