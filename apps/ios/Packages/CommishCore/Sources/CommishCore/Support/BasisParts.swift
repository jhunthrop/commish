import CommishAPI
import CommishDesign
import Foundation

/// The basis sentences' shared parts (web/src/lib/league/box/basis.ts and league/names.ts), one port
/// for every screen's basis: the League home's, the Lineup's and the Matchup's.
enum BasisParts {
    /// basis.ts leagueScoringWords: " on your rules", ", PPR nearest your rules", or for a league whose
    /// rules add a tight end's extra ", PPR shown, nearest FFPC's rules".
    static func scoringWords(
        _ scoring: Components.Schemas.ProjectionScoring,
        host: Components.Schemas.LeagueHost?
    ) -> String {
        let format = ValueWords.format(scoring.format)
        if scoring.leagueOwn {
            return " on your rules"
        }
        guard scoring.teBonus != nil else {
            return ", \(format) nearest your rules"
        }
        return ", \(format) shown, nearest \(rulesOwner(host))'s rules"
    }

    /// basis.ts teBonusSentence: "FFPC adds 0.5 a catch for TEs.", nil without one.
    static func teBonusSentence(_ bonus: Double?, host: Components.Schemas.LeagueHost?) -> String? {
        let owner = sentenceStart(rulesOwner(host))
        return bonus.map { "\(owner) adds \(Formatting.number($0)) a catch for TEs." }
    }

    /// names.ts rulesOwner: FFPC fixes its own rules; on any other platform, or with none named, the
    /// league's commissioner does.
    static func rulesOwner(_ host: Components.Schemas.LeagueHost?) -> String {
        guard let host, host.value1 == .ffpc else {
            return "your league"
        }
        return ValueWords.platform(host)
    }

    static func sentenceStart(_ words: String) -> String {
        words.prefix(1).uppercased() + words.dropFirst()
    }

    /// basis.ts projFinalPhone: why the Proj final is "--" where it is, else what it adds; nothing
    /// before kickoff.
    static func projFinalPhone(started: Bool, missing: Bool) -> String {
        guard started else {
            return ""
        }
        return missing ? Words.Basis.noProjFinalPart : Words.Basis.projFinalPart
    }

    /// basis.ts finalNonePart: why a side's Final reads "--".
    static func finalNonePart(_ platform: String) -> String {
        "A \(Words.Box.final) of \(Words.Box.none) is a score \(platform) does not send us."
    }

    /// basis.ts unlistedPart: what the teams a platform sends no lineup for draw, said once.
    static func unlistedPart(_ platform: String, drawn: UnlistedDrawn, form: UnlistedForm) -> String {
        let box = Words.Box.self
        let from = drawn.skipped ? Words.BestLineupFrom.projected : Words.BestLineupFrom.rosters
        let paceWords = form == .full ? Words.Basis.paceClause : Words.Basis.paceClauseShort
        let pace = drawn.paced ? ", \(paceWords)" : ""
        if form == .one, drawn.bestLineup, drawn.noRoster {
            return "Teams \(platform) sends no lineup for show our best lineup from \(from)\(pace), "
                + "or \(box.none) with none."
        }
        let best = drawn.bestLineup
            ? "\(box.proj) for teams \(platform) sends no lineup for is our best lineup from \(from)\(pace)." : ""
        let none = drawn.noRoster ? "Teams \(platform) sends no lineup or roster for show \(box.none)." : ""
        return [best, none].filter { !$0.isEmpty }.joined(separator: " ")
    }
}
