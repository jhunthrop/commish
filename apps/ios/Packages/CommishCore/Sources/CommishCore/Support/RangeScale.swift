import Foundation

/// The scale the range bars in one list share, so spans compare across rows (web/src/lib/ui/range.ts).
public struct RangeScale: Equatable, Sendable {
    public let low: Double
    public let high: Double

    public init(low: Double, high: Double) {
        self.low = low
        self.high = high
    }

    /// sharedScale: the lowest floor to the highest ceiling, nil with no range.
    public static func shared(_ ranges: [(floor: Double, ceiling: Double)]) -> RangeScale? {
        let all = ranges.flatMap { [$0.floor, $0.ceiling] }
        guard let low = all.min(), let high = all.max() else {
            return nil
        }
        return RangeScale(low: low, high: high)
    }

    /// rangePercent: where a point falls on the bar, a percent of its width clamped to the bar; a
    /// scale with no span puts every point at its start.
    public func percent(_ points: Double) -> Double {
        let span = high - low
        guard span > 0 else {
            return 0
        }
        return min(100, max(0, (points - low) / span * 100))
    }
}

/// One player's outcome range on a list's shared scale: the ends in words under the bar, and where
/// its span and median mark fall, as percents of the bar.
public struct RangeLine: Equatable, Sendable {
    public let text: String
    public let left: Double
    public let width: Double
    public let mid: Double

    public init(floor: Double, median: Double, ceiling: Double, scale: RangeScale) {
        text = Formatting.span(floor, ceiling)
        left = scale.percent(floor)
        width = scale.percent(ceiling) - left
        mid = scale.percent(median)
    }
}
