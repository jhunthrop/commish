import SwiftUI

/// A row the advice moves (web MoveMark.svelte): an arrow up on the accent for a player it starts, an
/// arrow down on grey for a starter it sits. The slot word beside it carries the meaning.
public struct MoveMark: View {
    @Environment(\.colorScheme) private var colorScheme
    private let starts: Bool
    private let side: Double

    /// `starts` draws the arrow up (in), else down (out).
    public init(starts: Bool, side: Double = 18) {
        self.starts = starts
        self.side = side
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Image(systemName: starts ? "arrow.up" : "arrow.down")
            .font(.system(size: side * 0.6, weight: .heavy))
            .foregroundStyle(theme.color(starts ? Tokens.Color.accentInk : Tokens.Color.ink2))
            .frame(width: side, height: side)
            .background(Circle().fill(theme.color(starts ? Tokens.Color.accent : Tokens.Color.surface2)))
            .overlay {
                if !starts {
                    Circle().strokeBorder(theme.color(Tokens.Color.lineStrong), lineWidth: 1)
                }
            }
            .accessibilityHidden(true)
    }
}

/// Lays its children in rows, wrapping to the next row where the width runs out (the web's
/// `flex-wrap`): the strip's chips, every one in sight.
public struct FlowRow: Layout {
    private let spacing: Double

    public init(spacing: Double = Tokens.Space.s1) {
        self.spacing = spacing
    }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * Double(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    public func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var top = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var left = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: left, y: top + (row.height - size.height) / 2), proposal: ProposedViewSize(size)
                )
                left += size.width + spacing
            }
            top += row.height + spacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: Double = 0
        var height: Double = 0
    }

    private func rows(width: Double, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.items.isEmpty ? size.width : current.width + spacing + size.width
            if needed > width, !current.items.isEmpty {
                rows.append(current)
                current = Row()
            }
            current.width = current.items.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.items.append(index)
        }
        if !current.items.isEmpty {
            rows.append(current)
        }
        return rows
    }
}
