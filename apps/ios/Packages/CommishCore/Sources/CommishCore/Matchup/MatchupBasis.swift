import CommishAPI
import CommishDesign
import Foundation

/// The Matchup's basis as a phone says it once under the boxes (basis.ts boxBasisParts with no
/// Lineup, drawnText for the phone): what Proj is, the Proj final, a Final of "--", the opponent's best
/// lineup, Our rank, Pts and Team, the Game cell, and when Final and the stats land while a row waits.
/// A port, held to the web's paragraph at every clock by the parity file.
enum MatchupBasis {
    struct Facts {
        let host: Components.Schemas.LeagueHost
        /// The box's projection read and scoring, nil with no box answer.
        let projection: (readAt: Date?, scoring: Components.Schemas.ProjectionScoring)?
        /// Every line both boxes draw.
        let lines: [PlayerLine]
        let byPlayer: Bool
        let teamTotal: Bool
        /// The game has kicked off by the starters' lines.
        let kicked: Bool
        let noFinal: Bool
        let allFinal: Bool
        let finalNone: Bool
        let unlisted: UnlistedDrawn
        let zone: TimeZone
        let now: Date
        /// The platform's words: the league's own, or the store graphics' neutral one (Lane 310).
        var words: HostWords?
    }

    static func phone(_ facts: Facts) -> String {
        let platform = (facts.words ?? .of(facts.host)).name
        // While the opponent's best-lineup words run long, the phone leaves the Proj's read time and when
        // Final lands to the desk (basis.ts unlistedLong).
        let long = facts.unlisted.long
        let projFinal = facts.kicked && !facts.allFinal
        let parts: [String?] = [
            facts.projection.map { proj(readAt: $0.readAt, scoring: $0.scoring, facts: facts, crowded: long) },
            facts.projection.flatMap { BasisParts.teBonusSentence($0.scoring.teBonus, host: facts.host) },
            projFinalWords(projFinal, missing: facts.noFinal),
            facts.finalNone ? BasisParts.finalNonePart(platform) : nil,
            BasisParts.unlistedPart(platform, drawn: facts.unlisted, form: .full),
            Words.Basis.rankPart,
            pts(facts.byPlayer, platform: platform, team: facts.teamTotal),
            LineupBasis.gamePart(lines: facts.lines, zone: facts.zone, now: facts.now),
            long ? nil : finalsPhone(facts.lines, now: facts.now, platform: platform),
        ]
        return parts.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// basis.ts projMatchupParts as the phone draws them: "Proj is this week's published projection,
    /// PPR shown, nearest FFPC's rules, read Fri 9:00 pm.", the defenses' scoring and a started game's
    /// Proj left to the desk, and on a crowded phone its read time too.
    static func proj(
        readAt: Date?, scoring: Components.Schemas.ProjectionScoring, facts: Facts, crowded: Bool
    ) -> String {
        let read = readAt.map { "read \(Formatting.weekdayTime($0, zone: facts.zone))" } ?? "not in yet"
        let when = crowded ? "" : ", \(read)"
        return "\(Words.Box.proj) is this week's published projection"
            + "\(BasisParts.scoringWords(scoring, host: facts.host))\(when)."
    }

    /// basis.ts projFinalWords: what Proj final is once a game has kicked off, and why one is "--".
    static func projFinalWords(_ started: Bool, missing: Bool) -> String? {
        guard started else {
            return nil
        }
        return missing ? "\(Words.Basis.projFinalPart) \(Words.Basis.noProjFinalPart)" : Words.Basis.projFinalPart
    }

    /// basis.ts ptsPart: the platform's points by player and what Team is, or its team points alone.
    static func pts(_ byPlayer: Bool, platform: String, team: Bool) -> String {
        guard byPlayer else {
            return "\(Words.Box.pts) are \(platform)'s team points, none by player."
        }
        return team
            ? "\(Words.Box.pts) are \(platform)'s points by player so far, each to a tenth, "
            + "and Team is \(platform)'s score."
            : "\(Words.Box.pts) are \(platform)'s points so far, Team adds the rows."
    }

    /// basis.ts finalsParts on a phone: when Final and the stats land while a row waits on either, and
    /// where a row counts the platform's points for a final, the phone's short sentence of what Avg and
    /// Last count meanwhile.
    static func finalsPhone(_ lines: [PlayerLine], now: Date, platform: String) -> String? {
        let timing = LineupBasis.kickedOffPart(lines: lines, now: now)
        let counted = lines.first { LineupBasis.platformGame($0) != nil }
        guard let counted, let game = LineupBasis.platformGame(counted) else {
            return timing
        }
        guard timing != nil else {
            return lines.contains { LineRead.game($0, now: now) == .kickedOff }
                ? "\(LineupBasis.finalLands), \(Words.Box.avg) and \(Words.Box.last) then count \(platform)'s points, "
                + "our stats \(Words.Basis.statsByWednesday)"
                : "\(Words.Box.avg) and \(Words.Box.last) count "
                + "\(LineupBasis.weeksWord(game.week, counted.facts.week)) finals from \(platform)'s points, "
                + "our stats \(Words.Basis.statsByWednesday)"
        }
        return "\(Words.Box.avg) and \(Words.Box.last) count \(platform)'s finals, "
            + "our stats \(Words.Basis.statsByWednesday)"
    }
}
