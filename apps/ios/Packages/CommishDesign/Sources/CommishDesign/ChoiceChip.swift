import SwiftUI

/// A filter chip (web Chip.svelte): a capsule on the strong line, the pressed one filled in the ink,
/// 32 points high. A row of them scrolls sideways on a phone (ChipGroup.svelte).
public struct ChoiceChip: View {
    @Environment(\.colorScheme) private var colorScheme
    private let label: String
    private let pressed: Bool
    private let action: () -> Void

    public init(_ label: String, pressed: Bool, action: @escaping () -> Void) {
        self.label = label
        self.pressed = pressed
        self.action = action
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Button(action: action) {
            Text(label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                .lineLimit(1)
                .foregroundStyle(theme.color(pressed ? Tokens.Color.bg : Tokens.Color.ink2))
                .padding(.horizontal, Tokens.Space.s3)
                .frame(height: 32)
                .background(Capsule().fill(pressed ? theme.color(Tokens.Color.ink) : .clear))
                .overlay(Capsule().strokeBorder(theme.color(pressed ? Tokens.Color.ink : Tokens.Color.lineStrong)))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(pressed ? [.isButton, .isSelected] : .isButton)
    }
}
