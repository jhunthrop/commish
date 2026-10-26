import CommishCore
import CommishDesign
import CoreText
import SwiftUI

/// A figure's drawn width in a face, as CoreText sets it (the number face in tabular figures, so every
/// figure of as many digits is one width): what a figure column needs to hold it whole.
public enum FigureWidth {
    public static func of(_ text: String, face: Face, size: Double, weight: FaceWeight) -> Double {
        let font = Faces.ctFont(face, size: size, weight: weight)
            ?? CTFontCreateUIFontForLanguage(.system, size, nil)
        guard let font else {
            return 0
        }
        let line = CTLineCreateWithAttributedString(
            NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
        )
        return Double(CTLineGetTypographicBounds(line, nil, nil, nil)).rounded(.up)
    }
}

/// A row's figures as labelled cells in one strip (the web's FigureStrip.svelte, Lane 209): each cell
/// its head in small caps over its figure, never a sentence. The cells take fixed shares of the row, so
/// every head sits over its column down the list; the key the rows sort on is in ink, the opponent's
/// rank carries its tint.
public struct FigureStrip: View {
    /// A step under the cell labels (Tokens.TypeScale.xs), so five heads fit the smallest phone's row,
    /// as the web's strip sets its heads (--strip-head).
    static let headSize: Double = 10
    /// The room between two cells, as the web's phone strip.
    public nonisolated static let gap: Double = 4

    private let cells: [StripCell]

    public init(cells: [StripCell]) {
        self.cells = cells
    }

    public var body: some View {
        StripLayout(shares: cells.map(\.share), gap: Self.gap) {
            ForEach(cells) { cell in
                StripCellView(cell: cell)
            }
        }
    }
}

/// One cell: the head over the figure, both to the cell's trailing edge as a figure column is.
struct StripCellView: View {
    @Environment(\.colorScheme) private var colorScheme
    let cell: StripCell

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .trailing, spacing: 1) {
            Text(cell.head)
                .font(Faces.font(.ui, size: FigureStrip.headSize, weight: .semibold))
                .textCase(.uppercase)
                .tracking(FigureStrip.headSize * 0.02)
                .lineLimit(1)
                .foregroundStyle(theme.color(cell.key ? Tokens.Color.ink2 : Tokens.Color.ink3))
            figure(theme)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(cell.head) \(cell.value)")
    }

    @ViewBuilder
    private func figure(_ theme: Theme) -> some View {
        let text = Text(cell.value)
            .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: cell.key ? .bold : .semibold))
            .monospacedDigit()
            .lineLimit(1)
        switch (cell.opp, cell.ease) {
        case (true, .easy?), (true, .hard?):
            // The opponent's tint as a slim mark behind the rank, which prints with it (OppRank).
            text.foregroundStyle(theme.color(Tokens.Color.ink2))
                .padding(.horizontal, 3)
                .background(
                    RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .fill(theme.color(cell.ease == .easy ? Tokens.Color.gainBg : Tokens.Color.lossBg))
                )
        case (true, nil):
            text.foregroundStyle(theme.color(Tokens.Color.ink3))
        default:
            text.foregroundStyle(theme.color(cell.key ? Tokens.Color.ink : Tokens.Color.ink2))
        }
    }
}

/// The strip's grid (stripTracks): the width less the gaps, shared out by each cell's share, each cell
/// placed in its own track; as tall as its tallest cell.
struct StripLayout: Layout {
    let shares: [Double]
    let gap: Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        // An unbounded proposal (a horizontal scroll, a fixed-size parent) takes the cells' ideal widths.
        let ideal = subviews.reduce(0) { $0 + $1.sizeThatFits(.unspecified).width }
            + gap * Double(max(0, subviews.count - 1))
        let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? ideal
        let tracks = tracks(width)
        let height = zip(subviews, tracks).map { view, track in
            view.sizeThatFits(ProposedViewSize(width: track, height: nil)).height
        }.max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var x = bounds.minX
        for (view, track) in zip(subviews, tracks(bounds.width)) {
            view.place(
                at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading,
                proposal: ProposedViewSize(width: track, height: bounds.height)
            )
            x += track + gap
        }
    }

    /// Each track's width: the room after the gaps, by share.
    private func tracks(_ width: Double) -> [Double] {
        let total = shares.reduce(0, +)
        guard total > 0 else {
            return shares.map { _ in 0 }
        }
        let room = max(0, width - gap * Double(max(0, shares.count - 1)))
        return shares.map { room * $0 / total }
    }
}
