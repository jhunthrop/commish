import SwiftUI

/// A player's position, with his rank there or the list he is on when the row draws one ("WR 12",
/// "RB IR"), as the web's PositionPill: monochrome on purpose, colour is spent on numbers.
public struct PositionPill: View {
    @Environment(\.colorScheme) private var colorScheme
    private let text: String
    /// The pill's least width where a list lines its pills up as a column (the Rankings row's slot);
    /// nil draws the pill as wide as its words.
    private let minWidth: Double?

    public init(_ text: String, minWidth: Double? = nil) {
        self.text = text
        self.minWidth = minWidth
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .tracking(Tokens.TypeScale.xs * 0.04)
            .lineLimit(1)
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .padding(.horizontal, 7)
            .frame(minWidth: minWidth.map { CGFloat($0) })
            .frame(height: 20)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(theme.color(Tokens.Color.surface2)))
    }
}
