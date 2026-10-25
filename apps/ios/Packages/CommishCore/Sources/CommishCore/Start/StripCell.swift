import CommishDesign
import Foundation

/// One labelled cell of a box row's strip (figure-strip.ts StripCell, Lane 209): its head in small
/// caps over its figure, so a row's figures are columns down the list and never a sentence.
public struct StripCell: Equatable, Sendable, Identifiable {
    public let head: String
    /// The figure as printed, "--" when not held.
    public let value: String
    /// The figure the rows sort on, drawn in ink: a sorted column draws its key on every row.
    public let key: Bool
    /// The opponent's rank's cell, drawn with its tint and quiet without a rank.
    public let opp: Bool
    /// How easy the opponent is; nil on every other cell and on an opponent's cell without a rank.
    public let ease: Ease?
    /// A short figure under a short head (the week's "13.0" under "Wk 6"): a narrower share of the
    /// strip, so the longer heads keep their room on the smallest phone.
    public let narrow: Bool

    public var id: String {
        head
    }

    /// The cell's share of the strip's width beside each other cell's one (stripTracks).
    public var share: Double {
        narrow ? Self.narrowShare : 1
    }

    /// figure-strip.ts NARROW_SHARE.
    static let narrowShare = 0.6
}

/// figure-strip.ts's cell builders over a row's figures and evidence.
enum StripCells {
    /// figureCell: a figure under its head, "--" when not held.
    static func figure(_ head: String, _ value: Double?, key: Bool = false, narrow: Bool = false) -> StripCell {
        StripCell(head: head, value: StartWords.number(value), key: key, opp: false, ease: nil, narrow: narrow)
    }

    /// oppCell: the opponent's rank against his position, tinted, "--" without one (a bye, a list).
    static func opp(_ row: StartRow) -> StripCell {
        StripCell(
            head: Words.Box.oppRank, value: row.oppRank.map { Formatting.ordinal($0) } ?? Words.Box.none,
            key: false, opp: true, ease: row.oppRank.map { StartRows.ease($0, outOf: row.oppOf) }, narrow: false
        )
    }

    /// formCells: Avg and Last, the evidence every box score ends on.
    static func form(_ row: StartRow) -> (avg: StripCell, last: StripCell) {
        (figure(Words.Box.avg, row.avg), figure(Words.Box.last, row.last))
    }
}
