import SwiftUI

/// A pill's colouring: quiet, the accent (the one verb, and you), a gain, a loss.
public enum PillTone: Sendable, Equatable {
    case quiet
    case accent
    case gain
    case loss
}

/// A short state in a capsule: "Final", "Kicked off", a position.
public struct Pill: View {
    @Environment(\.colorScheme) private var colorScheme
    private let text: String
    private let tone: PillTone

    public init(_ text: String, tone: PillTone = .quiet) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        let (fill, ink) = colors
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .foregroundStyle(theme.color(ink))
            .padding(.horizontal, Tokens.Space.s2)
            .padding(.vertical, 2)
            .background(Capsule().fill(theme.color(fill)))
    }

    private var colors: (ThemedColor, ThemedColor) {
        switch tone {
        case .quiet: (Tokens.Color.surface2, Tokens.Color.ink2)
        case .accent: (Tokens.Color.accent, Tokens.Color.accentInk)
        case .gain: (Tokens.Color.gainBg, Tokens.Color.gainInk)
        case .loss: (Tokens.Color.lossBg, Tokens.Color.lossInk)
        }
    }
}
