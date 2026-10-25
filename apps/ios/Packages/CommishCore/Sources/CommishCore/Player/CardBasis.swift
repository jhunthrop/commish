import CommishAPI
import CommishDesign
import Foundation

/// The card's basis lines once the week is read (web/src/lib/player/week-words.ts liveBasis), said
/// once each under the figures: what the week's figure is with what its change is measured from, then
/// what Opp rank, Avg and Last count, and while his game waits on its final, when it lands.
enum CardBasis {
    static func lines(_ week: PlayerWeek, league: Bool, now: Date, listed: Bool, read: RunWeekRead?) -> [String] {
        let scoring = week.projectionScoring
        let said = league ? "your scoring" : "\(ValueWords.format(scoring.format)) scoring"
        guard !listed else {
            return ["\(Words.Card.listedWeek) \(avgLast(said))"]
        }
        let proj = [projUnstamped(week, league: league), changePart(week, read: read)]
            .compactMap(\.self).joined(separator: " ")
        let evidence = "\(Words.Basis.oppPart) \(avgLast(said))"
        let facts = LineupBasis.kickedOffPart(lines: [week.line], now: now)
        return [proj, facts.map { "\(evidence) \($0)" } ?? evidence]
    }

    /// basis.ts projUnstampedPart over the card's week: "Wk 6 is this week's published projection, PPR
    /// nearest your rules." in a league (its tight end's extra after it), "... in PPR." with none. The
    /// card names no platform here, so a league's rules are "your league's".
    static func projUnstamped(_ week: PlayerWeek, league: Bool) -> String {
        let scoring = week.projectionScoring
        let format = ValueWords.format(scoring.format)
        let whose = league ? leagueScoring(scoring, format: format) : " in \(format)"
        let said = "\(CardTiles.weekHead(week.week)) is this week's published projection\(whose)."
        guard league, let bonus = scoring.teBonus else {
            return said
        }
        return "\(said) Your league adds \(Formatting.number(bonus)) a catch for TEs."
    }

    /// basis.ts leagueScoringWords with no platform named.
    static func leagueScoring(_ scoring: Components.Schemas.ProjectionScoring, format: String) -> String {
        if scoring.leagueOwn {
            return " on your rules"
        }
        return scoring.teBonus == nil
            ? ", \(format) nearest your rules"
            : ", \(format) shown, nearest your league's rules"
    }

    /// week-words.ts changePartOf: what the change is measured from, none on his bye.
    static func changePart(_ week: PlayerWeek, read: RunWeekRead?) -> String? {
        if week.line.facts.bye, week.afterBye?.value1 != nil {
            return nil
        }
        if CardTiles.moveOf(week, read: read).basis == .read {
            return Words.WeekTile.changePartRead
        }
        return week.projectionPreviousReadAt == nil ? nil : Words.WeekTile.changePart
    }

    /// basis.ts avgLastPart: "Avg and Last are his points a game and last game, PPR scoring."
    static func avgLast(_ scoring: String) -> String {
        "\(Words.Box.avg) and \(Words.Box.last) are his points a game and last game, \(scoring)."
    }
}
