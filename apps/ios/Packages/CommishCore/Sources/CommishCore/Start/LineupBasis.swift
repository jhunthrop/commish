import CommishAPI
import CommishDesign
import Foundation

/// The Lineup's basis as a phone says it once under the rows (basis.ts boxBasisParts on the Lineup,
/// drawnText for the phone): the rule our pick follows with what Proj is, the Proj final, the Game
/// cell, when Final and the stats land while a row waits on either, Our rank and Opp, Pts and the rules
/// our stats lack. A port, held to the web's paragraph at every clock by the parity file.
enum LineupBasis {
    struct Facts {
        let advice: LineupAdvice
        let host: Components.Schemas.LeagueHost
        /// Every line on the screen: each slot's player and the starter a change sits, the bench, the
        /// injured reserve.
        let lines: [PlayerLine]
        let totals: LineupTotals
        let zone: TimeZone
        let now: Date
        /// The platform's words: the league's own, or the store graphics' neutral one (Lane 310).
        var words: HostWords?

        var platform: String {
            (words ?? .of(host)).name
        }
    }

    static let pickPhone = "Our pick is each slot's highest \(Words.Box.proj),"
    static let finalLands = "\(Words.Box.final) lands the hour after a game"

    static func phone(_ facts: Facts) -> String {
        let advice = facts.advice
        let kicked = LineRead.anyKicked(facts.lines, now: facts.now)
        let projFinal = kicked && !facts.totals.allFinal
        let noFinal = facts.totals.live && facts.totals.final == nil
        let parts: [String?] = [
            pickProj(facts, kicked: kicked),
            BasisParts.projFinalPhone(started: projFinal, missing: noFinal),
            gamePart(lines: facts.lines, zone: facts.zone, now: facts.now),
            drawsFacts(facts) ? nil : finalsPhone(facts),
            Words.Basis.rankOppPhone,
            ptsPhone(advice.playerPoints, platform: facts.platform),
            uncounted(advice, lines: facts.lines),
        ]
        return parts.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// basis.ts pickProjPart: "Our pick is each slot's highest Proj, this week's published projection,
    /// PPR shown, nearest FFPC's rules, read Fri 9:00 pm, as of kickoff once started." and the tight
    /// end's extra after it.
    static func pickProj(_ facts: Facts, kicked: Bool) -> String {
        let advice = facts.advice
        let scoring = advice.projectionScoring
        let read = advice.projectionReadAt.map { "read \(Formatting.weekdayTime($0, zone: facts.zone))" }
            ?? "not in yet"
        let asOf = kicked ? ", \(Words.Basis.asOfKickoff)" : ""
        let said = "\(pickPhone) this week's published projection"
            + "\(BasisParts.scoringWords(scoring, host: facts.host)), \(read)\(asOf)."
        let bonus = BasisParts.teBonusSentence(scoring.teBonus, host: facts.host)
        return bonus.map { "\(said) \($0)" } ?? said
    }

    /// basis.ts gamePart 'full': the oldest read of any game still to be played.
    static func gamePart(lines: [PlayerLine], zone: TimeZone, now: Date) -> String? {
        let reads = lines.filter { LineRead.game($0, now: now).toPlay }.flatMap { line in
            [line.facts.gameTotal?.value1.readAt, line.facts.weather?.value1.readAt].compactMap(\.self)
        }
        return reads.min().map {
            "\(Words.Box.game) is each club's expected points, his first, and weather, read "
                + "\(Formatting.weekdayTime($0, zone: zone))."
        }
    }

    /// Whether a row still to be played draws its expected score or weather (basis.ts drawsFacts): the
    /// phone then keeps those cells' sentence and leaves when Final lands to the desk.
    static func drawsFacts(_ facts: Facts) -> Bool {
        facts.lines.contains { line in
            LineRead.game(line, now: facts.now).toPlay
                && (StartRows.expected(line.facts) != nil || StartRows.weather(line.facts) != nil)
        }
    }

    /// basis.ts finalsParts as the phone draws them: when Final and the stats land while a row waits,
    /// the platform's points named where a row counts them.
    static func finalsPhone(_ facts: Facts) -> String? {
        let timing = kickedOffPart(lines: facts.lines, now: facts.now)
        let counted = facts.lines.first { platformGame($0) != nil }
        guard let counted, let game = platformGame(counted) else {
            return timing
        }
        let platform = facts.platform
        let full = facts.lines.contains { LineRead.game($0, now: facts.now) == .kickedOff }
            ? "\(finalLands), \(Words.Box.avg) and \(Words.Box.last) then count \(platform)'s points, "
            + "our stats \(Words.Basis.statsByWednesday)"
            : "\(Words.Box.avg) and \(Words.Box.last) count \(weeksWord(game.week, counted.facts.week)) finals from "
            + "\(platform)'s points, our stats \(Words.Basis.statsByWednesday)"
        guard timing != nil else {
            return full
        }
        return "\(Words.Box.avg) and \(Words.Box.last) count \(platform)'s finals, "
            + "our stats \(Words.Basis.statsByWednesday)"
    }

    /// basis.ts kickedOffPartAt: when Final and the stats land, while a row is in play or final with
    /// the week's stats not in his games yet.
    static func kickedOffPart(lines: [PlayerLine], now: Date) -> String? {
        let waiting = lines.contains { line in
            let read = LineRead.game(line, now: now)
            let ours = line.facts.lastGames.contains { $0.week == line.facts.week && !fromPlatform($0) }
            return read == .kickedOff || (read == .final && !ours)
        }
        return waiting ? Words.Basis.kickedOffPart : nil
    }

    static func platformGame(_ line: PlayerLine) -> Components.Schemas.GamePoints? {
        line.facts.lastGames.first(where: fromPlatform)
    }

    static func fromPlatform(_ game: Components.Schemas.GamePoints) -> Bool {
        game.source?.value1?.rawValue == "platform"
    }

    /// basis.ts weeksWord: "this week's", or "week 7's" on a page turned past the platform's week.
    static func weeksWord(_ week: Int, _ platformWeek: Int) -> String {
        week == platformWeek ? "this week's" : "week \(week)'s"
    }

    /// basis.ts ptsPhonePart.
    static func ptsPhone(_ byPlayer: Bool, platform: String) -> String {
        byPlayer
            ? "\(Words.Box.pts) are \(platform)'s points so far."
            : "\(Words.Box.pts) are \(platform)'s team points alone."
    }

    /// basis.ts uncountedPart over the lineup's answer.
    static func uncounted(_ advice: LineupAdvice, lines: [PlayerLine]) -> String? {
        BasisParts.uncounted(note: advice.basisNote, list: advice.basisNoteList, lines: lines)
    }
}
