import CommishAPI
import CommishDesign
import Foundation

/// The Trades' basis as a phone says it once under the rows (trades.ts tradeBasis, drawnText for the
/// phone): which trades are listed and who decides, what a game is while a trade is opened, what Proj
/// is or the day it arrives, when Final and the stats land, what Opp is while a trade is opened, and
/// the rules our stats lack; the record's link follows it. A port, held to the web's paragraph at every
/// clock by the parity file.
enum TradesBasis {
    /// basis.ts DEFENSES_CLAUSE: the Proj sentence's clause where a defense is drawn.
    static let defensesClause = ", defenses on default scoring"

    struct Facts {
        let advice: TradeAdvice
        let host: Components.Schemas.LeagueHost
        /// Every line the finder and its opened trades can show (TradeScreen's lines).
        let lines: [PlayerLine]
        /// What is open: a trade's players' columns, or the builder's rosters, are on the screen.
        let opened: TradesOpened
        let zone: TimeZone
        let now: Date
    }

    static func phone(_ facts: Facts) -> String {
        let advice = facts.advice
        let open = facts.opened != .none
        let parts: [String?] = [
            advice.basis,
            // What the verdict's rest-of-season cells are, with the builder open (Lane 277).
            facts.opened == .builder ? Words.Trades.restBasis : nil,
            open ? advice.perGameBasis : nil,
            arrives(facts) ?? proj(facts),
            finals(facts),
            // The builder's phone rows draw no Opp rank (TradeBox), so its sentence is the desk's there.
            facts.opened == .trade ? Words.Basis.oppPhone : nil,
            open
                ? BasisParts.uncounted(note: advice.basisNote, list: advice.basisNoteList, lines: facts.lines) : nil,
        ]
        return parts.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// next-week.ts arrivesPart: "Week 7 projections expected Thursday.", before the week's projection
    /// is read.
    static func arrives(_ facts: Facts) -> String? {
        let advice = facts.advice
        guard advice.projectionReadAt == nil, let arrives = advice.projectionArrivesAt else {
            return nil
        }
        let week = advice.forWeek ?? advice.week
        return "Week \(week) projections expected \(Formatting.weekdayName(arrives, zone: facts.zone))."
    }

    /// basis.ts projPart as the trades say it (no platform named, so the rules' owner is the league's):
    /// "Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm."
    static func proj(_ facts: Facts) -> String {
        let advice = facts.advice
        let scoring = advice.projectionScoring
        let addressed = advice.forWeek ?? advice.week
        let week = LineupBasis.weeksWord(addressed, advice.week)
        let read = advice.projectionReadAt.map { "read \(Formatting.weekdayTime($0, zone: facts.zone))" }
            ?? "not in yet"
        // The builder's boxes draw a defense; a trade never holds one (Lane 66g).
        let defense = facts.opened == .builder && facts.lines.contains { $0.player.position == "DEF" }
            ? defensesClause : ""
        let said = "\(Words.Box.proj) is \(week) published projection"
            + "\(BasisParts.scoringWords(scoring, host: nil))\(defense), \(read)."
        return BasisParts.teBonusSentence(scoring.teBonus, host: nil).map { "\(said) \($0)" } ?? said
    }

    /// basis.ts finalsParts on a phone over the trades' rows: the one sentence where nothing waits on
    /// Final, else the phone's short sentence of what Avg and Last count; with a trade opened, when Final
    /// lands is left to the desk.
    static func finals(_ facts: Facts) -> String? {
        let timing = LineupBasis.kickedOffPart(lines: facts.lines, now: facts.now)
        guard let full = finalsAt(facts) else {
            return nil
        }
        guard timing != nil, full != timing else {
            return facts.opened != .none && full == Words.Basis.kickedOffPart ? nil : full
        }
        return "\(Words.Box.avg) and \(Words.Box.last) count \(ValueWords.platform(facts.host))'s finals, "
            + "our stats \(Words.Basis.statsByWednesday)"
    }

    /// basis.ts finalsPartAt over the league's rosters.
    static func finalsAt(_ facts: Facts) -> String? {
        let lines = facts.lines
        guard let counted = lines.first(where: { LineupBasis.platformGame($0) != nil }),
              let game = LineupBasis.platformGame(counted)
        else {
            return LineupBasis.kickedOffPart(lines: lines, now: facts.now)
        }
        let platform = ValueWords.platform(facts.host)
        if lines.contains(where: { LineRead.game($0, now: facts.now) == .kickedOff }) {
            return "\(LineupBasis.finalLands), \(Words.Box.avg) and \(Words.Box.last) then count \(platform)'s points, "
                + "our stats \(Words.Basis.statsByWednesday)"
        }
        return "\(Words.Box.avg) and \(Words.Box.last) count \(LineupBasis.weeksWord(game.week, counted.facts.week)) "
            + "finals from \(platform)'s points, our stats \(Words.Basis.statsByWednesday)"
    }
}
