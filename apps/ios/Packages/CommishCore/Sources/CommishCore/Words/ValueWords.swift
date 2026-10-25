import CommishAPI
import CommishDesign

/// An API value in the web's words: a value this build knows reads its generated word (Words, from the
/// web's tables by shared/scripts/gen-words.ts), one it does not know reads the API's own word, never a
/// crash and never a code. The web indexes its tables by the value; these are those lookups.
public enum ValueWords {
    /// An API value this build does not know (an enum opened by apps/ios/scripts/gen-openapi.ts): its
    /// own word, underscores read as spaces, first letter capital ("fleaflicker" is "Fleaflicker").
    /// Nil when the API sent nothing readable.
    public static func unknown(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else {
            return nil
        }
        let words = raw.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    /// names.ts hostWords (HOST_WORDS[host]): the platform named, never "host".
    public static func platform(_ host: Components.Schemas.LeagueHost) -> String {
        switch host.value1 {
        case .sleeper: Words.Platform.sleeper
        case .mfl: Words.Platform.mfl
        case .ffpc: Words.Platform.ffpc
        case .yahoo: Words.Platform.yahoo
        case .espn: Words.Platform.espn
        case nil: unknown(host.value2) ?? AppWords.unknownPlatform
        }
    }

    /// names.ts SCORING_WORDS[preset]: "PPR", "half PPR", "standard", "TE premium".
    public static func scoring(_ preset: Components.Schemas.ScoringPresetKnown) -> String {
        switch preset {
        case .ppr: Words.Scoring.ppr
        case .halfPpr: Words.Scoring.half_ppr
        case .standard: Words.Scoring.standard
        case .tePremium: Words.Scoring.te_premium
        }
    }

    /// home.ts TIEBREAK_WORDS[rule]; nil for a rule this build does not know, said as no rule stated.
    public static func tiebreak(_ rule: Components.Schemas.Tiebreak) -> String? {
        switch rule.value1 {
        case .headToHead: Words.Tiebreak.head_to_head
        case .pointsFor: Words.Tiebreak.points_for
        case .pointsAgainst: Words.Tiebreak.points_against
        case .divisionRecord: Words.Tiebreak.division_record
        case nil: nil
        }
    }

    /// home.ts WAIVER_ORDER_WORDS[order]; nil for an order this build does not know.
    public static func waiverOrder(_ order: Components.Schemas.WaiverOrder) -> String? {
        switch order.value1 {
        case .rolling: Words.WaiverOrder.rolling
        case .inverseStandings: Words.WaiverOrder.inverse_standings
        case nil: nil
        }
    }

    /// box.ts FORMAT_WORDS[format]; a format this build does not know by the API's own word.
    public static func format(_ format: Components.Schemas.ProjectionScoring.FormatPayload) -> String {
        switch format.value1 {
        case .ppr: Words.BoxFormat.ppr
        case .halfPpr: Words.BoxFormat.half_ppr
        case .standard: Words.BoxFormat.standard
        case nil: format.value2 ?? Words.Box.none
        }
    }
}
