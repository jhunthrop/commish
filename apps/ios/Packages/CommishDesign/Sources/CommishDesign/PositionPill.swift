import SwiftUI

/// A player's position, with his rank there or the list he is on when the row draws one ("WR 12",
/// "RB IR"), as the web's PositionPill: monochrome on purpose, colour is spent on numbers.
public struct PositionPill: View {
    @Environment(\.colorScheme) private var colorScheme
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .tracking(Tokens.TypeScale.xs * 0.04)
            .lineLimit(1)
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .padding(.horizontal, 7)
            .frame(height: 20)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(theme.color(Tokens.Color.surface2)))
    }
}
