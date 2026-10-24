import CommishAPI

/// The web's words the shared generator does not carry yet, ported by hand from the web's tables, each
/// beside its source so a change there is found here. Held to the web by the parity file
/// (shared/fixtures/parity), whose sentences these build: a word that drifts fails a Core test.
public enum PortedWords {
    /// web/src/lib/league/box/box.ts BOX and web/src/lib/format/game-facts.ts GAME_STATE_WORDS.
    public enum Box {
        public static let proj = "Proj"
        public static let pts = "Pts"
        public static let player = "Player"
        public static let projFinal = "Proj final"
        public static let final = "Final"
        public static let kickedOff = "Kicked off"
        /// The sums row: "Team", never the betting word for it.
        public static let totals = "Team"
        public static let bench = "Bench"
        public static let reserve = "Injured reserve"
        /// A number not held yet (web/src/lib/format/empty.ts).
        public static let none = "--"
    }

    /// An API value this build does not know (an enum opened by apps/ios/scripts/gen-openapi.ts): its
    /// own word, underscores read as spaces, first letter capital ("fleaflicker" is "Fleaflicker"),
    /// never a crash and never a code. Nil when the API sent nothing readable.
    public static func unknown(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else {
            return nil
        }
        let words = raw.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    /// web/src/lib/league/names.ts HOST_WORDS: the platform named, never "host"; a platform this build
    /// does not know by the API's own name for it.
    public static func platform(_ host: Components.Schemas.LeagueHost) -> String {
        switch host.value1 {
        case .sleeper: "Sleeper"
        case .mfl: "MyFantasyLeague"
        case .ffpc: "FFPC"
        case .yahoo: "Yahoo"
        case .espn: "ESPN"
        case nil: unknown(host.value2) ?? unknownPlatform
        }
    }

    /// A platform the API names with nothing readable.
    public static let unknownPlatform = "Your platform"

    /// web/src/lib/league/home/home.ts KIND_WORDS and DROP_WORD.
    public enum MoveKind {
        public static let add = "Free agent"
        public static let waiver = "Waiver"
        public static let trade = "Trade"
        public static let drop = "Drop"
    }

    /// home.ts TIEBREAK_WORDS; nil for a rule this build does not know, said as no rule stated.
    public static func tiebreak(_ rule: Components.Schemas.Tiebreak) -> String? {
        switch rule.value1 {
        case .headToHead: "head to head"
        case .pointsFor: "points for"
        case .pointsAgainst: "points against"
        case .divisionRecord: "division record"
        case nil: nil
        }
    }

    /// home.ts WAIVER_ORDER_WORDS; nil for an order this build does not know.
    public static func waiverOrder(_ order: Components.Schemas.WaiverOrder) -> String? {
        switch order.value1 {
        case .rolling: "rolling"
        case .inverseStandings: "reverse standings"
        case nil: nil
        }
    }

    /// box.ts FORMAT_WORDS; a format this build does not know by the API's own word.
    public static func format(_ format: Components.Schemas.ProjectionScoring.FormatPayload) -> String {
        switch format.value1 {
        case .ppr: "PPR"
        case .halfPpr: "half-PPR"
        case .standard: "standard"
        case nil: format.value2 ?? Box.none
        }
    }

    /// web/src/lib/league/box/basis.ts: the team sentence's parts.
    public enum Basis {
        public static let asOfKickoff = "as of kickoff once started"
        public static let projFinalPart =
            "\(Box.projFinal) adds the \(Box.pts) and the \(Box.proj) each starter has left."
        public static let noProjFinalPart = "No \(Box.projFinal) while a starter still to play has no \(Box.proj)."
        public static let paceClause = "in-play players at their projection's pace"
        public static let paceClauseShort = "in-play players at pace"
        public static let fromRosters = "their rosters"
        public static let fromProjected = "the players with a \(Box.proj)"
        public static let notInYet = "not in yet for this week"
    }
}
