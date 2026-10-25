import CommishAPI
import CommishDesign
import Foundation

/// Which strength a page shows (strength-words.ts StrengthKind): the rest of the season's in season,
/// the preseason figure before the first kickoff.
public enum StrengthKind: Sendable, Equatable {
    case rest
    case preseason

    /// STRENGTH_HEADS, generated: "Rest of season strength".
    var head: String {
        self == .rest ? Words.Strength.rest : Words.Strength.preseason
    }

    /// STRENGTH_COLUMNS, generated: the grid's narrow head, "Rest of season".
    var column: String {
        self == .rest ? Words.StrengthColumn.rest : Words.StrengthColumn.preseason
    }
}

/// The strength a page shows for a slate (strength-words.ts StrengthView): its kind, the run's tenth,
/// its rank, the run's method and when it was read.
struct StrengthView: Equatable, Sendable {
    let kind: StrengthKind
    let strength: Double
    let rank: Int
    let method: String
    let window: Components.Schemas.RunWindow
}

/// A slate's strength as a page draws its figure: the run's tenth and its head with its rank.
public struct StrengthFigure: Equatable, Sendable {
    public let value: String
    public let caption: String
}

/// Schedule strength in words (web/src/lib/run/strength-words.ts), ported and held to
/// shared/fixtures/parity/reference.json. The method and the opponents' basis are the run's own words,
/// printed as given.
enum StrengthWords {
    /// strengthView: the preseason figure before the first kickoff, the rest of the season's after it,
    /// nil in season with none.
    static func view(_ slate: Components.Schemas.RunSlate, underway: Bool) -> StrengthView? {
        guard underway else {
            return StrengthView(
                kind: .preseason, strength: slate.strength, rank: slate.rank, method: slate.method,
                window: slate.window
            )
        }
        return slate.rest.map(\.value1).map {
            StrengthView(kind: .rest, strength: $0.strength, rank: $0.rank, method: $0.method, window: slate.window)
        }
    }

    /// winsBasis: "Opponents show expected wins, set before the season."
    static func winsBasis(_ opponentBasis: String) -> String {
        "Opponents show \(opponentBasis.prefix(1).lowercased())\(opponentBasis.dropFirst())."
    }

    /// "Rest of season strength is the average of ..., read Sep 7."
    static func strength(_ view: StrengthView) -> String {
        "\(view.kind.head) is \(view.method), read \(RunWords.window(view.window))."
    }

    /// playedWords: "weeks 1 to 5 and week 6's Thursday game are played, so faded", "" before any.
    static func played(_ reach: Reach) -> String {
        let played = RunReach.playedThrough(reach)
        return played.isEmpty ? "" : "\(played), so faded"
    }

    /// scheduleLead: what strength is and when it was read, then how the grid is ordered, shaded and
    /// faded; with no strength to show, only what is shaded and faded.
    static func scheduleLead(_ view: StrengthView?, strong: (count: Int, atLeast: String), reach: Reach) -> String {
        let played = played(reach)
        let faded = played.isEmpty ? "" : ", \(played)"
        let shaded = "the \(strong.count) highest opponents shaded (\(strong.atLeast) or more)\(faded)."
        guard let view else {
            return shaded.prefix(1).uppercased() + shaded.dropFirst()
        }
        return "\(strength(view)) Hardest first, \(shaded)"
    }

    /// clubsLead: "Every club's players on our PPR board. Rest of season strength is ...".
    static func clubsLead(_ formatLabel: String, first: StrengthView?) -> String {
        let strength = first.map { " \(strength($0))" } ?? ""
        return "Every club's players on our \(formatLabel) board.\(strength)"
    }

    /// strengthFigure: the tenth the run writes.
    static func figure(_ strength: Double) -> String {
        Formatting.fixed(strength, 1)
    }

    /// readWords: "Read Sep 7".
    static func read(_ view: StrengthView) -> String {
        "Read \(RunWords.window(view.window))"
    }

    /// hardestFigure: "10th" and "hardest of 32", the last club the easiest.
    static func hardestFigure(rank: Int, of count: Int) -> (figure: String, caption: String) {
        rank == count
            ? ("1st", "easiest of \(count)")
            : (Formatting.ordinal(rank), "hardest of \(count)")
    }

    /// hardestWords: "the hardest of 32", "3rd hardest of 32", "the easiest of 32".
    static func hardestWords(rank: Int, of count: Int) -> String {
        if rank == count {
            return "the easiest of \(count)"
        }
        return "\(rank == 1 ? "the hardest" : "\(Formatting.ordinal(rank)) hardest") of \(count)"
    }
}
