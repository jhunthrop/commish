import CommishAPI
import CommishDesign
import Foundation

/// The basis sentences' shared parts (web/src/lib/league/box/basis.ts and league/names.ts), one port
/// for every screen's basis: the League home's and the Lineup's.
enum BasisParts {
    /// basis.ts leagueScoringWords: " on your rules", ", PPR nearest your rules", or for a league whose
    /// rules add a tight end's extra ", PPR shown, nearest FFPC's rules".
    static func scoringWords(
        _ scoring: Components.Schemas.ProjectionScoring,
        host: Components.Schemas.LeagueHost
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
    static func teBonusSentence(_ bonus: Double?, host: Components.Schemas.LeagueHost) -> String? {
        let owner = sentenceStart(rulesOwner(host))
        return bonus.map { "\(owner) adds \(Formatting.number($0)) a catch for TEs." }
    }

    /// names.ts rulesOwner: FFPC fixes its own rules; on any other platform the league's commissioner does.
    static func rulesOwner(_ host: Components.Schemas.LeagueHost) -> String {
        host.value1 == .ffpc ? ValueWords.platform(host) : "your league"
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
}
