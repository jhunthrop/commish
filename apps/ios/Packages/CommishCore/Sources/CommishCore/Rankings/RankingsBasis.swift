import CommishAPI
import CommishDesign
import Foundation

/// The Rankings' bases as a phone says them with no league (order.ts orderBasis and week.ts weekBasis,
/// drawnText for the phone), ported and held to the web's paragraphs by the parity file.
enum RankingsBasis {
    /// orderBasis with no league: the API's basis, the week cell and what its Proj is, Opp rank under
    /// the strip's own head, and when Final and the stats land while a row waits on either.
    static func order(_ advice: OrderAdvice, zone: TimeZone, now: Date) -> String {
        let lines = advice.rows.map(\.line)
        let week = "\(RankingsWords.weekHead(advice.week)) is \(Words.Box.pts) once final, "
            + "\(Words.Box.none) until his stats land, \(Words.Box.proj) before."
        let projected = proj(
            advice.projectionReadAt, scoring: advice.projectionScoring, lines: lines, zone: zone, now: now
        )
        let parts: [String?] = [
            advice.basis,
            "\(week) \(projected)",
            Words.Basis.oppPart,
            LineupBasis.kickedOffPart(lines: lines, now: now),
        ]
        return parts.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// basis.ts projPart for a reader with no league: "Proj is this week's published projection in PPR,
    /// read Fri 9:00 pm Central, as of kickoff once started."
    static func proj(
        _ readAt: Date?, scoring: Components.Schemas.ProjectionScoring, lines: [PlayerLine], zone: TimeZone, now: Date
    ) -> String {
        let read = readAt.map { "read \(stamp($0, zone: zone))" } ?? "not in yet"
        let kicked = LineRead.anyKicked(lines, now: now) ? ", \(Words.Basis.asOfKickoff)" : ""
        return "\(Words.Box.proj) is this week's published projection in \(ValueWords.format(scoring.format)), "
            + "\(read)\(kicked)."
    }

    /// basis.ts stamp with the zone said: "Fri 9:00 pm Central".
    static func stamp(_ date: Date, zone: TimeZone) -> String {
        "\(Formatting.weekdayTime(date, zone: zone)) \(Formatting.zoneWord(zone))"
    }

    /// weekBasis with no league, the phone's parts: the order with the model we lack, Opp rank, Avg and
    /// Last in the scoring the rows are in, and the Game cell's read.
    static func week(
        _ advice: WeekOrderAdvice, position: WeekOrderPosition, boardScoring: String, zone: TimeZone, now: Date
    ) -> String {
        let many = RankingsWords.many(position)
        let whose = position == .k ? "his" : "its"
        let scoring = position == .def ? Words.DefenseScoring.standard : "in \(boardScoring)"
        let parts: [String?] = [
            orderSentence(advice, position: position, boardScoring: boardScoring, zone: zone),
            "\(Words.Box.oppRank) is points allowed to \(many) this season, 1st the fewest.",
            "\(Words.Box.avg) and \(Words.Box.last) are \(whose) points a game and last game, \(scoring).",
            gameSentence(advice, position: position, zone: zone, now: now),
        ]
        return parts.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// week.ts orderSentence for a reader with no league.
    static func orderSentence(
        _ advice: WeekOrderAdvice, position: WeekOrderPosition, boardScoring: String, zone: TimeZone
    ) -> String {
        let many = RankingsWords.many(position)
        let capital = many.prefix(1).uppercased() + many.dropFirst()
        guard RankingsWords.landed(advice) else {
            return "\(capital) are in order of \(Words.Box.avg) until this week's published projection is in."
        }
        let how = position == .def ? Words.DefenseScoring.standard : "in \(boardScoring) scoring"
        let when = advice.projectionReadAt.map { ", read \(stamp($0, zone: zone))" } ?? ""
        return "\(capital) are in order of \(Words.Box.proj), this week's published projection \(how)\(when), "
            + "as we have no \(RankingsWords.one(position)) model of our own."
    }

    /// week.ts gameSentence: the Game cell's read, or that its figures come later; none with no game
    /// to play.
    static func gameSentence(
        _ advice: WeekOrderAdvice, position: WeekOrderPosition, zone: TimeZone, now: Date
    ) -> String? {
        guard advice.rows.contains(where: { RankingsRows.section($0, now: now) == .toPlay }) else {
            return nil
        }
        let reads = advice.rows.map(\.line).filter { LineRead.game($0, now: now).toPlay }.flatMap { line in
            [line.facts.gameTotal?.value1.readAt, line.facts.weather?.value1.readAt].compactMap(\.self)
        }
        guard let read = reads.min() else {
            return "The \(Words.Box.game) cell shows the opponent and kickoff. "
                + "Expected points and weather come later in the week."
        }
        let first = position == .k ? "his first" : "the defense's first"
        return "\(Words.Box.game) is each club's expected points, \(first), and the kickoff weather, "
            + "read \(stamp(read, zone: zone))."
    }

    /// week.ts rulesLeftOut: the rules Avg and Last leave out, in the frame every league screen says them.
    static func rules(_ advice: WeekOrderAdvice) -> String? {
        let said = BasisParts.uncounted(
            note: advice.basisNote, list: advice.basisNoteList, lines: advice.rows.map(\.line)
        )
        return said?.isEmpty == true ? nil : said
    }
}
