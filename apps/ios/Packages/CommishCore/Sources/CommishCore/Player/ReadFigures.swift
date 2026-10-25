import CommishAPI
import CommishDesign
import Foundation

/// A figure set beside the season read, with the word or two naming its basis where it has one
/// (web/src/lib/run/read-figures.ts ReadFigure).
public struct ReadFigure: Equatable, Sendable {
    public let label: String?
    public let figure: String
    public let caption: String
}

/// read-figures.ts readFigures before the run ranks the rest of the season, the page's only form of
/// it (the season read shows only then): the writer's pulls as written, the one that is his
/// projection and a tier gap each named preseason.
enum ReadFigures {
    /// A pull about a tier: the gap to the next one, from the preseason tiers.
    static var tier: Regex<Substring> {
        #/\btiers?\b/#.ignoresCase()
    }

    /// A number as prose writes it, thousands commas allowed: its decimals captured.
    static var number: Regex<(Substring, Substring?)> {
        #/^[+-]?\d[\d,]*(?:\.(\d+))?$/#
    }

    static func preseason(_ pulls: [RunPullFigure], projection: Double) -> [ReadFigure] {
        pulls.map { pull in
            if writes(pull.figure, projection) {
                return ReadFigure(
                    label: Words.ReadFigures.preseasonProjection,
                    figure: pull.figure,
                    caption: pull.caption
                )
            }
            let tierGap = pull.caption.contains(tier)
            return ReadFigure(
                label: tierGap ? Words.ReadFigures.preseasonTiers : nil, figure: pull.figure, caption: pull.caption
            )
        }
    }

    /// Whether a figure as the prose writes it is this value at the figure's own precision.
    static func writes(_ figure: String, _ value: Double) -> Bool {
        guard let match = figure.wholeMatch(of: number) else {
            return false
        }
        let decimals = match.output.1?.count ?? 0
        guard let written = Double(figure.replacingOccurrences(of: ",", with: "")),
              let rounded = Double(Formatting.fixed(value, decimals))
        else {
            return false
        }
        return written == rounded
    }
}
