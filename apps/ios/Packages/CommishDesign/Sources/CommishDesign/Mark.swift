import SwiftUI

/// The whistle's outline as a SwiftUI path, from the web's trace (Mark.generated.swift).
public enum MarkShape {
    /// The outline scaled from the trace's box into `rect`.
    public static func outline(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / MarkTrace.box
        let point = { (x: Double, y: Double) in CGPoint(x: rect.minX + x * scale, y: rect.minY + y * scale) }
        var path = Path()
        for segment in MarkTrace.outline {
            switch segment {
            case let .move(x, y): path.move(to: point(x, y))
            case let .line(x, y): path.addLine(to: point(x, y))
            case let .curve(x, y, c1x, c1y, c2x, c2y):
                path.addCurve(to: point(x, y), control1: point(c1x, c1y), control2: point(c2x, c2y))
            case .close: path.closeSubpath()
            }
        }
        return path
    }

    /// The outline's weight in trace units for a mark drawn `side` points square: the heavier one
    /// small, where the large weight thins to a hairline.
    public static func stroke(forSide side: Double) -> Double {
        side <= MarkTrace.smallMax ? MarkTrace.smallStroke : MarkTrace.stroke
    }
}

/// The Commish mark: the outline in ink, the pea in the accent.
public struct Mark: View {
    @Environment(\.colorScheme) private var colorScheme
    private let side: Double

    public init(side: Double) {
        self.side = side
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        // The trace plus half the heavier weight on every side, so no outline is cut.
        let pad = MarkTrace.smallStroke / 2
        let scale = side / (MarkTrace.box + 2 * pad)
        let box = CGRect(x: pad * scale, y: pad * scale, width: MarkTrace.box * scale, height: MarkTrace.box * scale)
        let disc = MarkTrace.disc
        ZStack(alignment: .topLeading) {
            MarkShape.outline(in: box)
                .stroke(
                    theme.color(Tokens.Color.ink),
                    style: StrokeStyle(lineWidth: MarkShape.stroke(forSide: side) * scale, lineJoin: .round)
                )
            Circle()
                .fill(theme.color(Tokens.Color.accent))
                .frame(width: disc.r * 2 * scale, height: disc.r * 2 * scale)
                .offset(x: box.minX + (disc.cx - disc.r) * scale, y: box.minY + (disc.cy - disc.r) * scale)
        }
        .frame(width: side, height: side, alignment: .topLeading)
        .accessibilityHidden(true)
    }
}
