import Foundation

/// The web's words and labels for picks and chances (web/src/lib/format/draft.ts), ported so a pick and
/// a chance read the same on the phone as on the site. Every screen that names a pick uses these.
public enum DraftFormat {
    /// draft.ts CHANCE_FLOOR and CHANCE_CEILING: under and over these a chance reads "<1%" and ">99%".
    static let chanceFloor = 0.005
    static let chanceCeiling = 0.995
    static let nameSuffixes: Set<String> = ["Jr.", "Sr.", "II", "III", "IV", "V"]

    /// The round and seat of an overall pick in a snake draft (draft.ts snakeSlot).
    public static func snakeSlot(_ pick: Int, teams: Int) -> (round: Int, seat: Int) {
        let round = (pick - 1) / teams + 1
        let index = (pick - 1) % teams
        return (round, round % 2 == 1 ? index + 1 : teams - index)
    }

    /// "5.08": the round and the pick within it (draft.ts pickLabel).
    public static func pickLabel(_ pick: Int, teams: Int) -> String {
        let round = (pick - 1) / teams + 1
        let within = (pick - 1) % teams + 1
        return "\(round).\(within < 10 ? "0" : "")\(within)"
    }

    /// "97%", "<1%", ">99%" (draft.ts chanceShort).
    public static func chanceShort(_ chance: Double) -> String {
        if chance < chanceFloor {
            return "<1%"
        }
        if chance > chanceCeiling {
            return ">99%"
        }
        return "\(StartRows.jsRound(chance * 100))%"
    }

    /// A share of runs as a whole percent: "51%" (`Math.round(share * 100)`).
    public static func percent(_ share: Double) -> String {
        "\(StartRows.jsRound(share * 100))%"
    }

    /// "Williams" from "Jameson Williams", "Harrison" from "Marvin Harrison Jr." (draft.ts lastName).
    public static func lastName(_ name: String) -> String {
        let parts = name.split(whereSeparator: \.isWhitespace).map(String.init)
        guard let tail = parts.last else {
            return name
        }
        return nameSuffixes.contains(tail) && parts.count > 2 ? parts[parts.count - 2] : tail
    }
}
